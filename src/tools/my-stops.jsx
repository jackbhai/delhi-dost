/**
 * My Stops — apne bus stops / metro stations, ek jagah.
 *
 * Har saved bus stop ke liye live "next buses" dikhta hai (published
 * timetable + device clock — same engine jo Bus "Right now" chalata hai).
 * Metro stations apne lines ke saath list hote hain aur ek tap pe Metro
 * tool khul jata hai. Sab local hai — koi account nahi, koi server nahi.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchStops as searchBusStops, routesAt, stopIndexOn, nextAtStop,
         fmtTime, minutesOfDay } from '../core/bus-route';
import { searchStations, stationAt } from '../core/metro-route';
import { getSaved, saveStop, unsaveStop, isSaved, onSaved } from '../core/saved';
import { play as sound } from '../core/sfx.js';
import { Card, Empty } from '../ui/kit';
import { Icon } from '../ui/icons';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };

/* ------------------------------------------------ live next-bus for a stop */
function useNextBuses(stop) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    const recs = routesAt(stop);
    const out = [];
    for (const r of recs) {
      const pos = stopIndexOn(r, stop);
      if (pos < 0) continue;
      const nxt = nextAtStop(r, pos, now, 2);
      if (!nxt.length) continue;
      out.push({ r, pos, next: nxt[0], spare: nxt[1] || null });
    }
    return out.sort((a, b) => a.next.at - b.next.at).slice(0, 6);
  }, [stop, now]);
}

function BusStopRow({ stop }) {
  const [gone, setGone] = useState(false);
  const buses = useNextBuses(stop);
  const active = buses.filter((b) => b.next.at >= minutesOfDay(new Date()) - 1);
  return (
    <div style={{ padding: '11px 14px', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon n="bus" size={15} style={{ color: 'var(--cyan)' }} />
        <b style={{ flex: 1, fontSize: 13.5 }}>{stop}</b>
        <a className="btn ghost sm" href="#bus" style={{ textDecoration: 'none' }}>Open Bus</a>
        <button className="iconbtn" aria-label={`Remove ${stop}`} onClick={() => { sound('tick'); unsaveStop('bus', stop); setGone(true); }}
          style={{ width: 32, height: 32, borderRadius: 10 }}><Icon n="trash" size={14} /></button>
      </div>
      {!gone && (
        active.length ? (
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {active.map((b, i) => (
              <div key={b.r.r + i} className="row" style={{ gap: 8, padding: '6px 0', border: 0, alignItems: 'baseline' }}>
                <span className="tag g" style={{ flex: '0 0 auto', fontWeight: 800 }}>{b.r.r}</span>
                <span className="dim sm" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.r.f} → {b.r.t}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg)' }}>{fmtTime(b.next.at)}</span>
                <span className="tag c">{b.next.mins} min</span>
              </div>))}
          </div>
        ) : (
          <div className="dim sm" style={{ marginTop: 6 }}>Is time koi bus nahi mili — timetable ke hisaab se service band ya khatam.</div>)
      )}
      {gone && <div className="dim sm" style={{ marginTop: 6 }}>Stop hata diya gaya.</div>}
    </div>);
}

function MetroStationRow({ stop }) {
  const st = stationAt(stop);
  return (
    <div style={{ padding: '11px 14px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon n="metro" size={15} style={{ color: 'var(--green)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13.5, display: 'block' }}>{stop}</b>
        {st && st.l && <span className="dim sm">{(Array.isArray(st.l) ? st.l : []).join(' · ')}</span>}
      </div>
      <a className="btn ghost sm" href="#metro" style={{ textDecoration: 'none' }}>Open Metro</a>
      <button className="iconbtn" aria-label={`Remove ${stop}`} onClick={() => { sound('tick'); unsaveStop('metro', stop); }}
        style={{ width: 32, height: 32, borderRadius: 10 }}><Icon n="trash" size={14} /></button>
    </div>);
}

