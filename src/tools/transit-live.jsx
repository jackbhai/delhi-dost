/**
 * "Right now" panels for Delhi bus and metro.
 *
 * WHY THIS IS DERIVED AND NOT STREAMED
 * ------------------------------------
 * There is no public live-vehicle feed for Delhi transport. Every endpoint was
 * metro's own API answers 403 without a browser session, the Open Traffic
 * request, and the site this data came from keeps its live endpoint behind a
 * CSRF token with no CORS header, so a browser cannot call it either. A relay
 * through the edge worker would work but cannot be deployed from here.
 *
 * What CAN be answered honestly, and is what these panels show:
 *   - is this service running at all right now, from its published window;
 *   - when the next departure leaves the terminal - the published
 *     minute-by-minute timetable, not a guess;
 *   - roughly when it reaches YOUR stop, using the line's published running time;
 *   - the headway that applies at this hour (peak or off-peak, as published);
 *   - for the metro, whether the last train has gone, per direction.
 * The countdown is your device clock against a published timetable. It is
 * labelled as such; no invented vehicle position is ever shown.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLoc } from '../core/geo';
import * as B from '../core/bus-route';
import * as M from '../core/metro-route';
import { busAtStation } from '../core/transit-link';
import { Card, Empty } from '../ui/kit';
import { Icon } from '../ui/icons';
import { trackOfRoute, trackOfLine, stepsOf } from '../core/trip';
import { TripKit, MapPanel, AlertStatus } from './trip-ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => {
  if (m == null) return '--:--';
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};

const STATE = {
  running: ['Running now', 'g', 'live'],
  soon: ['Leaving shortly', 'g', 'live'],
  last: ['Last trip has left', 'w', ''],
  before: ['Not started yet', 'w', ''],
  closed: ['Closed now', 'bad', ''],
  unknown: ['No timetable published', '', ''],
};

function StatusTag({ state }) {
  const [label, tone, live] = STATE[state] || STATE.unknown;
  return (<span className={`tag ${tone || ''}`}>
    {live ? <span className={'dot ' + live} /> : null}{label}
  </span>);
}

/** The next few departures of one direction, as chips. */
function NextRow({ rec, now }) {
  const nd = B.nextDepartures(rec, now, 4);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <span className="dim sm">Next from the terminal:</span>
      {(nd.times || []).length
        ? nd.times.map((t, i) => <span key={i} className="tag c" style={{ fontSize: 11.5 }}>{hhmm(t)}</span>)
        : <span className="dim sm">none published for this hour</span>}
      {nd.wait != null && nd.wait >= 0 && (
        <span className="dim sm">{nd.wait === 0 ? 'leaving now' : `in ${nd.wait} min`}</span>)}
    </div>);
}

/** "next bus at this stop" for one row of a stop list. */
function NextAt({ rec, pos, now }) {
  const t = B.nextAtStop(rec, pos, now, 1)[0];
  if (!t) return <span className="dim sm">-</span>;
  return <span className="tag g">{hhmm(t.at)} · {t.mins} min</span>;
}

