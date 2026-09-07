/**
 * trip-ui.jsx — the shared chrome for maps, turn-by-turn and get-off alerts.
 *
 * Two rules shape everything here:
 *
 * 1. A map is a thing you ask for.  Every journey card carries one small button
 *    with a map glyph; until it is pressed the map is not mounted and not even
 *    fetched, so the panel stays a clean list and ~48 kB of Leaflet stays out of
 *    the payload until it earns its place.
 * 2. An alert that cannot fire must say why.  Notification permission, GPS fix
 *    quality and which channel delivered the alert are all printed in the same
 *    bar that counts your stops — never a silent failure, never a claim of
 *    "you have been notified" that we cannot check.
 *
 * <TripKit> is the whole thing: map toggle, turn-by-turn toggle, the arm
 * button.  Each planner hands it a track from src/core/trip.js and nothing else.
 */
import React, { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/icons';
import { subscribe, getTripState, armTrip, stopTrip, enableNotifications, gateCheck } from '../core/trip-state';
import { play as sound, setEnabled, enabled as soundOn, soundLog, SOUNDS, supported as soundSupported } from '../core/sfx.js';

const TripMap = lazy(() => import('./trip-map.jsx'));

/** Live trip for any component, without context plumbing. */
export function useTrip() {
  return useSyncExternalStore(subscribe, getTripState, getTripState);
}

const drawable = (track) => (track?.points || []).filter((p) => p && isFinite(p.lat) && isFinite(p.lon));

/* ----------------------------------------------------------------- the map */
/**
 * The map, behind one button.  Nothing about Leaflet is imported or mounted
 * until that button is pressed, so a journey card stays a list and the map
 * library stays out of the payload until somebody asks for it.
 *
 * `open` is optional: pass it (with `onToggle`) to drive the panel from a parent
 * that also highlights rows, and leave it out for a standalone map button.
 */
export function MapPanel({ track, active = -1, fix = null, onSelect, height = 250,
                           label = 'Map', hint = '', open: controlled, onToggle }) {
  const [own, setOwn] = useState(false);
  const open = controlled != null ? controlled : own;
  const setOpen = (v) => { if (onToggle) onToggle(v); else setOwn(v); };
  const pts = drawable(track);
  if (!pts.length) {
    return <div className="note">No published coordinates for this leg, so there is nothing to draw.</div>;
  }
  return (
    <div className="mapslot">
      <div className="btnrow" style={{ margin: 0 }}>
        <button className={`cat ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon n="map" size={15} /> {open ? 'Hide map' : `${label} · ${pts.length} points`}
        </button>
        {hint && <span className="dim sm" style={{ alignSelf: 'center' }}>{hint}</span>}
      </div>
      {open && (
        <Suspense fallback={<div className="mapnote" style={{ height: 90 }}><span className="dot" /> Loading map…</div>}>
          <TripMap points={pts} active={active} fix={fix} onSelect={onSelect} height={height} />
        </Suspense>)}
    </div>);
}

/* ------------------------------------------------------------- turn-by-turn */
export function StepList({ steps, active = -1, onPick, onPickPt }) {
  const glyph = { walk: 'walk', board: 'bus', ride: 'route', alight: 'flag' };
  const [open, setOpen] = useState({});
  if (!steps?.length) return null;
  return (
    <div className="steps2">
      {steps.map((s, i) => (
        <div key={i} className={`stp ${s.kind}${(s.via && s.via.some((v) => v.at === active)) || (s.pi != null ? s.pi === active : i === active) ? ' now' : ''}`}
          onClick={() => onPick && onPick(i)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
          <span className="sp"><Icon n={glyph[s.kind] || 'route'} size={14} /></span>
          <div className="main">
            <b>{s.text}{s.via && s.via.length > 0 ? <> <button className={`viachev${open[i] ? ' up' : ''}`} aria-expanded={!!open[i]}
                title={`Show the ${s.via.length} stop${s.via.length === 1 ? '' : 's'} in between`}
                onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [i]: !o[i] })); }}>▾</button></> : null}</b>
            {(s.detail || s.note) && <div className="dim sm">{[s.detail, s.note].filter(Boolean).join(' · ')}</div>}
            {s.metres != null && (
              <div className="dim sm">
                {s.metres < 950 ? `${s.metres} m` : `${(s.metres / 1000).toFixed(1)} km`}
                {s.min != null ? ` · about ${s.min} min on foot` : ''}
                {s.measured ? ' · measured on footpaths' : ''}
              </div>)}
            {open[i] && s.via && s.via.length > 0 && (
              <div className="vialist">
                {s.via.map((v) => (
                  <button key={v.at} type="button" className={`viarow${v.at === active ? ' now' : ''}`}
                    onClick={(e) => { e.stopPropagation(); if (onPickPt) onPickPt(v.at); }}>
                    <span className="vdot" />{v.n || 'unnamed stop'}
                    {v.when != null ? <span className="dim sm"> · {String(Math.floor(((v.when % 1440) + 1440) % 1440 / 60) % 24)
                        .padStart(2, '0')}:{String(Math.abs(v.when) % 60).padStart(2, '0')}</span> : null}
                  </button>))}
                <div className="dim sm viahint">Tap a stop - it lights up on the map, and the map pans to it.</div>
              </div>)}
          </div>
        </div>))}
    </div>);
}

/* ------------------------------------------------------------------ sound */
/**
 * A travel panel's own copy of the app-wide switch — the same key the header
 * speaker and the Settings checkbox write, so the three cannot disagree. It sits
 * last in the panel, below the journeys, because a panel about travel should open
 * with travel. Switching it on plays a bell so the choice can be heard before it
 * is trusted; `last:` prints the most recent decision, because silence with no
 * reason is indistinguishable from a bug.
 */
export function SoundToggle({ note = '' }) {
  const [on, set] = useState(() => soundOn());
  const [log, setLog] = useState(() => soundLog());
  useEffect(() => {
    let live = true;
    const id = setInterval(() => { if (live) { set(soundOn()); setLog(soundLog()); } }, 1200);
    return () => { live = false; clearInterval(id); };
  }, []);
  const flip = () => { const v = !on; setEnabled(v); set(v); setLog(soundLog()); if (v) sound('ding'); };
  if (!soundSupported()) {
    return <div className="dim sm">Sound: this browser has no Web Audio, so nothing plays and nothing is fetched.</div>;
  }
  const last = log[log.length - 1];
  return (
    <div className="sndrow">
      <button className={`cat ${on ? 'on' : ''}`} onClick={flip}
        title={`Turn ${on ? 'off' : 'on'} the small sounds in this tool — each one is generated in your browser, no file is downloaded`}>
        {on ? 'Sounds on' : 'Sounds off'}
      </button>
      <span className="dim sm">{on && last ? `last: ${SOUNDS[last.name]?.label || last.name}${last.ok ? '' : ' — ' + last.why}`
        : on ? 'silent until you tap something' : 'nothing plays, nothing is fetched'}{note}</span>
    </div>);
}

/* -------------------------------------------------------------- arm / stop */
export function ArmButton({ track, source = '', boardMin = null, label = 'Get-off alert' }) {
  const t = useTrip();
  const mine = t.armed && t.trip?.label === track?.label && t.trip?.mode === track?.mode;
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');

  const start = async () => {
    setBusy(true); setWhy('');
    // arming happens FIRST and is never queued behind a permission prompt: the
    // bar on screen is the promise, the notification is the upgrade on top
    const a = armTrip(track, { boardMin, source });
    setBusy(false);
    if (!a.ok) { sound('brake'); setWhy(a.why); return; }
    sound('ding');       // the bell means the watch really started
    const gate = gateCheck(track, t.fix ? { lat: t.fix.lat, lon: t.fix.lon, accuracy: t.fix.accuracy } : null);
    if (gate?.why) setWhy(gate.why);
    if (t.perm !== 'granted') {
      const r = await enableNotifications();
      if (!r.ok && !gate?.why) setWhy(r.why || 'Alerts stay in the on-screen bar.');
    }
  };

  if (mine) {
    return <button className="btn ghost sm" onClick={() => { sound('tick'); stopTrip(); }}><Icon n="x" size={14} /> Stop alert</button>;
  }
  return (
    <span className="armwrap">
      <button className="btn sm" onClick={start} disabled={busy || !track?.points?.length}
        title={track?.points?.length ? `Watches ${track.points.length} published stops` : 'No stops with coordinates'}>
        <Icon n="bell" size={14} /> {busy ? 'Arming…' : label}
      </button>
      {why && <span className="dim sm" style={{ marginLeft: 8 }}>{why}</span>}
    </span>);
}

/* --------------------------------------------------------------- the kit */
/**
 * One row of controls + whatever they open.  `track` comes from trip.js, `steps`
 * from stepsOf(track).  `boardMin` is the published departure minute you are
 * waiting for, so every later stop gets an honest expected minute.
 */
export function TripKit({ track, steps, boardMin = null, height = 250, active: activeProp = null,
                          onActive, stepsToggle = true }) {
  const [map, setMap] = useState(false);
  const slot = useRef(null);
  const [list, setList] = useState(false);
  const [inner, setInner] = useState(-1);
  const active = activeProp != null ? activeProp : inner;
  const setActive = (i) => { setInner(i); if (onActive) onActive(i); };
  const pts = drawable(track);
  const t = useTrip();
  const armed = t.armed && t.trip?.label === track?.label;
  /* Opening a map that stays under your thumbs is not opening a map: once the
     tiles are mounted, centre the panel and keep the tab bar clear. */
  useEffect(() => {
    if (!map || !slot.current) return undefined;
    const id = setTimeout(() => {
      const calm = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { slot.current.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' }); } catch {}
    }, 260);
    return () => clearTimeout(id);
  }, [map]);

  if (!pts.length) {
    return <div className="note">This leg has no published coordinates, so there is no map and no get-off alert for it.</div>;
  }
  return (
    <>
      <div className="btnrow tripctl" style={{ margin: '11px 0 0' }}>
        <button className={`cat ${map ? 'on' : ''}`} aria-expanded={map} onClick={() => setMap((o) => !o)}>
          <Icon n="map" size={15} /> {map ? 'Hide map' : `Map · ${pts.length}`}
        </button>
        {stepsToggle && (
          <button className={`cat ${list ? 'on' : ''}`} aria-expanded={list} onClick={() => setList((o) => !o)}>
            <Icon n="list" size={15} /> Turn by turn
          </button>)}
        <ArmButton track={track} boardMin={boardMin} label="Get-off alert" />
      </div>

      <div ref={slot} className="mapslot">
      {map && (
        <Suspense fallback={<div className="mapnote" style={{ height: 90 }}><span className="dot" /> Loading map…</div>}>
          <TripMap points={track.points} active={active >= 0 ? active : (armed && t.j?.reached >= 0 ? t.j.reached : -1)}
            fix={t.fix} onSelect={(i) => setActive(i)} height={height} wpath={track.wpath} />
        </Suspense>)}
      </div>

      {list && (<StepList steps={steps} active={active} onPickPt={(k) => setActive(k)}
        onPick={(i) => { const s = steps && steps[i]; setActive(s && s.pi != null ? s.pi : i); }} />)}
    </>);
}

/* ------------------------------------------------------------------- the bar */
/**
 * One sticky bar per hub: where you are in the trip, how far the next stop is,
 * and how honest that number is.  It is deliberately the *primary* alert surface:
 * notifications are a bonus we cannot guarantee on every browser.
 */
export function TripBar() {
  const t = useTrip();
  const [why, setWhy] = useState(false);        // the fine print, folded away
  const lastTitle = t.log[0]?.title;
  const lastUrgent = !!t.log[0]?.urgent;
  /* The most recent alert gets its own line for a moment, then folds back: a bar
     that keeps shouting the 07:20 boarding reminder all ride is a bar that gets
     closed. Urgent ones — your stop, you have arrived — stay up longer.
     Every hook here sits above the early return, because a hook after a `return
     null` runs only when a trip is armed and React refuses to count hooks that
     appear between renders. */
  const [showLast, setShowLast] = useState(true);
  useEffect(() => {
    import('../core/trip-state').then((m) => m.resumeTrip()).catch(() => {});
  }, []);
  useEffect(() => {
    if (!lastTitle) return undefined;
    setShowLast(true);
    const id = setTimeout(() => setShowLast(false), lastUrgent ? 9e4 : 18e3);
    return () => clearTimeout(id);
  }, [lastTitle, lastUrgent]);
  if (!t.armed || !t.trip) return null;
  if (typeof document === 'undefined') return null;          // renderToString has no body
  const j = t.j || {};
  const words = {
    'no-signal': 'Waiting for a position or a published departure',
    'to-stop': 'Head to your boarding stop',
    'at-board': 'At your boarding stop',
    riding: j.stopsLeft === 1 ? 'Next stop is yours' : 'On board',
    alight: 'This is your stop',
    done: 'Trip finished',
  };
  const next = j.next?.name || '';
  const dist = j.distanceM != null
    ? (j.distanceM < 950 ? `${Math.round(j.distanceM)} m` : `${(j.distanceM / 1000).toFixed(1)} km`) : null;
  const last = t.log[0];
  // Portalled to <body>: a card behind the bar carries its own backdrop-filter,
  // and any filtered or transformed ancestor silently traps a position:fixed
  // child — the bar would then float over the card instead of the screen.
  return createPortal((
    <div className={`tripbar${j.state === 'alight' || j.state === 'done' ? ' hot' : ''}`}>
      {/* Three lines, never a wall: where you are, what comes next, and an
          explanation one tap away. A floating bar that eats a fifth of the
          screen stops being useful the moment you are on the bus. */}
      <div className="tb1">
        <span className={`dot${t.trust || t.clockBased ? '' : ' warn'}`} />
        <b>{words[j.state] || 'Trip armed'}</b>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => stopTrip()}>End</button>
      </div>
      <div className="tbmeta">
        <b>{t.trip.label}</b>
        {j.stopsLeft != null && <span>{j.stopsLeft} stop{j.stopsLeft === 1 ? '' : 's'} left</span>}
        {next && <span>next {next}</span>}
        {dist && <span>{dist}{j.bearingTo ? ` ${j.bearingTo}` : ''}</span>}
      </div>
      {last && showLast && (
        <div className="tb2"><Icon n={last.urgent ? 'warn' : 'bell'} size={13} /><span>{last.title}</span></div>)}
      <div className="tb3">
        <button className="tbwhy" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
          {why ? 'hide the fine print' : 'how it knows'}
        </button>
        {why && <span className="dim sm">
          {t.clockBased
            ? 'Timetable clock: no usable position right now, so this is counting from the published departure time and your device clock.'
            : t.trust
              ? `Position ±${t.fix?.accuracy ?? '?'} m, matched against ${t.trip.points.length} published stops.`
              : 'Armed — no position fix yet, alerts will use the timetable clock.'}
          {' · '}{t.via === 'sw' ? 'notifications go to your shade'
            : t.via === 'constructor' ? 'notifications are page-level'
            : 'alerts show in this bar only'}
          {t.wake ? ' · screen kept awake' : ''}
        </span>}
      </div>
    </div>), document.body);
}

/** One-line status of the alert plumbing, for the foot of a panel. */
export function AlertStatus() {
  const t = useTrip();
  const txt = !t.armed
    ? (t.perm === 'granted' ? 'Get-off alerts ready'
      : t.perm === 'denied' ? 'Notifications blocked in browser settings — the on-screen bar still works'
      : 'Allow notifications when arming a trip for alerts outside this tab')
    : `${t.trust ? `fix ±${t.fix?.accuracy ?? '?'} m` : t.fixError || 'no fix'} · ${t.clockBased ? 'timetable clock' : 'live position'}`;
  return <div className="src"><span className={`dot${t.armed && !t.trust ? ' warn' : ''}`} /><span>{txt}</span></div>;
}
