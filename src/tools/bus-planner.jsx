/**
 * Delhi bus: journey planner, live timetable panel, route explorer, fares.
 *
 * DISTANCE AND FARE CORRECTNESS
 *   · Every direction now carries the operator's own polyline, and each of its
 *     stops is projected onto it. The journey length is |m[b] - m[a]| — the
 *     distance the bus actually drives — measured against OSRM on whole routes
 *     to a median ratio of 1.00 (see scripts/verify_transit_data.py). Only the
 *     few routes whose page had no polyline fall back to straight line x 1.28,
 *     and for those the exact road distance is fetched live and the fare is
 *     recomputed from it.
 *   · A journey with a change is TWO tickets, so leg fares are added.
 *   · Stops that merely share a name are separate physical places, keyed by
 *     name AND position, which is what stopped distances inflating.
 *
 * "RIGHT NOW" comes from the published timetable of that exact direction: the
 * next departure from the terminal, and the leg's boarding stop reached at the
 * published running time after it. No live vehicle feed is publicly available
 * for DTC, so no vehicle position is invented or implied.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLoc } from '../core/geo';
import { planBus, searchStops, isStop, routesAt, nearestStops, refineFare,
         fareSlab, busFare, childFare, feederFare, PASSES, ROAD_FACTOR, FARE_TABLE,
         ROUTES, STOPS, BUILT, STATS, nameOf, routeStops,
         nextAtStop, statusNow, headwayNow, minutesOfDay, fmtTime, routeLength } from '../core/bus-route';
import { metroNearStop } from '../core/transit-link';
import { trackOfBus, stepsOf } from '../core/trip';
import { TripKit } from './trip-ui.jsx';
import { play as sound } from '../core/sfx.js';
import { Card, Empty } from '../ui/kit';
import { Icon } from '../ui/icons';

/** When the next bus on this leg reaches the boarding stop, from its timetable. */
function LegDue({ leg }) {
  const [now] = useState(() => new Date());
  const rec = ROUTES[leg.ri];
  if (!rec || leg.i0 == null) return null;
  const due = nextAtStop(rec, leg.i0, now, 2);
  const st = statusNow(rec, now);
  const hw = headwayNow(rec, minutesOfDay(now));
  if (!due.length) {
    return (
      <div className="dim sm" style={{ marginTop: 6 }}>
        {st.state === 'closed' || st.state === 'before'
          ? `No bus left on this direction right now; service starts ${fmtTime(st.opens)}.`
          : 'The last bus on this direction has already left.'}
      </div>);
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
      <span className="dim sm">Next at {leg.from}:</span>
      {due.map((d, i) => <span key={i} className="tag c" style={{ fontSize: 11 }}>{fmtTime(d.at)}</span>)}
      <span className="tag g">{due[0].mins} min</span>
      {hw.lo && <span className="dim sm">{hw.peak ? 'peak' : 'then'} {hw.lo}-{hw.hi} min</span>}
    </div>);
}

function StopPicker({ label, value, onPick, onNear }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchStops(q, 8), [q]);
  return (
    <div className="fld" style={{ position: 'relative' }}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <div className="ip-wrap" style={{ flex: 1 }}>
          <Icon n="search" size={16} />
          <input value={open ? q : value} placeholder="Search bus stop…"
            onFocus={() => { setOpen(true); setQ(''); }}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 180)} />
        </div>
        <button className="btn ghost sm" style={{ flex: '0 0 auto' }} title="Nearest stop"
          onMouseDown={(e) => e.preventDefault()} onClick={onNear}><Icon n="pin" size={17} /></button>
      </div>
      {open && hits.length > 0 && (
        <div className="list" style={{ position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 40, marginTop: 4, maxHeight: 250, overflowY: 'auto' }}>
          {hits.map((h) => (
            <button key={h} className="col" style={{ background: 'none', border: 0,
              textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); setQ(''); }}>
              <b style={{ fontSize: 13.5 }}>{h}</b>
              <span className="dim sm">{routesAt(h).length} routes</span>
            </button>))}
        </div>)}
    </div>);
}