/* ------------------------------------------------------------------ tool */
export function MyStops() {
  const [saved, setSaved] = useState(() => getSaved());
  const [tab, setTab] = useState('bus');
  const [q, setQ] = useState('');
  const [addedFlash, setAddedFlash] = useState('');
  const addRef = useRef(null);

  useEffect(() => onSaved(() => setSaved(getSaved())), []);

  const hits = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    return tab === 'bus'
      ? searchBusStops(s, 7).filter((n) => !isSaved('bus', n))
      : searchStations(s, 7).filter((n) => !isSaved('metro', n));
  }, [q, tab, saved]);

  const busSaved = saved.filter((s) => s.t === 'bus');
  const metroSaved = saved.filter((s) => s.t === 'metro');

  const add = (n) => {
    if (saveStop(tab, n)) { sound('ding'); setAddedFlash(n); setTimeout(() => setAddedFlash(''), 1200); }
    else { sound('tick'); }
    setQ('');
  };

  return (
    <div style={{ paddingBottom: 26 }}>
      <Card>
        <div className="chead"><Icon n="star" size={16} /> My Stops
          <span className="dim sm" style={{ marginLeft: 8 }}>saved on this phone</span></div>
        <div className="dim sm">Routine ke stops save kar lo — har baar search mat karo. Data isi phone pe
          rehta hai (localStorage), koi account nahi.</div>

        <div className="cats" style={{ paddingTop: 10 }}>
          <button className={`cat ${tab === 'bus' ? 'on' : ''}`} onClick={() => { setTab('bus'); setQ(''); }}>Bus stops</button>
          <button className={`cat ${tab === 'metro' ? 'on' : ''}`} onClick={() => { setTab('metro'); setQ(''); }}>Metro stations</button>
        </div>

        <div className="search" style={{ marginTop: 2 }}>
          <Icon n="search" size={17} />
          <input ref={addRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === 'bus' ? 'Stop add karo… jaise "Kashmere Gate"' : 'Station add karo… jaise "Rajiv Chowk"'}
            style={{ padding: '13px 0' }} />
        </div>

        {addedFlash && <div className="tag g" style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon n="check" size={12} /> {addedFlash} save ho gaya
        </div>}

        {hits.length > 0 && (
          <div className="list" style={{ marginTop: 10, maxHeight: 230, overflowY: 'auto' }}>
            {hits.map((n) => (
              <button key={n} className="row" onClick={() => add(n)}
                style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}>
                <Icon n="plus" size={15} style={{ color: 'var(--green)' }} />
                <div className="main"><b style={{ fontSize: 13.5 }}>{n}</b>
                  <span className="dim sm">{tab === 'bus' ? `${routesAt(n).length} routes` : ''}</span></div>
              </button>))}
          </div>)}

        {!q.trim() && (tab === 'bus' ? busSaved.length === 0 : metroSaved.length === 0) && (
          <Empty t={tab === 'bus' ? 'Koi bus stop saved nahi' : 'Koi metro station saved nahi'}
            s={'Upar search karke + dabao — ' + (tab === 'bus' ? 'us stop ki agli buses yahan live dikhengi.' : 'station list mein aa jayega.')} />
        )}
      </Card>

      {tab === 'bus' && busSaved.length > 0 && (
        <Card pad={false} style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="chead" style={{ padding: '13px 14px 6px' }}><Icon n="bus" size={15} /> Next buses at saved stops
            <span className="dim sm">live timetable</span></div>
          {busSaved.map((s) => <BusStopRow key={s.n} stop={s.n} />)}
        </Card>)}

      {tab === 'metro' && metroSaved.length > 0 && (
        <Card pad={false} style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="chead" style={{ padding: '13px 14px 6px' }}><Icon n="metro" size={15} /> Saved metro stations</div>
          {metroSaved.map((s) => <MetroStationRow key={s.n} stop={s.n} />)}
        </Card>)}
    </div>
  );
}
