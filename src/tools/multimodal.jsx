/**
 * Combined metro + bus journey planner.
 *
 * Takes any two points in Delhi and compares real options:
 *   - metro only        (289 stations, 27 interchanges, DMRC fares)
 *   - bus only          (383 routes, 1,036 stops, DTC fares)
 *   - bus → metro → bus (walk to the nearest stop/station of each mode)
 *
 * Then ranks them by FASTEST, CHEAPEST and FEWEST CHANGES so the user can see
 * the trade-off, which is what "sab tarah se dekh sake" asks for.
 * Every number comes from the same verified datasets used by the single-mode
 * planners — nothing is estimated except walking time (5 km/h, stated).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLoc } from '../core/geo';
import * as M from '../core/metro-route';
import * as B from '../core/bus-route';
import { Card, Empty, Spin } from '../ui/kit';
import { StationBuses } from './metro-planner';
import { Icon } from '../ui/icons';
import { trackOfCombo, stepsOf } from '../core/trip';
import { clockOf, departures, latestFor, fmt as clock } from '../core/journey-clock';
import * as CR from '../core/combo-route';
import { TripKit, SoundToggle } from './trip-ui.jsx';
import { play as sound } from '../core/sfx.js';
import { searchMap, geoPlace } from '../core/mapsearch.js';
import { osrmWalk, applyWalk, nearPin, pairKey, anchorFor } from '../core/walkgeo.js';
import TripMap from './trip-map.jsx';

const WALK_KMH = 5;
const walkMin = (km) => Math.round((km / WALK_KMH) * 60);

/** `<input type="time">` speaks "HH:MM"; the planner speaks minutes of the day. */
const toHHMM = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fromHHMM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? Math.min(1439, Math.max(0, (+m[1]) * 60 + (+m[2]))) : null;
};
const MAX_WALK_KM = 1.6;   // ~20 min; beyond this an interchange is unrealistic

/* Search across BOTH datasets so the user can type any landmark. */
function searchAll(q, limit = 8) {
  if (!q?.trim()) return [];
  const s = q.toLowerCase().trim();
  const out = [];
  for (const n of M.stationNames) {
    if (n.toLowerCase().includes(s)) out.push({ n, kind: 'metro' });
    if (out.length >= limit) break;
  }
  for (const n of B.stopNames) {
    if (out.length >= limit * 2) break;
    if (n.toLowerCase().includes(s)) out.push({ n, kind: 'bus' });
  }
  return out.slice(0, limit * 2);
}

const coordOf = (p) => {
  if (!p) return null;
  /* a place from the map search carries its own exact position - do not go looking
     for it in the stop table by name, that is how a precise pin turned into
     "no position" and the panel shrugged */
  if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) return { lat: p.lat, lon: p.lon };
  if (p.kind === 'metro') {
    const s = M.STATIONS.find((x) => x.n === p.n);
    return s ? { lat: s.lat, lon: s.lon } : null;
  }
  const s = B.STOPS.find((x) => x.n === p.n);
  return s ? { lat: s.lat, lon: s.lon } : null;
};

/** What the timetable says about this option at this minute. */
function TimingNote({ o }) {
  const d = o?.detail;
  if (!d) return null;
  const metro = (o?.legs || []).some((l) => l.kind === 'metro');
  const lastGone = metro && d.canMakeIt === false;
  const tight = metro && d.lastTrainLeftIn != null && d.lastTrainLeftIn >= 0 && d.lastTrainLeftIn < 30;
  const busStopped = !metro && d.running === false;
  return (
    <Card>
      <div className="chead"><Icon n="clock" size={16} /> This option right now</div>
      <div className="dim sm">
        {metro
          ? <>Trains on the {d.legs?.[0]?.line || 'line'} run every {d.wait?.[0] ? `${d.wait[0].lo}-${d.wait[0].hi}` : '—'} min{' '}
              {d.wait?.[0]?.peak ? 'at this hour (peak)' : 'at this hour'}, so expect to wait about {d.nextIn} min at the
              platform — about {d.minutesWithWait} min for the rail part of this journey, including that wait.
              {o.legs.some((l) => l.kind === 'bus') ? 'The bus legs are timed by their published departures below.' : ''}</>
          : <>Distance measured along the route each bus drives; {d.changes ? 'two tickets, one per bus.' : 'one ticket.'}</>}
      </div>
      {lastGone && <div className="note">The last train from {d.lastTrainAt} towards {d.lastTrainFrom} has already
        left ({M.fmtTime(d.lastTrain)}). Take a bus or an auto for this one.</div>}
      {tight && <div className="note">Only {d.lastTrainLeftIn} min before the last train leaves {d.lastTrainAt}
        — leave now.</div>}
      {busStopped && <div className="note">One of these buses is outside its published service window right now;
        the first departure is shown in the bus tool.</div>}
    </Card>);
}