/** Nearest metro station to a bus stop, with the lines — the datasets joined. */
function MetroForStop({ stop }) {
  const near = useMemo(() => metroNearStop(stop, 1.2), [stop]);
  if (!near.length) return null;
  return (
    <Card>
      <div className="chead"><Icon n="metro" size={16} /> Metro from {stop}</div>
      {near.map((s) => (
        <div className="kv" key={s.n}>
          <span>{s.n} <span className="dim sm">{s.lines.join(' · ')}</span></span>
          <b style={{ color: 'var(--cyan)' }}>{(s.km * 1000).toFixed(0)} m</b>
        </div>))}
      <div className="dim sm" style={{ marginTop: 6 }}>Within a 15-minute walk. The Metro tool plans the ride
        from there with the same data.</div>
    </Card>);
}

export function BusPlanner() {
  const { loc } = useLoc();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sel, setSel] = useState(0);
  const [expand, setExpand] = useState(false);
  const [ac, setAc] = useState(false);
  const [exact, setExact] = useState(null);     // refined copy of the options
  const [refining, setRefining] = useState(false);

  const base = useMemo(() => {
    if (!isStop(from) || !isStop(to) || from === to) return null;
    try { return planBus(from, to); } catch { return null; }
  }, [from, to]);

  /* Fetch the exact road distance for the shown options, then recompute the
     fare from it. Estimates are shown instantly so nothing ever blocks. */
  useEffect(() => {
    setExact(null);
    if (!base?.length) return;
    // options whose length already came from the driven polyline need no
    // network round trip — measuring them again would only add an excuse to fail
    const need = base.slice(0, 3).map((o, i) => (!o.exact ? i : -1)).filter((i) => i >= 0);
    if (!need.length) return;
    let live = true;
    setRefining(true);
    (async () => {
      const copies = need.map((i) => JSON.parse(JSON.stringify(base[i])));
      const done = await Promise.all(copies.map((o) => refineFare(o).catch(() => null)));
      if (!live) return;
      const map = new Map();
      need.forEach((idx, k) => map.set(idx, done[k]));
      setExact(base.slice(0, 3).map((o, i) => map.get(i) || o));
      setRefining(false);
    })();
    return () => { live = false; };
  }, [base]);

  const options = exact && exact.length ? [...exact, ...base.slice(exact.length)] : base;
  const o = options?.[sel];
  const useNear = (setter) => {
    const n = nearestStops(loc.lat, loc.lon, 1)[0];
    if (n) setter(n.n);
  };
  // roadKm only exists when OSRM refined the estimate; otherwise the offline
  // figure is the one to show (shape distance or straight line, per o.src)
  const km = o ? (o.roadKm ?? o.estKm ?? o.km ?? 0) : 0;
  const slab = o ? fareSlab(km, ac) : null;

  /* the trip the alert engine will watch: first leg's next published arrival at
     the boarding stop is its start minute, every later stop is derived off it */
  const trip = useMemo(() => {
    if (!o?.legs?.length) return null;
    const leg = o.legs[0];
    const rec = ROUTES[leg.ri];
    const due = rec && leg.i0 != null ? nextAtStop(rec, leg.i0, new Date(), 1)[0] : null;
    const track = trackOfBus(o, { boardMin: due ? due.at : null });
    return { track, steps: stepsOf(track), boardMin: due ? due.at : null, due };
  }, [o]);

  return (<>
    <StopPicker label="From" value={from} onPick={(v) => { sound('whoosh'); setFrom(v); setSel(0); }}
      onNear={() => useNear(setFrom)} />
    <div style={{ textAlign: 'center', margin: '-4px 0 4px' }}>
      <button className="btn ghost sm" onClick={() => { const a = from; setFrom(to); setTo(a); setSel(0); }}>
        <Icon n="swap" size={15} /> Swap</button>
    </div>
    <StopPicker label="To" value={to} onPick={(v) => { sound('whoosh'); setTo(v); setSel(0); }}
      onNear={() => useNear(setTo)} />
    <div className="btnrow">
      <button className={`cat ${!ac ? 'on' : ''}`} onClick={() => setAc(false)}>Non-AC</button>
      <button className={`cat ${ac ? 'on' : ''}`} onClick={() => setAc(true)}>AC bus</button>
    </div>

    {(!from || !to) && <Empty t="Pick a start and destination stop" />}
    {from && to && !options && <Empty t="No direct or one-change bus found between these stops" />}

    {options?.length > 0 && (<>
      {options.length > 1 && (
        <div className="cats" style={{ marginTop: 12 }}>
          {options.map((x, i) => (
            <button key={i} className={`cat ${sel === i ? 'on' : ''}`} onClick={() => setSel(i)}>
              {x.legs.map((l) => l.ref).join(' + ')}
            </button>))}
        </div>)}

      <Card>
        <div className="chead">{o.legs[0].from} → {o.legs.at(-1).to}</div>
        <div className="big gradtext">₹{ac ? o.fareAc : o.fare}</div>
        <div className="dim sm" style={{ marginTop: -4 }}>
          {o.changes > 0
            ? `${o.legs.map((l) => `₹${ac ? l.fareAc : l.fare}`).join(' + ')} — one ticket per bus`
            : 'single ticket'}
          {' · '}child ₹{o.fareChild}
        </div>

        <div className="g3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="v">{o.minutes}</div><div className="l">Minutes</div></div>
          <div className="stat"><div className="v">{o.stops}</div><div className="l">Stops</div></div>
          <div className="stat"><div className="v">{o.changes}</div><div className="l">Changes</div></div>
        </div>
        <div className="g2" style={{ marginTop: 8 }}>
          <div className="stat">
            <div className="v">{km.toFixed(1)}</div>
            <div className="l">km {o.exact ? 'by road' : 'estimated'}</div>
          </div>
          <div className="stat"><div className="v">₹{ac ? o.fare : o.fareAc}</div>
            <div className="l">{ac ? 'Non-AC' : 'AC bus'}</div></div>
        </div>

        {slab?.nextAt && (
          <div className="note">
            This journey is in the {slab.lo}–{slab.hi} km slab. The fare rises past {slab.nextAt} km.
          </div>)}

        <div className="src"><span className="dot" />
          <span>{o.exact
            ? 'Distance measured along the actual road route (OSRM), so the slab is exact.'
            : refining
              ? 'Showing an estimate — measuring the exact road distance…'
              : `Estimated as straight line × ${ROAD_FACTOR} (measured median for Delhi).`}
          {' '}Women travel free on DTC &amp; cluster buses with the pink ticket.</span></div>
      </Card>

      <div className="chead" style={{ marginTop: 16 }}>Your journey</div>
      <div className="list">
        {o.legs.map((leg, i) => (
          <div className="col" key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span className="busref">{leg.ref}</span>
              <span className="dim sm" style={{ flex: 1 }}>{leg.dir}</span>
              <span className="tag">₹{ac ? leg.fareAc : leg.fare}</span>
            </div>
            <div style={{ marginTop: 6, paddingLeft: 4 }}>
              <div style={{ fontSize: 13.5 }}><b>{leg.from}</b></div>
              <div className="dim sm" style={{ margin: '3px 0' }}>
                ↓ {(leg.roadKm ?? leg.km ?? 0).toFixed(1)} km · {leg.stops} stops
                {leg.timed ? ` · first ${fmtTime(leg.first)} · last ${fmtTime(leg.last)}` : ''}
              </div>
              <div style={{ fontSize: 13.5 }}><b>{leg.to}</b></div>
            </div>
            <LegDue leg={leg} />
            {i < o.legs.length - 1 && (
              <div className="changebar">
                <Icon n="swap" size={15} /> Change at {leg.to} — buy a new ticket
              </div>)}
          </div>))}
      </div>

      {trip?.track && (
        <Card>
          <TripKit track={trip.track} steps={trip.steps} boardMin={trip.boardMin} />
          <div className="dim sm" style={{ marginTop: 8 }}>
            {trip.due
              ? `Counting from ${fmtTime(trip.due.at)} at ${o.legs[0].from}${o.legs[0].timed ? '' : ' (no published timetable, using the service window)'}.`
              : 'No departure is published for this hour, so an alert would be timing guesswork — the map still shows the ride.'}
          </div>
        </Card>)}

      <MetroForStop stop={from} />
      <MetroForStop stop={to} />

      <button className="btn ghost" style={{ width: '100%', marginTop: 12 }}
        onClick={() => setExpand(!expand)}>
        <Icon n="list" size={16} /> {expand ? 'Hide' : 'Show'} every stop
      </button>
      {expand && o.legs.map((leg, li) => (
        <div key={li}>
          <div className="chead" style={{ marginTop: 10 }}>Bus {leg.ref}</div>
          <div className="list">
            {(leg.names || leg.path).map((s, i, arr) => (
              <div className="row" key={i} style={{ padding: '8px 14px' }}>
                <span style={{ width: 20, textAlign: 'center', flex: '0 0 auto',
                  color: i === 0 || i === arr.length - 1 ? 'var(--green)' : 'var(--fg3)' }}>
                  {i === 0 || i === arr.length - 1 ? '◉' : '•'}</span>
                <div className="main"><b style={{ fontSize: 12.5 }}>{s}</b></div>
                <span className="dim sm">{i}</span>
              </div>))}
          </div>
        </div>))}

      <div className="src"><span className="dot" />
        <span>{STATS.route_records || ROUTES.length} route directions · {STOPS.length} physical stops ·{' '}
        {STATS.with_timetable || 0} with a published timetable (built {BUILT}).{' '}
        {o.exact ? 'Distance is measured along the route the bus drives.' : 'Distance refined against the actual road network.'}</span></div>
    </>)}
  </>);
}

