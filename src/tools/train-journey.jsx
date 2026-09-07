/**
 * Train journey planner with CONNECTIONS.
 *
 * The "trains between" tool only lists direct trains. This one answers the
 * metro-style question for railways: if there is no direct train, WHERE do you
 * change, WHICH trains, WHAT is the wait, and WHICH stations come in between.
 *
 * How it works (all from live data, nothing hardcoded):
 *   2. If none (or the user wants alternatives), we take the busiest junctions
 *      keeping only pairs where the connection time is realistic.
 *      intermediate stations and the exact change point.
 */
import React, { useMemo, useState } from 'react';
import { jget } from '../core/engine';
import * as T from '../core/trains';
import { useData, Spin, Err, Empty, Src, Card } from '../ui/kit';
import { Icon } from '../ui/icons';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/* Major junctions worth trying as a change point. Chosen because they appear
const HUBS = ['NDLS', 'DLI', 'NZM', 'CNB', 'LKO', 'ALD', 'PRYJ', 'MGS', 'PNBE', 'ASN',
  'HWH', 'BBS', 'VSKP', 'BZA', 'MAS', 'SBC', 'UBL', 'PUNE', 'CSMT', 'BCT', 'ADI',
  'BRC', 'RTM', 'BPL', 'ET', 'JBP', 'NGP', 'BSP', 'R', 'JHS', 'AGC', 'JP', 'AII',
  'UMB', 'LDH', 'JUC', 'ASR', 'GHY', 'NJP', 'MFP', 'GKP', 'BE', 'MB', 'SC', 'KYN'];

const parseTrains = (txt) => {
  const out = [];
  for (const r of txt.split('^').slice(1).filter(Boolean)) {
    const f = r.split('~').filter((x) => x !== '');
    if (f.length < 14) continue;
    out.push({ no: f[0], name: f[1].trim(), from: f[3], to: f[5],
      dep: f[10], arr: f[11], dur: f[12], days: f[13] });
  }
  return out;
};

const between = async (from, to) => {
  const txt = await jget(
    `https://erail.in/rail/getTrains.aspx?Station_From=${from}&Station_To=${to}` +
    `&DataSource=0&Language=0&Cache=true`, { text: true, ms: 20000 });
  return parseTrains(txt);
};

const toMin = (hhmm) => {
  const m = String(hhmm || '').match(/(\d{1,2})[.:](\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
};

/** Wait time at the interchange, wrapping past midnight. */
const waitMins = (arr, dep) => {
  const a = toMin(arr), d = toMin(dep);
  if (a == null || d == null) return null;
  let w = d - a;
  if (w < 0) w += 1440;
  return w;
};

const journeyPool = [
  {
    id: 'between1', label: 'Direct trains',
    async run({ from, to }) {
      const direct = await between(from, to).catch(() => []);
      const result = { direct, connections: [] };

      // Only spend time on connections when there are few/no direct options.
      if (direct.length >= 6) return result;

      const candidates = HUBS.filter((h) => h !== from && h !== to).slice(0, 22);
      const legs1 = await Promise.all(candidates.map(async (h) => {
        try { return { hub: h, trains: await between(from, h) }; }
        catch { return { hub: h, trains: [] }; }
      }));
      const viable = legs1.filter((x) => x.trains.length).slice(0, 8);

      const legs2 = await Promise.all(viable.map(async (x) => {
        try { return { hub: x.hub, first: x.trains, second: await between(x.hub, to) }; }
        catch { return { hub: x.hub, first: x.trains, second: [] }; }
      }));

      const conns = [];
      for (const g of legs2) {
        if (!g.second.length) continue;
        for (const t1 of g.first.slice(0, 4)) {
          for (const t2 of g.second.slice(0, 4)) {
            const w = waitMins(t1.arr, t2.dep);
            if (w == null || w < 25 || w > 480) continue;   // 25 min – 8 h
            conns.push({ hub: g.hub, t1, t2, wait: w });
          }
        }
      }
      conns.sort((a, b) => a.wait - b.wait);
      result.connections = conns.slice(0, 8);
      return result;
    },
  },
];

/** Full stop list for one train, so we can show intermediate stations. */
const stopsPool = [
  {
    id: 'stops1', label: 'Stops',
    async run({ no }) {
      const d = await jget(`https://railradar.in/api/v1/trains/${no}`, { ms: 20000 });
      if (!d?.success) throw new Error('no schedule');
      return (d.data.route || [])
        .filter((r) => r.isHalt)
        .map((r) => ({
          code: r.station?.code ?? r.stationCode,
          name: r.station?.name ?? r.stationName,
          arr: r.arrival ?? r.scheduledArrival,
          dep: r.departure ?? r.scheduledDeparture,
          km: r.distance,
        }));
    },
  },
];

function StnPicker({ label, value, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => T.searchStations(q, 10), [q]);
  const cur = T.stationByCode(value);
  return (
    <div className="fld" style={{ position: 'relative' }}>
      <label>{label}</label>
      <input value={open ? q : (cur ? `${cur.n} (${cur.c})` : value)}
        placeholder="Station name or code…"
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 180)} />
      {open && hits.length > 0 && (
        <div className="list" style={{ position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 40, marginTop: 4, maxHeight: 270, overflowY: 'auto' }}>
          {hits.map((h) => (
            <button key={h.c} className="col" style={{ background: 'none', border: 0,
              textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); onPick(h.c); setOpen(false); setQ(''); }}>
              <b style={{ fontSize: 13.5 }}>{h.n}</b>
              <span className="dim sm mono">{h.c}</span>
            </button>))}
        </div>)}
    </div>);
}