const MODE_ICON = {
  Metro: <Icon n="metro" size={17} />,
  Bus: <Icon n="bus" size={17} />,
  'Metro + Bus': <><Icon n="metro" size={17} /><Icon n="bus" size={17} /></>,
};

/**
 * The journeys worth showing, from one search over a graph that holds both
 * modes (core/combo-route.js). `only` picks which sub-graph to search: 'all'
 * lets a bus beat a metro and a metro beat a bus, 'mixed' demands both modes in
 * one journey, 'metro' / 'bus' ask a single mode to prove itself.
 *
 * The array carries `meta` — how many journeys the search found, how many it
 * dropped as slower AND dearer, how long it took — because the panel prints that
 * instead of pretending the list was the whole world.
 */
function buildOptions(a, b, atMin = null, { ac = false, only = 'all' } = {}) {
  const pa = coordOf(a), pb = coordOf(b);
  if (!pa || !pb) {
    /* an empty list still carries its reason: a panel that says nothing looks
       exactly like a city with no buses */
    const out = [];
    out.meta = { tried: 0, dropped: 0, pops: 0, graphSize: null, ac, only,
      note: `Neither "${a?.n}" nor "${b?.n}" has a position in the published data, `
        + 'so no journey can be measured from it.' };
    return out;
  }
  const r = CR.plan({ ...a, ...pa }, { ...b, ...pb }, { atMin, ac, only });
  const out = (r.options || []).map((o) => ({
    ...o,
    mode: o.mix,
    icon: MODE_ICON[o.mix] || MODE_ICON.Bus,
    from: a.n,
    to: b.n,
    /* the exact pins, when the place came off the map - the line on the trip map
       starts and ends here, not at the nearest stop that shares the name */
    fromPos: pa && a.kind === 'geo' ? { lat: pa.lat, lon: pa.lon } : null,
    toPos: pb && b.kind === 'geo' ? { lat: pb.lat, lon: pb.lon } : null,
  }));
  /* mark the two walks every journey opens and closes with, so a measuring pass
     can find them later; a leg whose ends are both places is measured, one
     missing a coordinate simply never gets asked about */
  for (const o of out) {
    const L = o.legs || [];
    const f = L[0], e = L[L.length - 1];
    if (f && f.kind === 'walk') {
      const x = pa || posByName(f.from), y = posByName(f.to);
      if (x && y) f.wpos = [x, y];
    }
    if (e && e.kind === 'walk' && e !== f) {
      const x = posByName(e.from) || (pb && { lat: pb.lat, lon: pb.lon }), y = pb || posByName(e.to);
      if (x && y) e.wpos = [x, y];
    }
  }
  out.meta = { tried: r.tried || 0, dropped: r.dropped || 0, pops: r.pops || 0,
    graphSize: r.graphSize || null, note: r.note || null, ac, only,
    /* what the searches cost, and whether any of them hit their ceiling - the
       ceiling is the one case where "this is the cheapest way" has to be said as
       "the cheapest way we got around to looking for" */
    stats: r.stats || [], capped: (r.stats || []).filter((s) => s.capped).map((s) => `${s.mask}/${s.obj}`),
    ms: (r.stats || []).reduce((x, s) => x + (s.ms || 0), 0),
    anomalies: r.anomalies || [] };
  return out;
}

/* The map search lives inside the picker, under the stops we ship, because it is
   the precise answer to an imprecise box: type "Kali Ghata Arya Samaj Road", press
   the button, and the journey is measured from that doorway - not from the nearest
   bus stop that happens to share the area's name. Nothing about the local list
   changes: this adds a row, it never replaces one. */