/* ------------------------------------------------------------ route explorer */
export function BusRoutesList() {
  const { loc } = useLoc();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const near = useMemo(() => nearestStops(loc.lat, loc.lon, 4), [loc.lat, loc.lon]);
  const list = useMemo(() => {
    const s = q.toLowerCase().trim();
    const out = [];
    const seen = new Set();
    for (const r of ROUTES) {
      if (s && !(r.r.toLowerCase().includes(s) || r.f.toLowerCase().includes(s) ||
                 r.t.toLowerCase().includes(s) || (r.o || '').toLowerCase().includes(s))) continue;
      const k = r.r + '|' + r.f;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= 50) break;
    }
    return out;
  }, [q]);

  return (<>
    <Card>
      <div className="chead"><Icon n="pin" size={16} /> Bus stops near you</div>
      {near.map((s) => (
        <div className="kv" key={s.n}>
          <span>{s.n}</span>
          <b style={{ color: 'var(--green)' }}>
            {s.km < 1 ? `${Math.round(s.km * 1000)} m` : `${s.km.toFixed(1)} km`}
            <span className="dim sm" style={{ marginLeft: 6, fontWeight: 400 }}>
              {routesAt(s.n).length} routes</span>
          </b>
        </div>))}
    </Card>

    <div className="fld" style={{ marginTop: 14 }}>
      <label>Search {ROUTES.length} routes</label>
      <div className="ip-wrap">
        <Icon n="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Route number or terminal, e.g. 764" />
      </div>
    </div>

    <div className="list">
      {list.map((r, i) => (
        <div key={i}>
          <button className="col" style={{ background: 'none', border: 0, width: '100%',
            textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setOpen(open === i ? null : i)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span className="busref">{r.r}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 12.5, display: 'block' }}>{r.f} → {r.t}</b>
                <span className="dim sm">{r.s.length} stops · {routeLength(r)} km
                  {r.o ? ` · ${r.o}` : ''}{r.mins ? ` · ${r.mins} min` : ''}</span>
              </div>
              {(() => { const s = statusNow(r); return s.next?.[0] != null
                ? <span className="tag g">{fmtTime(s.next[0])}</span>
                : <span className="tag w">between buses</span>; })()}
              <Icon n="chevron" size={15} style={{ opacity: .5, transform: open === i ? 'rotate(90deg)' : '' }} />
            </div>
          </button>
          {open === i && (
            <div style={{ padding: '0 14px 12px' }}>
              {routeStops(r).map((s, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
                  <span className="dim" style={{ width: 22 }}>{j + 1}</span>
                  <span>{s}</span>
                </div>))}
            </div>)}
        </div>))}
    </div>
  </>);
}