/* ------------------------------------------------------------------- bus tab */
export function BusLive() {
  const { loc } = useLoc();
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);          // index into ROUTES
  const [flip, setFlip] = useState(false);
  const [mode, setMode] = useState('timeline');
  const [alight, setAlight] = useState(null);   // index on the picked direction  // timeline | stops
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const hits = useMemo(() => (q.trim() ? B.searchRoutes(q, 24) : []), [q]);
  const dirs = useMemo(() => {
    const seen = new Set();
    return hits.filter((h) => { const k = h.r + '|' + h.f; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [hits]);

  let rec = pos != null ? B.ROUTES[pos] : null;
  if (rec && flip) { const back = B.returnOf(rec); if (back) rec = back; }
  const meta = rec ? B.routeMeta(rec) : null;
  const st = rec ? B.statusNow(rec, now) : null;
  const hw = rec ? B.headwayNow(rec, B.minutesOfDay(now)) : null;

  // A device outside the network is not a bus stop near you: nearestStops
  // always answers with something, so distance is the thing to test.
  const near = useMemo(() => {
    if (!(loc.lat > 5 && loc.lon > 5)) return null;
    return B.nearestStops(loc.lat, loc.lon, 1)[0] || null;
  }, [loc.lat, loc.lon]);
  const far = !!near && near.km > 30;
  const atNearest = useMemo(() => {
    if (!near) return [];
    return B.routesAt(near.n).map((r) => {
      const pos2 = B.stopIndexOn(r, near.n);
      if (pos2 < 0) return null;
      const t = B.nextAtStop(r, pos2, now, 1)[0];
      return t ? { r, pos: pos2, next: t.at, wait: t.mins, dep: t.dep } : null;
    }).filter(Boolean)
      .sort((a, b) => a.wait - b.wait).slice(0, 12);
  }, [near?.n, now]);

  const dep = st && st.next && st.next[0] != null ? st.next[0] : null;
  const timeline = useMemo(() => {
    if (!rec) return [];
    return rec.s.map((si, k) => {
      const run = k === 0 ? 0 : B.busEta(rec, 0, k);
      return {
        i: k, name: B.nameOf(si),
        km: +(((rec.m?.[k] ?? 0) - (rec.m?.[0] ?? 0)) / 1000).toFixed(2),
        run, at: dep != null && run != null ? dep + run : null,
      };
    });
  }, [rec, dep]);

  return (<>
    <Card>
      <div className="chead"><Icon n="clock" size={16} /> Right now · {hhmm(B.minutesOfDay(now))} IST</div>
      <div className="fld" style={{ marginTop: 6 }}>
        <label>Route number or terminal</label>
        <div className="ip-wrap">
          <Icon n="search" size={16} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPos(null); setFlip(false); }}
            placeholder="623, 764, Nehru Place, ISBT…" />
        </div>
      </div>
      <div className="dim sm" style={{ marginTop: 6 }}>
        {rec
          ? `${(B.STATS.route_records || B.ROUTES.length).toLocaleString('en-IN')} published directions · edit the box to search another`
          : `${(B.STATS.unique_route_numbers || 0).toLocaleString('en-IN')} route numbers and ${(B.STOPS.length || 0).toLocaleString('en-IN')} stops indexed from the published timetable. Tap one for what is due next.`}
      </div>
      {dirs.length > 0 && !rec && (
        <div className="list" style={{ marginTop: 10, maxHeight: 230, overflowY: 'auto' }}>
          {dirs.map((h, i) => {
            const s = B.statusNow(h, now);
            return (
              <button key={i} className="col" style={{ background: 'none', border: 0, width: '100%',
                textAlign: 'left', cursor: 'pointer' }}
                onClick={() => { setPos(B.ROUTES.indexOf(h)); setFlip(false); }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="busref">{h.r}</span>
                  <span className="dim sm" style={{ flex: 1 }}>{h.f} → {h.t}</span>
                  {s.next && s.next[0] != null && <span className="tag g">{hhmm(s.next[0])}</span>}
                </div>
              </button>);
          })}
        </div>)}
      {!dirs.length && q.trim() && <Empty t={`Nothing matches "${q}"`} />}
    </Card>

    {far && (
      <Card>
        <div className="chead"><Icon n="pin" size={16} /> Nothing near you</div>
        <div className="note">
          Your device sits about {Math.round(near.km).toLocaleString('en-IN')} km from Delhi. The published
          timetable here is the Delhi NCR (DTC and cluster) network, so there is nothing to time from where
          you are — search a route number or a terminal instead.
        </div>
      </Card>)}

    {near && !far && (
      <Card>
        <div className="chead"><Icon n="pin" size={16} /> Due soon at {near.n}</div>
        <div className="dim sm">
          {near.km < 1 ? `${Math.round(near.km * 1000)} m away` : `${near.km.toFixed(1)} km away`}
          {' · '}{B.routesAt(near.n).length} routes call at this stop
        </div>
        {!atNearest.length && (
          <div className="note" style={{ marginTop: 8 }}>
            Nothing is due at this stop right now — every service here is between its last and first bus.
          </div>)}
        <div className="list" style={{ marginTop: 8 }}>
          {atNearest.map((x, i) => (
            <button key={i} className="row" style={{ background: 'none', border: 0, width: '100%',
              textAlign: 'left', cursor: 'pointer' }}
              onClick={() => { setPos(B.ROUTES.indexOf(x.r)); setFlip(false); setMode('timeline'); }}>
              <span className="busref">{x.r.r}</span>
              <div className="main">
                <b style={{ fontSize: 12.5 }}>{x.pos === 0 ? x.r.t : x.r.f}</b>
                <div className="dim sm">{x.r.o || 'DTC / cluster'}</div>
              </div>
              <span className="tag g" style={{ marginRight: 7 }}>{x.wait} min</span>
              <span className="dim sm">{hhmm(x.next)}</span>
            </button>))}
        </div>
      </Card>)}

    {rec && (<>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="busref" style={{ fontSize: 15 }}>{rec.r}</span>
          <StatusTag state={st?.state || 'unknown'} />
          <span className="dim" style={{ flex: 1, fontSize: 12.5 }}>{rec.f} → {rec.t}</span>
          {B.returnOf(rec) && (
            <button className="btn ghost sm" onClick={() => setFlip((f) => !f)}>
              <Icon n="swap" size={14} /> {flip ? 'This way' : 'Return'}
            </button>)}
        </div>
        <div className="dim sm" style={{ marginTop: 5 }}>
          {rec.o || 'DTC / cluster'} · {rec.s.length} stops ·{' '}
          {meta.shape ? 'length measured along the driven route' : 'length estimated as a straight line'}
        </div>

        <div className="g3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="v">{hhmm(meta.window?.[0])}</div><div className="l">First bus</div></div>
          <div className="stat"><div className="v">{hhmm(meta.window?.[1])}</div><div className="l">Last bus</div></div>
          <div className="stat"><div className="v">{hw.label ? hw.label.replace(/^every /, '') : '-'}</div>
            <div className="l">{hw.peak ? 'peak headway' : 'headway now'}</div></div>
        </div>
        <div className="g3" style={{ marginTop: 8 }}>
          <div className="stat"><div className="v">{rec.km ? rec.km.toFixed(1) : '-'}</div><div className="l">km end to end</div></div>
          <div className="stat"><div className="v">{rec.mins || '-'}</div><div className="l">min full run</div></div>
          <div className="stat"><div className="v">{meta.trips || '-'}</div><div className="l">trips a day</div></div>
        </div>

        <div style={{ marginTop: 11 }}>
          <NextRow rec={rec} now={now} />
          {(st?.state === 'before' || st?.state === 'closed') && (
            <div className="note">
              {st.state === 'before' ? 'Service starts' : 'Resumes tomorrow'} at {hhmm(st.opens)}
              {st.inMins ? ` — in ${st.inMins} min` : ''}.
            </div>)}
          {st?.state === 'last' && (
            <div className="note">The last departure has already left
              {st.lastLeft != null ? ` (${hhmm(st.lastLeft)})` : ''}. Next service {hhmm(st.opens)}.</div>)}
          {st?.state === 'unknown' && (
            <div className="note">This direction has no timetable published on its page; distance, stops and
              the route itself are still accurate.</div>)}
        </div>
      </Card>

      <div className="btnrow">
        <button className={`cat ${mode === 'timeline' ? 'on' : ''}`} onClick={() => setMode('timeline')}>
          <Icon n="clock" size={15} /> Arrival at each stop</button>
        <button className={`cat ${mode === 'stops' ? 'on' : ''}`} onClick={() => setMode('stops')}>
          <Icon n="list" size={15} /> Every stop</button>
      </div>

      {rec && (() => {
        const upTo = alight > 0 && alight < rec.s.length - 1 ? alight : null;
        const track = trackOfRoute(rec, { boardMin: dep, upTo });
        return (
          <Card>
            <div className="chead sm" style={{ marginBottom: 4 }}>
              {upTo ? 'Map and get-off alert · ' + B.nameOf(rec.s[upTo]) : 'This direction, end to end'}
            </div>
            <TripKit track={track} steps={stepsOf(track)} boardMin={dep} />
            <div className="dim sm" style={{ marginTop: 8 }}>
              {dep != null
                ? 'Per-stop minutes are the published departure plus this route\u2019s own running time.'
                : 'No departure is published for this hour, so an alert counts stops, not minutes.'}
              {' '}Tap a stop below to say where you get off.
            </div>
            <AlertStatus />
          </Card>);
      })()}

      <div className="list" style={{ maxHeight: 430, overflowY: 'auto' }}>
        {mode === 'timeline' && timeline.map((t) => (
          <button className={`row${alight === t.i ? ' act' : ''}`} key={t.i}
            style={{ padding: '7px 14px', background: 'none', border: 0, width: '100%',
                     textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setAlight(t.i > 0 ? t.i : null)}>
            <span style={{ width: 20, textAlign: 'center', flex: '0 0 auto', fontSize: 11,
              color: t.i === 0 || t.i === timeline.length - 1 ? 'var(--green)' : 'var(--fg3)' }}>{t.i + 1}</span>
            <div className="main"><b style={{ fontSize: 12.5 }}>{t.name}</b></div>
            <span className="dim sm" style={{ marginRight: 8 }}>{t.km.toFixed(1)} km</span>
            <span className="tag">{t.i === 0 ? 'starts here' : `+${t.run ?? '-'} min`}</span>
            <span className={`tag ${t.i === alight ? 'g' : 'c'}`} style={{ marginLeft: 6 }}>
              {t.i === alight ? 'get off here' : hhmm(t.at)}</span>
          </button>))}
        {mode === 'stops' && B.routeStops(rec).map((n, i) => (
          <div className="row" key={i} style={{ padding: '7px 14px' }}>
            <span style={{ width: 20, textAlign: 'center', flex: '0 0 auto', fontSize: 11, color: 'var(--fg3)' }}>{i + 1}</span>
            <div className="main"><b style={{ fontSize: 12.5 }}>{n}</b></div>
            <NextAt rec={rec} pos={i} now={now} />
          </div>))}
      </div>

      <div className="src"><span className="dot" /><span>
        Departures are the operator's published timetable for this direction; the time a stop is reached is that
        departure plus the published running time to the stop, so traffic and a late bus are not reflected.
        Built {B.BUILT} · {B.STATS.route_records || B.ROUTES.length} directions ·{' '}
        {B.STATS.with_timetable || 0} with timetables.
      </span></div>
    </>)}
  </>);
}

/* ---------------------------------------------------------------- metro tab */
export function MetroTimings() {
  // the Yellow Line is the spine of the network; landing on an airport shuttle
  // with 7 stations is a poor first read of "the network right now"
  const [pick, setPick] = useState(() => (M.corridors.includes('Yellow Line') ? 'Yellow Line' : M.corridors[0]));
  const [st, setSt] = useState('Rajiv Chowk');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const at = M.minutesOfDay(now);
  const info = M.lineInfo(pick, at);
  const F = M.FARES || {};
  const holiday = M.isHoliday(now);
  const offPeak = M.isOffPeak(now);
  const stations = useMemo(() => {
    const set = new Set();
    for (const L of M.LINES.filter((x) => x.l === pick)) L.s.forEach((n) => set.add(n));
    return [...set];
  }, [pick]);
  const hits = useMemo(() => (q.trim() ? M.searchStations(q, 6) : []), [q]);
  // a station carried over from another corridor would show an empty panel
  const station = stations.includes(st) ? st : (stations[0] || null);
  const lastHere = station ? M.lastTrainAt(pick, station, at) : null;
  const links = useMemo(() => (station ? busAtStation(station, 4) : []), [station]);
  const all = useMemo(() => M.corridors.map((c) => ({ c, i: M.lineInfo(c, at) })), [at]);

  const slabs = (holiday ? F.holiday : F.weekday) || [];
  const slabRows = (rows) => rows.map(([hi, amt], i, arr) => (
    <div className="kv" key={i}>
      <span>{i === 0 ? `up to ${hi} km` : hi == null ? `above ${arr[i - 1][0]} km` : `${arr[i - 1][0] + 1}-${hi} km`}</span>
      <b>₹{amt}</b>
    </div>));

  return (<>
    <Card>
      <div className="chead"><Icon n="signal" size={16} /> The network at {hhmm(at)} IST</div>
      <div className="cats" style={{ marginTop: 8 }}>
        {all.map(({ c, i }) => (
          <button key={c} className={`cat ${pick === c ? 'on' : ''}`} onClick={() => setPick(c)}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
              marginRight: 5, background: i?.colour || '#888', opacity: i?.open ? 1 : .35 }} />
            {c.replace(' Line', '')}{i?.open ? '' : ' · closed'}
          </button>))}
      </div>
      {holiday && <div className="dim sm" style={{ marginTop: 8 }}>Sunday / national holiday — the flatter fare
        slabs apply and the first train is later on some lines.</div>}
      {info && (<>
        <div className="g3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="v">{info.open ? 'Running' : 'Closed'}</div>
            <div className="l">{info.open ? `till ${hhmm(info.last)}` : `opens ${hhmm(info.first)}`}</div></div>
          <div className="stat">
            <div className="v">{M.headwayText(info.headway) || '—'}</div>
            <div className="l">between trains{info.peak ? ' (peak)' : ''}</div></div>
          <div className="stat"><div className="v">{info.stations}</div>
            <div className="l">stations · {info.km ? `${info.km} km` : '—'}</div></div>
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {info.ends.map((e, i) => (
            <div className="row" key={i} style={{ padding: '8px 14px' }}>
              <div className="main"><b style={{ fontSize: 12.5 }}>towards {e.from}</b></div>
              <span className="tag">first {hhmm(e.first)}</span>
              <span className="tag w" style={{ marginLeft: 6 }}>last {hhmm(e.last)}</span>
            </div>))}
        </div>
        {info.about && <div className="dim sm" style={{ marginTop: 9 }}>{info.about}</div>}
        <div className="src"><span className="dot" /><span>
          {info.open
            ? `Between trains right now: about ${M.headwayText(info.headway) || '—'} (published ${info.peak ? 'peak' : 'off-peak'} headway).`
            : `No trains run at this hour. Service window ${hhmm(info.first)}-${hhmm(info.last)}.`}
        </span></div>
      </>)}
    </Card>

    <Card>
      <div className="chead sm" style={{ marginBottom: 4 }}>The line on a map</div>
      <MapPanel track={trackOfLine(pick, { upToName: station })} height={230}
        hint="Published station order; not a train position." />
    </Card>

    <Card>
      <div className="chead"><Icon n="train" size={16} /> Last train from a station</div>
      <div className="fld">
        <label>Station on the {pick}</label>
        <div className="ip-wrap">
          <Icon n="search" size={16} />
          <input value={q || station} placeholder="Search a station…"
            onFocus={() => setQ('')} onChange={(e) => setQ(e.target.value)}
            onBlur={() => setTimeout(() => setQ(''), 180)} />
        </div>
      </div>
      {q.trim() && (
        <div className="list" style={{ maxHeight: 190, overflowY: 'auto' }}>
          {hits.map((h) => (
            <button key={h} className="col" style={{ background: 'none', border: 0, width: '100%',
              textAlign: 'left', cursor: 'pointer' }}
              onClick={() => { setSt(h); setQ(''); }}>
              <b style={{ fontSize: 12.5 }}>{h}</b>
            </button>))}
          {!hits.length && stations.filter((n) => n.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map((n) => (
            <button key={n} className="col" style={{ background: 'none', border: 0, width: '100%',
              textAlign: 'left', cursor: 'pointer' }} onClick={() => { setSt(n); setQ(''); }}>
              <b style={{ fontSize: 12.5 }}>{n}</b>
            </button>))}
        </div>)}
      {lastHere ? (<>
        <div className={lastHere.gone ? 'note' : 'g2'} style={{ marginTop: 10 }}>
          <div className="stat"><div className="v">{hhmm(lastHere.at)}</div>
            <div className="l">last train leaves {station}</div></div>
          <div className="stat"><div className="v">{lastHere.gone ? 'Gone' : `${lastHere.left} min`}</div>
            <div className="l">{lastHere.gone ? 'no train tonight — take a bus or an auto' : 'left to catch it'}</div></div>
        </div>
        <div className="dim sm" style={{ marginTop: 8 }}>
          Estimated: the {lastHere.from} terminal's published last-train time ({hhmm(lastHere.at + lastHere.run)})
          less the running time to {station} (~{lastHere.run} min).
          DMRC publishes last-train times per terminal, not per station, and short workings can differ.
        </div>
      </>) : <Empty t="Pick a station on this line" />}

      {links.length > 0 && (<>
        <div className="chead sm" style={{ marginTop: 14 }}>Buses at {station}</div>
        <div className="list">
          {links.map((b, i) => (
            <div className="col" key={i} style={{ padding: '9px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <b style={{ fontSize: 12.5, flex: 1 }}>{b.name}</b>
                {b.m != null && <span className="dim sm">{b.m} m</span>}
                <span className="tag">{b.count} routes</span>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {b.numbers.map((n) => <span key={n} className="busref" style={{ fontSize: 10.5, padding: '1px 6px' }}>{n}</span>)}
                {b.count > b.numbers.length && <span className="dim sm">+{b.count - b.numbers.length} more</span>}
                {!b.verified && <span className="dim sm">stop name not found in the bus table</span>}
              </div>
            </div>))}
        </div>
      </>)}
    </Card>

    <Card>
      <div className="chead"><Icon n="fare" size={16} /> {holiday ? 'Sunday / holiday' : 'Weekday'} slabs
        <span className="dim sm" style={{ marginLeft: 6, fontWeight: 400 }}>effective {F.effective || '2025-08-25'}</span></div>
      <div className="g2">
        <div>{slabRows(slabs)}</div>
        <div>
          <div className="chead sm">Airport Express</div>
          {slabRows(F.airportExpress || [])}
        </div>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>Smart card / AQRC</span><b>-{Math.round((F.smartcardDiscount ?? .1) * 100)}%</b></div>
      <div className="kv"><span>Off-peak on the metro app (MJ QR)</span>
        <b>-{Math.round((F.mjqrtOffPeakDiscount ?? .2) * 100)}%</b></div>
      <div className="dim sm" style={{ marginTop: 6 }}>
        Off-peak: before {hhmm((F.offPeak?.weekday_windows?.[0]?.[1] ?? 8) * 60)},{' '}
        {hhmm((F.offPeak?.weekday_windows?.[1]?.[0] ?? 12) * 60)}-{hhmm((F.offPeak?.weekday_windows?.[1]?.[1] ?? 17) * 60)} and after{' '}
        {hhmm((F.offPeak?.weekday_windows?.[2]?.[0] ?? 21) * 60)}, Mon-Sat. Tokens never get the discount.
        {offPeak ? ' Right now is an off-peak hour.' : ''}
      </div>
      {F.timeLimit && (<div style={{ marginTop: 8 }}>
        <div className="chead sm">Time allowed inside the paid area</div>
        {F.timeLimit.map(([hi, mins], i, arr) => (
          <div className="kv" key={i}>
            <span>{i === 0 ? `up to ${hi} km` : hi == null ? `above ${arr[i - 1][0]} km` : `${arr[i - 1][0] + 1}-${hi} km`}</span>
            <b>{mins} min</b></div>))}
      </div>)}
      {F.cards && (<div style={{ marginTop: 8 }}>
        <div className="chead sm">Cards and tickets</div>
        <div className="kv"><span>Smart card</span>
          <b>₹{F.cards.smartCard?.price} <span className="dim sm">({F.cards.smartCard?.deposit} deposit) · max ₹{F.cards.smartCard?.maxBalance}</span></b></div>
        <div className="kv"><span>Tourist card</span>
          <b>₹{F.cards.tourist?.day1} a day · ₹{F.cards.tourist?.day3} for 3 days</b></div>
        <div className="kv"><span>Booking / help</span><b>{F.cards.whatsapp}</b></div>
      </div>)}
    </Card>

    <Card>
      <div className="chead"><Icon n="warn" size={16} /> Other networks on this map</div>
      {M.LINES.filter((L) => L.net && L.net !== 'DMRC').map((L) => (
        <div className="kv" key={L.n}>
          <span>{L.l} <span className="dim sm">({L.s.length} stations)</span></span>
          <b className="dim sm" style={{ fontWeight: 500 }}>separate ticketing</b>
        </div>))}
      <div className="note">
        The Aqua Line (Noida), the Delhi–Meerut RRTS and Rapid Metro Gurugram are run by other corporations with
        their own fares and cards. A DMRC ticket or smart card is not accepted on them, so journeys that cross into
        one need a second ticket; the planner charges the DMRC slab only for the DMRC part and says so.
      </div>
      <div className="src"><span className="dot" /><span>
        Built {M.BUILT} · {M.LINES.length} line records over {M.corridors.length} corridors ·{' '}
        {M.STATIONS.length} stations · {M.STATS.interchanges || 0} interchanges ·{' '}
        {M.STATS.with_bus_links || 0} stations carry their bus connections.
      </span></div>
    </Card>
  </>);
}