const posByName = (n) => {
  if (!n) return null;
  const m = M.STATIONS.find((s) => s.n === n);
  if (m) return { lat: m.lat, lon: m.lon };
  const b = B.STOPS.find((s) => s && s.n === n);
  return b ? { lat: b.lat, lon: b.lon } : null;
};

function Picker({ label, value, onPick, onNear, near, onPin }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState(null);          // {busy} | {hits} | {err}
  const hits = useMemo(() => searchAll(q), [q]);
  const askMap = async () => {
    const query = q.trim();
    if (query.length < 4) return;
    setGeo({ busy: true });
    const r = await searchMap(query, near);
    setGeo(r.ok ? { hits: r.hits, providers: r.providers } : { err: r.why || 'the map service did not answer' });
  };
  return (
    <div className="fld" style={{ position: 'relative' }}><label>{label}</label><div style={{ display: 'flex', gap: 6 }}><input value={open ? q : (value?.n || '')} placeholder="Metro station or bus stop…"
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 180)} /><button className="btn ghost sm" style={{ flex: '0 0 auto' }}
          onMouseDown={(e) => e.preventDefault()} onClick={onNear}><Icon n="pin" size={17} /></button></div>
      {open && (hits.length > 0 || geo || q.trim().length >= 4) && (
        <div className="list" style={{ position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 40, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
          {hits.map((h, i) => (
            <button key={i} className="col" style={{ background: 'none', border: 0,
              textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); setQ(''); }}><b style={{ fontSize: 13.5 }}>{h.kind === 'metro' ? <><Icon n="metro" size={17} /></> : <><Icon n="bus" size={17} /></>} {h.n}</b></button>))}
          {q.trim().length >= 4 && (
            <button className="btn ghost sm geoask" style={{ margin: 6, opacity: geo?.busy ? 0.55 : 1 }}
              onMouseDown={(e) => { e.preventDefault(); if (!geo?.busy) askMap(); }}>
              <Icon n="pin" size={15} /> Search the whole map for "{q.trim().slice(0, 40)}"</button>)}
          <button className="btn ghost sm" style={{ margin: '2px 6px 6px' }}
            onMouseDown={(e) => { e.preventDefault(); if (onPin) onPin(); }}>
            <Icon n="pin" size={14} /> …or drop a pin on the map itself</button>
          {geo?.busy && <div className="dim sm" style={{ padding: '8px 10px' }}>Asking the open map…</div>}
          {geo?.err && (
            <div className="dim sm" style={{ padding: '8px 10px' }}>
              {geo.err} — no internet, or both map services are refusing us; the stop list above still works.
              <button className="btn ghost sm" style={{ marginLeft: 6 }}
                onMouseDown={(e) => { e.preventDefault(); askMap(); }}>Try again</button>
            </div>)}
          {geo && !geo.busy && !geo.err && geo.hits.length === 0 && (
            <div className="dim sm" style={{ padding: '8px 10px' }}>
              Neither map service knows that place — try more words (area + landmark) or pick a stop above.</div>)}
          {(geo?.hits || []).map((h, i) => (
            <button key={`g${i}`} className="col geoitem" style={{ background: 'none', border: 0,
              textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); onPick(geoPlace(h)); setOpen(false); setQ(''); setGeo(null); }}>
              <b style={{ fontSize: 13.5 }}><Icon n="pin" size={15} /> {h.n}</b>
              <span className="dim sm">exact spot · OpenStreetMap</span></button>))}
        </div>)}
    </div>);
}