/* ---------------------------------------------------------------- fares tab */
export function BusFares() {
  const [km, setKm] = useState(8);
  return (<>
    <Card>
      <div className="chead"><Icon n="fare" size={16} /> Fare for a distance</div>
      <div className="fld">
        <label>Distance travelled: <b style={{ color: 'var(--green)' }}>{km} km</b></label>
        <input type="range" min="1" max="40" value={km} onChange={(e) => setKm(+e.target.value)} />
      </div>
      <div className="g3">
        <div className="stat"><div className="v">₹{busFare(km)}</div><div className="l">Non-AC</div></div>
        <div className="stat"><div className="v">₹{busFare(km, true)}</div><div className="l">AC</div></div>
        <div className="stat"><div className="v">₹{childFare(km)}</div><div className="l">Child 5-12</div></div>
      </div>
      <div className="g2" style={{ marginTop: 8 }}>
        <div className="stat"><div className="v">₹{feederFare(km)}</div><div className="l">Metro feeder</div></div>
        <div className="stat"><div className="v">FREE</div><div className="l">Women (pink ticket)</div></div>
      </div>
    </Card>

    <Card>
      <div className="chead">Official slabs</div>
      {[['Ordinary (green / orange)', FARE_TABLE.ordinary],
        ['Air-conditioned (red)', FARE_TABLE.ac],
        ['Child 5-12, ordinary', FARE_TABLE.child_ordinary],
        ['Metro feeder', FARE_TABLE.feeder]].map(([name, rows]) => (
        <div key={name}>
          <div className="chead sm" style={{ marginTop: 10 }}>{name}</div>
          {(rows || []).map(([hi, amt], i, arr) => (
            <div className="kv" key={i}>
              <span>{i === 0 ? `up to ${hi} km`
                : hi == null ? `above ${arr[i - 1][0]} km` : `${arr[i - 1][0] + 1} - ${hi} km`}</span>
              <b>₹{amt}</b>
            </div>))}
        </div>))}
      <div className="note">{FARE_TABLE.note}</div>
    </Card>

    <Card>
      <div className="chead"><Icon n="ticket" size={16} /> Passes</div>
      {[['Day pass (Green Card)', PASSES.daily], ['Weekly', PASSES.weekly],
        ['Monthly', PASSES.monthly], ['Quarterly', PASSES.quarterly],
        ['Yearly', PASSES.yearly], ['Senior citizen (monthly)', PASSES.seniorMonthly],
        ['Student all-route (monthly)', PASSES.studentAllRoute]].map(([n, [a, b]]) => (
        <div className="kv" key={n}><span>{n}</span><b>₹{a} <span className="dim sm">/ ₹{b} AC</span></b></div>))}
      <div className="src"><span className="dot" />
        <span>Source: Delhi Tourism transport listing and the DTC pass portal.
          The Green Card is not valid on Palam Coach, tourist or express services.</span></div>
    </Card>
  </>);
}
