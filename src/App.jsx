import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import * as L from './tools/live';
import * as T from './tools/transit';
import * as W from './tools/world';
import { LocProvider } from './core/geo';
import { attach as sfxAttach, enabled as sfxEnabled, setEnabled as sfxSet } from './core/sfx';
import * as TR from './tools/trains2';
import { TrainJourney } from './tools/train-journey';
import { Hub } from './tools/travel-hub';
import { Settings } from './tools/settings';
import { EmergencyDirectory } from './tools/help-dir';

import { Spin } from './ui/kit';
import { Icon } from './ui/icons';
import logo from './assets/logo.png';

/* ------------------------------------------------------------------ travel hubs
   Heavy transit data (bus + metro) stays behind React.lazy: nothing of the
   2.4 MB of JSON is downloaded until a travel hub is actually opened.        */
const BusHub = lazy(() => import('./tools/travel-hubs').then((m) => ({ default: m.BusHub })));
const MetroHub = lazy(() => import('./tools/travel-hubs').then((m) => ({ default: m.MetroHub })));
const MultiModal = lazy(() => import('./tools/multimodal').then((m) => ({ default: m.MultiModal })));
const LiveBus = lazy(() => import('./tools/live-bus').then((m) => ({ default: m.LiveBus })));
const MyStops = lazy(() => import('./tools/my-stops').then((m) => ({ default: m.MyStops })));

const TrainHub = () => (
  <Hub icon="train" title="Trains" sub="Live status · schedule · trains between stations"
    tabs={[
      { id: 'between', n: 'Find trains', i: 'search',  C: TR.TrainsBetween },
      { id: 'live',    n: 'Live status', i: 'signal',  C: TR.TrainLive },
      { id: 'sched',   n: 'Schedule',    i: 'list',    C: TR.TrainSchedule },
      { id: 'journey', n: 'Long journey', i: 'luggage', C: TrainJourney },
    ]} />);

/* --------------------------------------------------------------- registry
   t: 'off' = works fully offline in the browser
      'live' = fetches fresh data; if one channel fails, another is tried.   */
const TOOLS = [
  // ---------------- Travel
  { id: 'bus',      n: 'Bus',           i: 'bus',       c: 'Travel', t: 'off', d: 'Every Delhi route · timetables · fares', C: BusHub },
  { id: 'train',    n: 'Train',         i: 'train',     c: 'Travel', t: 'live', d: 'Live running status & schedules',        C: TrainHub },
  { id: 'metro',    n: 'Metro',         i: 'metro',     c: 'Travel', t: 'off', d: 'Every station · fares · first & last train', C: MetroHub },
  { id: 'livebus',  n: 'Live Buses',    i: 'map',       c: 'Travel', t: 'live', d: 'Buses moving across Delhi, on the map',  C: LiveBus },
  { id: 'journey',  n: 'Plan Journey',  i: 'compass',   c: 'Travel', t: 'off', d: 'Metro + bus combined trip',               C: MultiModal },
  { id: 'nearby',   n: 'Near Me',       i: 'pin',       c: 'Travel', t: 'live', d: 'ATM, food, fuel around you',             C: T.Nearby },
  { id: 'guide',    n: 'Travel Guide',  i: 'globe',     c: 'Travel', t: 'live', d: 'City info + SOS numbers',                C: T.TravelGuide },
  { id: 'sos',      n: 'Emergency',     i: 'warn',      c: 'Travel', t: 'live', d: 'Helplines, India & world',               C: W.Emergency },
  { id: 'dial',     n: 'Dial Codes',    i: 'signal',    c: 'Travel', t: 'live', d: 'Country calling codes',                  C: W.DialCodes },
  { id: 'help',     n: 'Emergency Numbers', i: 'phone', c: 'Travel', t: 'off', d: 'Call & WhatsApp — police, metro, rail, bus, hospital', C: EmergencyDirectory },
  { id: 'stops',    n: 'My Stops',      i: 'star',      c: 'Travel', t: 'off', d: 'Saved stops — live next buses, no search', C: MyStops },

  // ---------------- Essentials
  { id: 'weather',  n: 'Weather + AQI', i: 'sun',       c: 'Essentials', t: 'live', d: 'Forecast & air quality',             C: L.Weather },
  { id: 'pincode',  n: 'PIN Code',      i: 'mail',      c: 'Essentials', t: 'live', d: 'Post offices by PIN',                C: L.Pincode },
  { id: 'currency', n: 'Currency',      i: 'swap',      c: 'Essentials', t: 'live', d: 'Live FX rates',                      C: L.Currency },
  { id: 'clock',    n: 'World Clock',   i: 'clock',     c: 'Essentials', t: 'live', d: 'Time zones, live',                   C: L.WorldClock },

  // ---------------- App
  { id: 'settings', n: 'Settings',      i: 'cog',       c: 'App', t: 'off', d: 'Theme · sound · install', C: Settings },
];