export function MultiModal() {
  const { loc } = useLoc();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [sort, setSort] = useState('best');          // best | fast | cheap | few
  const [only, setOnly] = useState('all');            // all | mixed | metro | bus
  const [ac, setAc] = useState(false);                // price the bus rides as AC
  const [sel, setSel] = useState(0);
  /* When. 'now' is what the other tools answer; 'leave at' and 'arrive by' are
     what a person actually has to decide. Both are answered from the same
     published data — the metro line's headway and last train at that hour, the
     bus direction's own departure list — never from a guessed schedule. */
  const [when, setWhen] = useState('now');              // 'now' | 'leave' | 'arrive'
  const [leaveAt, setLeaveAt] = useState(null);          // minutes of day, IST
  const [arriveBy, setArriveBy] = useState(null);

  const nowMin = B.minutesOfDay();
  const asked = when === 'leave' && leaveAt != null ? leaveAt : nowMin;

  const options = useMemo(() => {
    if (!from || !to || from.n === to.n) return null;
    const o = buildOptions(from, to, when === 'now' ? null : asked, { ac, only });
    return o.length ? o : [];
  }, [from, to, when, asked, ac, only]);

  /* The measuring pass. Search priced its walks as straight lines because that
     is the only distance it can afford ten thousand times a minute; now that a
     handful of journeys survived ranking, the two end-walks of each are measured
     once along real footpaths and the cards update under the rider's eyes. A
     silent service leaves the estimate standing - stated, not hidden. */
  const [fixes, setFixes] = useState(null);
  const sigRef = useRef('');
  const sig = options && options.length ? `${from?.n}|${to?.n}|${when}|${asked}` : '';
  useEffect(() => {
    if (sigRef.current !== sig) { sigRef.current = sig; setFixes(null); }
  }, [sig]);
  useEffect(() => {
    if (!options || !options.length) return undefined;
    let dead = false;
    (async () => {
      const seen = new Map();
      for (const o of options) for (const l of o.legs || []) {
        if (l.wpos && l.wpos[0] && l.wpos[1]) {
          const k = pairKey(l.wpos[0], l.wpos[1]);
          if (!seen.has(k) && seen.size < 8) seen.set(k, osrmWalk(l.wpos[0], l.wpos[1]));
        }
      }
      if (!seen.size) return;
      const got = new Map();
      await Promise.all([...seen.entries()].map(async ([k, pr]) => {
        const f = await pr; if (f && !dead) got.set(k, f);
      }));
      if (!dead && got.size) setFixes(got);
    })();
    return () => { dead = true; };
  }, [options]);
  const measured = useMemo(() => applyWalk(options, fixes), [options, fixes]);

  const ranked = useMemo(() => {
    if (!measured?.length) return [];
    const c = [...measured];
    if (sort === 'cheap') c.sort((a, b) => a.fare - b.fare || a.minutes - b.minutes);
    else if (sort === 'few') c.sort((a, b) => a.changes - b.changes || a.minutes - b.minutes);
    else if (sort === 'fast') c.sort((a, b) => a.minutes - b.minutes || a.fare - b.fare);
    else c.sort((a, b) => (a.value ?? a.minutes + a.fare / CR.VOT_RPM)
      - (b.value ?? b.minutes + b.fare / CR.VOT_RPM));
    return c;
  }, [measured, sort]);

  const o = ranked[sel] || ranked[0];
  /* "Arrive by" is solved backwards: the latest departure that still makes it,
     then the whole card is re-clocked at the minute the solver chose. */
  const solve = when === 'arrive' && arriveBy != null && o ? latestFor(o, arriveBy) : null;
  const runMin = solve ? solve.departMin : asked;
  const clk = o ? clockOf(o, runMin) : null;
  const grid = o ? departures(o, runMin, 5, 15) : [];
  /* Sound. A place being picked is a train going past; a journey being worked
     out is the announcement chime; a plan the timetable cannot support is an air
     brake. All six are synthesised in the browser (core/sfx.js) — no file is
     fetched, so nothing here costs a byte of network or a line of offline cache. */
  const sawJourney = useRef(false);
  useEffect(() => {
    const has = ranked.length > 0;
    if (has && !sawJourney.current) sound('chime', { delay: 0.42 });
    sawJourney.current = has;
  }, [ranked.length]);
  const refused = when === 'arrive' && arriveBy != null && !!o && !solve;
  useEffect(() => { if (refused) sound('brake'); }, [refused]);

  /* Near me used to mean "the nearest published stop, which you then had to walk
     to somewhere the app could not see". It now means the spot itself: the browser
     knows the coordinates, the map service knows a street name for them, and the
     planner measures the walk from the doorway. When naming fails the pin still
     lands - coordinates as a label are true; a borrowed station name is not. */
  const near = async (setter) => {
    if (!loc || !Number.isFinite(loc.lat)) return;
    const pin = await nearPin(loc.lat, loc.lon);
    if (pin) { setter(pin); return; }
    const m = M.nearestStations(loc.lat, loc.lon, 1)[0];
    const bs = B.nearestStops(loc.lat, loc.lon, 1)[0];
    if (m && bs) setter(m.km <= bs.km ? { n: m.n, kind: 'metro' } : { n: bs.n, kind: 'bus' });
    else if (m) setter({ n: m.n, kind: 'metro' });
    else if (bs) setter({ n: bs.n, kind: 'bus' });
  };

  /* rank map hits toward the other end of the journey when there is one, else
     toward where the rider is standing - "DLF drycleaning" two km away should
     outrank a namesake twenty km off */
  const geoNear = (fallback) => {
    const other = fallback ? coordOf(fallback) : null;
    if (other) return other;
    return loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lon: loc.lon } : null;
  };
  /* drop-a-pin: a map centred on the other end (or on the rider) where a tap IS
     the place - for the gully, tower or gate that no geocoder has a name for.
     The reverse lookup only decorates it; the coordinate is the promise. */
  const [pin, setPin] = useState(null);
  const openPin = (which) => {
    /* anchored: other end first, own position only if it is in the network's
       neighbourhood, else Delhi itself - an IP geolocate that lands the map in
       another country is a bug the rider would pay for, not a fact to obey */
    const c = anchorFor(which === 'from' ? coordOf(to) : coordOf(from), loc);
    setPin({ which, center: c, marker: null, name: '' });
  };
  useEffect(() => {
    if (!pin || !pin.marker || pin.name) return undefined;
    let dead = false;
    nearPin(pin.marker.lat, pin.marker.lon).then((p) => {
      if (!dead && p) setPin((q) => (q && q.marker === pin.marker ? { ...q, name: p.n } : q));
    });
    return () => { dead = true; };
  }, [pin && pin.marker]);
  return (<><Picker label="From" value={from} onPick={(v) => { sound('whoosh'); setFrom(v); setSel(0); }}
      near={geoNear(to)} onPin={() => { sound('tick'); openPin('from'); }} onNear={() => { sound('whoosh'); near(setFrom); }} /><div style={{ textAlign: 'center', margin: '-4px 0 4px' }}><button className="btn ghost sm" onClick={() => { sound('tick'); const a = from; setFrom(to); setTo(a); setSel(0); }}>⇅ Swap</button></div><Picker label="To" value={to} onPick={(v) => { sound('whoosh'); setTo(v); setSel(0); }}
      near={geoNear(from)} onPin={() => { sound('tick'); openPin('to'); }} onNear={() => { sound('whoosh'); near(setTo); }} />

    {pin && (<div className="card" style={{ marginBottom: 10 }}>
      <div className="chead" style={{ fontSize: 11 }}>Tap the map where you mean · {pin.which === 'from' ? 'start' : 'destination'}</div>
      <TripMap points={[]} pick={{ center: pin.center, marker: pin.marker,
        onPick: (lat, lon) => { sound('tick'); setPin((q) => ({ ...q, marker: { lat, lon }, name: '' })); } }}
        height={240} />
      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
        <span className="sm" style={{ flex: 1, minWidth: 0 }}>
          {pin.marker ? (pin.name || `${pin.marker.lat.toFixed(4)}, ${pin.marker.lon.toFixed(4)} — naming…`)
                      : 'No pin yet — tap anywhere on the map above.'}
        </span>
        <button className="btn ghost sm" onClick={() => { sound('tick'); setPin(null); }}>Cancel</button>
        <button className="btn sm" disabled={!pin.marker} onClick={() => {
          if (!pin.marker) return;
          sound('whoosh');
          const lat = +pin.marker.lat, lon = +pin.marker.lon;
          (pin.which === 'from' ? setFrom : setTo)({
            n: pin.name || `Dropped pin · ${lat.toFixed(4)}, ${lon.toFixed(4)}`, kind: 'geo', lat, lon });
          setSel(0); setPin(null);
        }}>Use it</button>
      </div>
    </div>)}

    {(!from || !to) && <Empty t="Pick a start and destination — metro stations, bus stops, map searches and dropped pins all work" />}
    {/* The questions stay on screen even when one of them has no answer: a filter
        that empties the panel must still be changeable, or the traveller is stuck
        in the empty result and has to start the whole search again. */}
    {options && (<><div className="btnrow">
        {[['best', ' Best overall'], ['fast', ' Fastest'], ['cheap', ' Cheapest'], ['few', ' Fewest changes']].map(([v, l]) => (
          <button key={v} className={`cat ${sort === v ? 'on' : ''}`}
            onClick={() => { sound('tick'); setSort(v); setSel(0); }}
            title={v === 'best'
              ? `Minutes, plus ₹${CR.VOT_RPM} for every minute saved — the trade-off the search ranks by`
              : v === 'few' ? 'Fewest vehicle changes, then the shortest ride' : undefined}>{l}</button>))}
      </div><div className="btnrow">
        {/* one search over both modes; these say what that search may use. 'Both' is
            the honest default: a bus is allowed to win, and so is the metro. */}
        {[['all', 'Both, whichever wins'], ['mixed', 'Metro + bus, both'], ['metro', 'Metro only'], ['bus', 'Bus only']].map(([v, l]) => (
          <button key={v} className={`cat ${only === v ? 'on' : ''}`}
            onClick={() => { sound('tick'); setOnly(v); setSel(0); }}
            title={v === 'mixed' ? 'Only journeys that use a bus and the metro in the same trip' : undefined}>{l}</button>))}
        <button className={`cat ${ac ? 'on' : ''}`} onClick={() => { sound('tick'); setAc(!ac); setSel(0); }}
          title="Prices every bus ride on the DTC AC slab instead of the ordinary one">AC bus</button>
      </div><div className="btnrow trow">
        {[['now', 'Now'], ['leave', 'Leave at'], ['arrive', 'Arrive by']].map(([v, l]) => (
          <button key={v} className={`cat ${when === v ? 'on' : ''}`} onClick={() => {
            sound('tick'); setWhen(v); setSel(0);
            if (v === 'leave' && leaveAt == null) setLeaveAt(Math.ceil((nowMin + 5) / 5) * 5 % 1440);
            if (v === 'arrive' && arriveBy == null) setArriveBy(Math.ceil((nowMin + 45) / 5) * 5 % 1440);
          }}>{l}</button>))}
        {when === 'leave' && <input className="tinp" type="time" aria-label="Departure time"
          value={toHHMM(leaveAt)} onChange={(e) => setLeaveAt(fromHHMM(e.target.value))} />}
        {when === 'arrive' && <input className="tinp" type="time" aria-label="Arrival time"
          value={toHHMM(arriveBy)} onChange={(e) => setArriveBy(fromHHMM(e.target.value))} />}
      </div></>)}

    {options?.length === 0 && (
      <Empty t={only === 'mixed'
        ? 'In this data no journey needs both a bus and the metro here — the metro-only and bus-only answers are under Both, whichever wins'
        : options?.meta?.note || 'No metro or bus route found between these two points'} />)}

    {ranked.length > 0 && (<><div className="cats" style={{ marginTop: 10 }}>
        {ranked.map((x, i) => (
          <button key={i} className={`cat ${sel === i ? 'on' : ''}`} onClick={() => { sound('tick'); setSel(i); }}>
            {x.icon} {x.minutes}m · ₹{x.fare}
          </button>))}
      </div><Card><div className="chead">{o.icon} {o.mode} · {from.n} → {to.n}</div><div className="g3"><div className="stat"><div className="v">{o.minutes}</div><div className="l">Minutes</div></div><div className="stat"><div className="v">₹{o.fare}</div><div className="l">Fare</div></div><div className="stat"><div className="v">{o.changes}</div><div className="l">Changes</div></div></div><div className="g2" style={{ marginTop: 8 }}><div className="stat"><div className="v">{o.km}</div><div className="l">km total</div></div><div className="stat"><div className="v">{o.walkMin}</div><div className="l">min walking</div></div></div></Card>

      {o && clk && clk.legs.length > 0 && (
        <Card>
          <div className="chead"><Icon n="clock" size={16} /> {when === 'arrive' ? 'Leave by' : 'Your clock'}
            {' '}{clock(clk.departMin)} → {clock(clk.arriveMin)}{clk.afterMidnight ? ' next day' : ''}</div>
          <div className="g3">
            <div className="stat"><div className="v">{clock(clk.departMin)}</div>
              <div className="l">{when === 'arrive' ? 'Leave by' : 'You leave'}</div></div>
            <div className="stat"><div className="v">{clock(clk.arriveMin)}</div>
              <div className="l">Arrive</div></div>
            <div className="stat"><div className="v">{clk.minutes}</div>
              <div className="l">min, {clk.waitMin} of it waiting</div></div>
          </div>

          <div className="tl" role="img"
            aria-label={clk.legs.map((l) => `${l.label} ${l.mins == null ? 'unknown' : l.mins + ' min'}`).join(', ')}>
            {clk.legs.map((l, i) => (
              <div key={i} className={`tlseg ${l.kind}${l.mode ? ' ' + l.mode : ''}`}
                style={{ flexGrow: Math.max(0.7, l.mins || 0.7), flexBasis: 0,
                  background: l.kind === 'ride' && l.colour ? l.colour : undefined }}
                title={`${l.label} · ${l.mins == null ? 'no published time' : l.mins + ' min'} · ${clock(l.from)}`
                  + (l.why ? ` · ${l.why}` : '')}>
                <b>{l.mins == null ? '?' : l.mins}</b>
              </div>))}
          </div>
          <div className="tlkeys">
            {clk.legs.map((l, i) => (
              <span key={i} className="tlkey">
                <i style={{ background: l.kind === 'ride' && l.colour ? l.colour
                  : l.kind === 'allowance' ? 'var(--fg3)'
                  : l.kind === 'wait' ? 'var(--warn)' : l.kind === 'walk' ? 'var(--fg3)' : 'var(--green)' }} />
                {l.kind === 'walk' ? 'walk'
                  : l.kind === 'allowance' ? l.label
                  : l.kind === 'wait' ? l.label
                  : l.mode === 'metro' ? `ride ${l.line}` : `bus ${l.label}`}
                <span className="dim sm">{clock(l.from)}</span>
              </span>))}
          </div>

          {clk.risk.map((r, i) => <div key={i} className={`note ${r.kind === 'closed' || r.kind === 'over' ? 'warn' : ''}`}>
            {r.text}</div>)}

          <div className="dim sm" style={{ marginTop: 8 }}>
            Bus legs use that direction's published departures — the {clk.waitMin} min waiting here is a printed
            time, not an estimate. Metro waits use the line's published headway for this hour. Walking is
            5 km/h. Nothing here is a live vehicle position.
          </div>

          {grid.length > 1 && (<>
            <div className="chead" style={{ marginTop: 12 }}>Other departures from now</div>
            <div className="btnrow tight">
              {grid.map((g) => (
                <button key={g.departMin} className={`cat ${g.departMin === runMin ? 'on' : ''}`}
                  onClick={() => { sound(g.blocked ? 'brake' : 'tick'); setWhen('leave'); setLeaveAt(g.departMin); }}>
                  {clock(g.departMin)} → {clock(g.arriveMin)}
                  <span className="dim sm"> {g.minutes}m{g.blocked ? ', no service then' : ''}</span>
                </button>))}
            </div>
          </>)}
        </Card>)}

      {when === 'arrive' && o && arriveBy != null && !solve && (
        <div className="note">Nothing in these options reaches {to.n} by {clock(arriveBy)} — leaving now,
          the earliest arrival is {clock(clk ? clockOf(o, nowMin).arriveMin : null)}.</div>)}

      <TimingNote o={o} />

      {/* comparison table */}
      {ranked.length > 1 && (
        <><div className="chead" style={{ marginTop: 14 }}>Compare all options</div><div className="list">
            {ranked.map((x, i) => (
              <button key={i} className="row" style={{ background: i === sel ? 'rgba(0,255,156,.07)' : 'none',
                border: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setSel(i)}><span style={{ fontSize: 17 }}>{x.icon}</span><div className="main"><b style={{ fontSize: 13 }}>{x.mode}</b><span className="dim sm">{x.changes} change{x.changes !== 1 ? 's' : ''} · {x.km} km · {x.walkMin} min walk</span></div><div className="end"><b>{clock(clockOf(x, runMin).arriveMin)}</b><br />
                  <span className="dim sm">{x.minutes} min</span><br /><span style={{ color: 'var(--green)', fontSize: 12 }}>₹{x.fare}</span></div></button>))}
          </div></>)}

      {o.mode === 'Metro' && <StationBuses station={from.n} />}

      {o && (() => {
        const track = trackOfCombo(o, { boardMin: clk?.boardMin ?? null });
        return track.points.length > 1 ? (
          <Card>
            <TripKit track={track} steps={stepsOf(track)} boardMin={clk?.boardMin ?? null} />
            <div className="dim sm" style={{ marginTop: 8 }}>
              The alert watches every published stop of every leg in this order, so it also
              knows when you have reached the metro station the bus leaves you at.
            </div>
          </Card>) : null;
      })()}

      <div className="chead" style={{ marginTop: 14 }}>Step by step</div><div className="list">
        {o.legs.map((l, i) => (
          <div className="col" key={i}>
            {l.kind === 'walk' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon n="walk" size={16} /><div className="main"><b style={{ fontSize: 13 }}>{l.text}</b><span className="dim sm">{l.km} km · about {l.min} min</span></div></div>
            ) : l.kind === 'metro' ? (
              <><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 12, height: 12, borderRadius: 3, flex: '0 0 auto',
                    background: l.colour || 'var(--green)' }} /><b style={{ flex: 1 }}><Icon n="metro" size={17} /> {l.line}</b><span className="tag">{l.count} stops</span></div><span className="dim sm" style={{ paddingLeft: 21 }}>{l.from} → {l.to} · {l.km} km</span></>
            ) : (
              <><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ padding: '3px 9px', borderRadius: 8, background: 'var(--s3)',
                    color: 'var(--green)', fontWeight: 800, fontSize: 12.5 }}>{l.ref}</span><b style={{ flex: 1, fontSize: 13 }}><Icon n="bus" size={17} /> Bus</b><span className="tag">{l.count} stops</span></div><span className="dim sm" style={{ paddingLeft: 4 }}>{l.from} → {l.to} · {l.km} km</span></>)}
          </div>))}
      </div><div className="src"><span className="dot" /><span>
          Metro: {M.STATIONS.length} stations on {M.LINES.length} line records, DMRC slabs and published headways.
          Bus: {B.ROUTES.length} published directions over {B.STOPS.length} physical stops, DTC slabs.
          {measured?.some((x) => x.measuredWalk)
            ? <>Walking time at {WALK_KMH} km/h on public footpaths; interchange walks use published distances.</>
            : <>Walking estimated at {WALK_KMH} km/h in a straight line.</>}{''}
          {(from?.kind === 'geo' || to?.kind === 'geo') && <> One end was found by map search —{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>{' '}
            contributors, ODbL; the walk, the ride and the fare are still ours to compute.</>}{''} Nothing here is a live vehicle position: the wait is the
          published headway and the bus time is the published timetable.{options?.meta && <>
          {' '}One search over {(options.meta.graphSize?.bus || 0) + (options.meta.graphSize?.metro || 0)
            + (options.meta.graphSize?.walk || 0) || 'the published stops'} published connections found{' '}
          {options.meta.tried} usable journey{options.meta.tried === 1 ? '' : 's'} and set aside{' '}
          {options.meta.dropped} that {options.meta.dropped === 1 ? 'was' : 'were'} both slower and dearer —{' '}
          {options.meta.only === 'all' ? 'metro and bus searched together'
            : options.meta.only === 'mixed' ? 'only journeys using both modes'
            : `only ${options.meta.only}`}, {options.meta.ac ? 'AC' : 'ordinary'} bus fares.
          {(options.meta.ms || 0) > 0 && <> Searched in {options.meta.ms} ms
            ({options.meta.stats.length} question{(options.meta.stats.length || 0) === 1 ? '' : 's'}
            {options.meta.stats.length ? `: ${options.meta.stats.map((s) => `${s.obj} ${s.ms}ms`).join(', ')}` : ''}).</>}
          {options.meta.capped?.length && <> The {options.meta.capped.join(' and ')} search ran out of
            {' '}road before it had looked everywhere, so a cheaper way may exist that it never reached.</>}
          {options.meta.anomalies?.length ? <> {options.meta.anomalies.length} candidate
            {options.meta.anomalies.length === 1 ? ' was' : 's were'} left out because the walk it assumed
            does not match the map{process.env.NODE_ENV === 'development' ? ` (${options.meta.anomalies[0]})` : ''}.</> : null}</>}</span></div></>)}

      {/* last, so a panel about journeys does not open with a settings row — but
          always present, so the sounds can be silenced before anything is searched */}
      <SoundToggle />
  </>);
}