function StopList({ no, from, to }) {
  const s = useData('stops-' + no, stopsPool, { no }, { auto: true, ttl: 864e5, deps: [no] });
  if (s.loading) return <div className="dim sm" style={{ padding: 10 }}>Loading stations…</div>;
  if (!s.data?.length) return null;
  const i = s.data.findIndex((x) => x.code === from);
  const j = s.data.findIndex((x) => x.code === to);
  const slice = (i >= 0 && j > i) ? s.data.slice(i, j + 1) : s.data;
  return (
    <div className="list" style={{ marginTop: 8 }}>
      {slice.map((x, k) => (
        <div className="row" key={k} style={{ padding: '7px 12px' }}>
          <span style={{ width: 16, textAlign: 'center', flex: '0 0 auto',
            color: k === 0 || k === slice.length - 1 ? 'var(--green)' : 'var(--fg3)' }}>
            {k === 0 || k === slice.length - 1 ? '◉' : '•'}</span>
          <div className="main"><b style={{ fontSize: 12.5 }}>{x.name}</b>
            <span className="dim sm">{x.code} · {x.km} km</span></div>
          <span className="dim mono sm">{x.arr || '—'}/{x.dep || '—'}</span>
        </div>))}
    </div>);
}

function TrainCard({ t, showStops }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col">
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <b className="mono" style={{ color: 'var(--green)' }}>{t.no}</b>
        <b style={{ flex: 1, fontSize: 13 }}>{t.name}</b>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{t.dep}</span>
        <span className="dim sm" style={{ flex: 1, textAlign: 'center' }}>── {t.dur} ──</span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{t.arr}</span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 5, alignItems: 'center' }}>
        {String(t.days || '').split('').map((v, j) => (
          <span key={j} style={{ width: 16, height: 16, borderRadius: 4, fontSize: 8.5,
            display: 'grid', placeItems: 'center', fontWeight: 700,
            background: v === '1' ? 'var(--green)' : 'var(--s3)',
            color: v === '1' ? '#00110A' : 'var(--fg3)' }}>{DAYS[j]}</span>))}
        {showStops && (
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
            onClick={() => setOpen(!open)}>{open ? '▲ Hide' : '▼ Stations'}</button>)}
      </div>
      {open && <StopList no={t.no} from={t.from} to={t.to} />}
    </div>);
}

export function TrainJourney() {
  const [from, setFrom] = useState('NDLS');
  const [to, setTo] = useState('MAS');
  const j = useData('train-journey', journeyPool, { from, to }, { auto: false, ttl: 18e5 });
  const d = j.data;

  return (<>
    <StnPicker label="From" value={from} onPick={setFrom} />
    <StnPicker label="To" value={to} onPick={setTo} />
    <div className="btnrow">
      <button className="btn" style={{ flex: 1 }} onClick={() => j.run({ from, to })}>
        <Icon n="compass" size={17} /> Find journeys</button>
      <button className="btn ghost" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
    </div>
    <div className="dim sm" style={{ marginTop: 6 }}>
      Searches direct trains, then builds connections through major junctions if needed.
    </div>

    {j.loading && <Spin t="Searching direct trains and connections" />}
    {j.error && <Err error={j.error} retry={() => j.run({ from, to })} />}

    {d && (<>
      {d.direct.length > 0 && (<>
        <div className="chead" style={{ marginTop: 14 }}>
          <Icon n="check" size={16} /> Direct trains ({d.direct.length})</div>
        <div className="list">
          {d.direct.map((t, i) => <TrainCard key={i} t={t} showStops />)}
        </div>
      </>)}

      {d.connections.length > 0 && (<>
        <div className="chead" style={{ marginTop: 16 }}>
          <Icon n="refresh" size={15} /> With one change ({d.connections.length})</div>
        {d.connections.map((c, i) => (
          <Card key={i} style={{ marginTop: 10 }}>
            <div className="chead">
              Change at {T.stationByCode(c.hub)?.n || c.hub}
              <span className="tag w" style={{ marginLeft: 'auto' }}>
                {Math.floor(c.wait / 60)}h {c.wait % 60}m wait</span>
            </div>
            <div className="list">
              <TrainCard t={c.t1} showStops />
              <div className="col" style={{ background: 'rgba(255,209,102,.08)' }}>
                <span style={{ color: 'var(--warn)', fontSize: 12.5, fontWeight: 600 }}>
                  <Icon n="refresh" size={15} /> Change at {c.hub} — {Math.floor(c.wait / 60)}h {c.wait % 60}m to connect</span>
              </div>
              <TrainCard t={c.t2} showStops />
            </div>
          </Card>))}
      </>)}

      {d.direct.length === 0 && d.connections.length === 0 &&
        <Empty t="No direct train and no realistic one-change connection found" />}

      <Src meta={j.meta} />
    </>)}

    {!d && !j.loading && <Empty t="Pick two stations and tap Find journeys" />}
  </>);
}