const CATS = ['All', 'Travel', 'Essentials', 'App'];
const NAV = [
  ['', 'grid', 'Tools'],
  ['bus', 'bus', 'Bus'],
  ['train', 'train', 'Train'],
  ['metro', 'metro', 'Metro'],
  ['livebus', 'map', 'Live Buses'],
];

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [snd, setSnd] = useState(() => sfxEnabled());

  useEffect(() => sfxAttach(), []);
  const [fav, setFav] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dost:fav') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    const h = () => { setRoute(location.hash.slice(1) || ''); window.scrollTo(0, 0); };
    addEventListener('hashchange', h); return () => removeEventListener('hashchange', h);
  }, []);
  useEffect(() => { localStorage.setItem('dost:fav', JSON.stringify(fav)); }, [fav]);

  const tool = TOOLS.find((t) => t.id === route);
  const shown = useMemo(() => {
    let list = TOOLS;
    if (cat === 'Fav') list = list.filter((t) => fav.includes(t.id));
    else if (cat !== 'All') list = list.filter((t) => t.c === cat);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((t) => (t.n + ' ' + t.d + ' ' + t.c).toLowerCase().includes(s));
    }
    return list;
  }, [cat, q, fav]);

  const go = (id) => { location.hash = id; };
  const offCount = TOOLS.filter((t) => t.t === 'off').length;

  return (
    <LocProvider>
      <div className="app">
        <header className="topbar">
          {tool
            ? <button className="iconbtn" onClick={() => go('')} aria-label="Back"><Icon n="back" size={19} /></button>
            : <span className="brandmark"><img className="brandlogo" src={logo} alt="" /><span className="brand gradtext">DOST</span></span>}
          <div className="tb-t">
            <b>{tool ? tool.n : 'Delhi DOST'}</b>
            <span>{tool ? tool.d : `${TOOLS.length} travel tools · no login`}</span>
          </div>
          {tool && tool.id !== 'settings' && (
            <button className="iconbtn" aria-label="Favourite" onClick={() => setFav((f) =>
              f.includes(tool.id) ? f.filter((x) => x !== tool.id) : [...f, tool.id])}>
              <Icon n={fav.includes(tool.id) ? 'staron' : 'star'} size={18}
                style={{ color: fav.includes(tool.id) ? 'var(--green)' : '' }} />
            </button>)}
          <button className="iconbtn" aria-label={snd ? 'Sound effects on' : 'Sound effects off'}
            title={snd ? 'Tap sounds are on — tap to mute' : 'Tap sounds are off — tap to enable'}
            onClick={() => { const v = !snd; sfxSet(v); setSnd(v); }}>
            <Icon n={snd ? 'volume' : 'volumeoff'} size={18} style={{ color: snd ? 'var(--green)' : '' }} />
          </button>
          <button className="iconbtn" aria-label="Settings" title="Settings"
            onClick={() => go('settings')}><Icon n="cog" size={18} /></button>
        </header>

        <div className="main-area">
          {!tool && (<>
            <div className="hero dost-hero">
              <div className="hero-lockup">
                <img className="hero-logo" src={logo} alt="Delhi DOST" />
                <div className="hero-txt">
                  <h1 className="gradtext">DELHI DOST</h1>
                  <p>Delhi ki har safar ka saathi — Bus · Metro · Train · Live.
                    Sab kuch ek app mein, no login.</p>
                </div>
              </div>
              <div className="qa">
                <button onClick={() => go('journey')}><Icon n="compass" size={20} /><span>Plan<br/>Journey</span></button>
                <button onClick={() => go('livebus')}><Icon n="map" size={20} /><span>Live<br/>Buses</span></button>
                <button onClick={() => go('stops')}><Icon n="star" size={20} /><span>My<br/>Stops</span></button>
                <button onClick={() => go('help')}><Icon n="phone" size={20} /><span>Emergency<br/>Numbers</span></button>
              </div>
              <div className="pillrow">
                <span className="pill on"><Icon n="check" size={13} /> {offCount} work offline</span>
                <span className="pill"><Icon n="refresh" size={13} /> Auto-fallback</span>
                <span className="pill"><Icon n="shield" size={13} /> No tracking</span>
                <span className="pill" title="deployed build"><Icon n="box" size={13} /> {__BUILD__}</span>
              </div>
            </div>

            <div className="search">
              <Icon n="search" size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" enterKeyHint="search" />
              {q && <button onClick={() => setQ('')} aria-label="Clear"
                style={{ background: 'none', border: 0, color: 'var(--fg3)', display: 'grid', placeItems: 'center' }}>
                <Icon n="x" size={17} /></button>}
            </div>

            <div className="cats">
              {fav.length > 0 && (
                <button className={`cat ${cat === 'Fav' ? 'on' : ''}`} onClick={() => setCat('Fav')}>
                  <Icon n="staron" size={13} /> {fav.length}</button>)}
              {CATS.map((c) => <button key={c} className={`cat ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>

            {shown.length === 0
              ? <div className="state">No tools match &ldquo;{q}&rdquo;</div>
              : <div className="grid">
                  {shown.map((t) => (
                    <button className="tile" key={t.id} onClick={() => go(t.id)}>
                      {t.t === 'live' ? <span className="live" /> : <span className="off">OFF</span>}
                      <span className="ic"><Icon n={t.i} size={24} /></span>
                      <b>{t.n}</b>
                      <small>{t.d}</small>
                    </button>))}
                </div>}

            <div className="hr" />
            <p className="dim sm">
              <b style={{ color: 'var(--green)' }}>OFF</b> = runs fully in your browser, works without internet.
              <b style={{ color: 'var(--green)' }}> ●</b> = live; if one channel is unreachable the next one is tried
              automatically.
            </p>
          </>)}

          {tool && <div style={{ paddingTop: 14 }}><Suspense fallback={<Spin />}><tool.C /></Suspense></div>}
        </div>

        <nav className="nav">
          {NAV.map(([id, ic, label]) => (
            <button key={id} className={route === id ? 'on' : ''} onClick={() => go(id)}>
              <Icon n={ic} size={21} /><small>{label}</small>
            </button>))}
        </nav>
      </div>
    </LocProvider>
  );
}
