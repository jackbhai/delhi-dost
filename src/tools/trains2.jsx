/**
 * Indian Railways: live running status, full schedule, and trains between
 * stations. All data is fetched live — nothing hardcoded.
 */
import React, { useState } from 'react';
import * as T from '../core/trains';
import { useData, Spin, Err, Empty, Src, Search, Card, Chips, fmt } from '../ui/kit';
import { Icon } from '../ui/icons';

const { fmtTime, delayLabel } = T;
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/* ------------------------------------------------------------- LIVE STATUS */
export function TrainLive() {
  const [no, setNo] = useState('');
  const [active, setActive] = useState('');
  const live = useData('train-live', T.trainLive, { no: active }, { auto: false, ttl: 6e4 });
  const go = (n) => {
    const v = String(n || no).trim();
    if (!/^\d{4,5}$/.test(v)) return;
    setActive(v); setNo(v); live.run({ no: v });
  };
  const d = live.data;
  const dl = d ? delayLabel(d.delay) : null;

  return (<>
    <Search value={no} onChange={setNo} onSubmit={() => go()} ph="Train number, e.g. 12013" />
    <div className="btnrow">
      {[['12013', 'Amritsar Shatabdi'], ['12951', 'Mumbai Rajdhani'],
        ['12002', 'Bhopal Shatabdi'], ['12259', 'Sealdah Duronto']].map(([n, l]) => (
        <button key={n} className="cat" onClick={() => go(n)}>{n}</button>))}
    </div>

    {live.loading && <Spin t="Fetching live position" />}
    {live.error && <Err error={live.error} retry={() => go()} />}

    {d && (<>
      <Card>
        <div className="chead">
          <span className="mono" style={{ color: 'var(--green)' }}>{d.no}</span> · {d.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div className="big" style={{ color: dl.tone, fontSize: 28 }}>{dl.text}</div>
          {d.isLive && <span className="tag g">● {d.mode}</span>}
          <span className="tag">{d.status}</span>
        </div>
        {d.current && (
          <div className="g2" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="v" style={{ fontSize: 13 }}>{d.current.stationName || d.current.stationCode}</div>
              <div className="l">Current position</div>
            </div>
            <div className="stat">
              <div className="v" style={{ fontSize: 13 }}>{d.next?.stationName || '—'}</div>
              <div className="l">Next halt{d.next?.distance != null ? ` · ${d.next.distance} km` : ''}</div>
            </div>
          </div>)}
        <div className="src"><span className="dot" />
          <span>Updated {fmtTime(d.updated)} · run date {d.startDate}</span></div>
      </Card>

      <div className="chead" style={{ marginTop: 14 }}>Station-by-station</div>
      <div className="list">
        {d.route.filter((r) => r.halt).map((r, i) => {
          const rd = delayLabel(r.delay);
          const done = r.status === 'departed' || r.status === 'crossed' || r.status === 'arrived';
          return (
            <div className="row" key={i} style={{ opacity: done ? 0.55 : 1 }}>
              <span style={{ width: 18, textAlign: 'center', flex: '0 0 auto',
                color: r.status === 'at-station' ? 'var(--green)' : done ? 'var(--fg3)' : 'var(--cyan)' }}>
                {r.status === 'at-station' ? '◉' : done ? '✓' : '○'}
              </span>
              <div className="main">
                <b style={{ fontSize: 13 }}>{r.name}</b>
                <span className="dim sm">
                  {r.code} · {r.km} km{r.platform ? ` · PF ${r.platform}` : ''}
                </span>
              </div>
              <div className="end">
                <b className="mono" style={{ fontSize: 12.5 }}>
                  {fmtTime(r.actArr || r.schArr) } / {fmtTime(r.actDep || r.schDep)}
                </b><br />
                <span style={{ color: rd.tone, fontSize: 11 }}>{rd.text}</span>
              </div>
            </div>);
        })}
      </div>
      <Src meta={live.meta} />
    </>)}

    {!d && !live.loading && !live.error && <Empty t="Enter a train number to see live status" />}
  </>);
}

/* ------------------------------------------------------------- SCHEDULE */
export function TrainSchedule() {
  const [no, setNo] = useState('');
  const [active, setActive] = useState('');
  const [allStops, setAllStops] = useState(false);
  const info = useData('train-info', T.trainInfo, { no: active }, { auto: false, ttl: 864e5 });
  const go = (n) => {
    const v = String(n || no).trim();
    if (!/^\d{4,5}$/.test(v)) return;
    setActive(v); setNo(v); info.run({ no: v });
  };
  const d = info.data;
  const shown = d ? (allStops ? d.route : d.route.filter((r) => r.halt)) : [];

  return (<>
    <Search value={no} onChange={setNo} onSubmit={() => go()} ph="Train number, e.g. 12951" />
    <div className="btnrow">
      {['12013', '12951', '12002', '12259', '12309'].map((n) => (
        <button key={n} className="cat" onClick={() => go(n)}>{n}</button>))}
    </div>

    {info.loading && <Spin t="Loading schedule" />}
    {info.error && <Err error={info.error} retry={() => go()} />}

    {d && (<>
      <Card>
        <div className="chead">
          <span className="mono" style={{ color: 'var(--green)' }}>{d.no}</span> · {d.type}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: .6 }}
          className="gradtext">{d.name}</div>
        <div className="dim sm" style={{ marginTop: 4 }}>
          {d.from?.name} → {d.to?.name}
        </div>
        <div className="g3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="v">{fmt(d.km)}</div><div className="l">km</div></div>
          <div className="stat"><div className="v">{Math.floor(d.mins / 60)}h {d.mins % 60}m</div><div className="l">Duration</div></div>
          <div className="stat"><div className="v">{d.halts}</div><div className="l">Halts</div></div>
        </div>
        <div className="g2" style={{ marginTop: 8 }}>
          <div className="stat"><div className="v">{d.avgSpeed}</div><div className="l">Avg km/h</div></div>
          <div className="stat"><div className="v">{d.maxSpeed}</div><div className="l">Max km/h</div></div>
        </div>
        <div className="btnrow" style={{ marginTop: 10 }}>
          {(d.runDays || []).map((on, i) => (
            <span key={i} style={{ width: 24, height: 24, borderRadius: 6, display: 'grid',
              placeItems: 'center', fontSize: 10, fontWeight: 700,
              background: on && on !== 'N' ? 'var(--green)' : 'var(--s3)',
              color: on && on !== 'N' ? '#00110A' : 'var(--fg3)' }}>{DAYS[i]}</span>))}
        </div>
        {d.coaches && (
          <div style={{ marginTop: 12 }}>
            <div className="dim sm" style={{ marginBottom: 4 }}>Coach position</div>
            <div className="out" style={{ fontSize: 11 }}>{d.coaches}</div>
          </div>)}
        {d.returnTrain && <div className="kv" style={{ marginTop: 8 }}>
          <span>Return train</span>
          <b className="mono" style={{ cursor: 'pointer', color: 'var(--cyan)' }}
            onClick={() => go(d.returnTrain)}>{d.returnTrain}</b></div>}
        <Src meta={info.meta} />
      </Card>

      <div className="btnrow">
        <button className={`cat ${!allStops ? 'on' : ''}`} onClick={() => setAllStops(false)}>
          Halts ({d.route.filter((r) => r.halt).length})</button>
        <button className={`cat ${allStops ? 'on' : ''}`} onClick={() => setAllStops(true)}>
          All points ({d.route.length})</button>
      </div>

      <div className="list">
        {shown.map((r, i) => (
          <div className="row" key={i}>
            <span className="dim mono" style={{ width: 24, fontSize: 11 }}>{r.seq}</span>
            <div className="main">
              <b style={{ fontSize: 13, color: r.halt ? '' : 'var(--fg3)' }}>{r.name}</b>
              <span className="dim sm">{r.code} · {r.km} km{r.speed ? ` · ${r.speed} km/h` : ''}</span>
            </div>
            <div className="end mono" style={{ fontSize: 12.5 }}>
              {r.arr || '—'}<span className="dim"> / </span>{r.dep || '—'}
              {r.day > 1 && <span className="tag c" style={{ marginLeft: 4 }}>D{r.day}</span>}
            </div>
          </div>))}
      </div>
    </>)}

    {!d && !info.loading && !info.error && <Empty t="Enter a train number to see its full schedule" />}
  </>);
}

/* ------------------------------------------------------------- BETWEEN */
function StnPicker({ label, value, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = React.useMemo(() => T.searchStations(q, 10), [q]);
  const cur = T.stationByCode(value);
  return (
    <div className="fld" style={{ position: 'relative' }}>
      <label>{label}</label>
      <input
        value={open ? q : (cur ? `${cur.n} (${cur.c})` : value)}
        placeholder="Type station name or code…"
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

export function TrainsBetween() {
  const [from, setFrom] = useState('NDLS');
  const [to, setTo] = useState('ASR');
  const b = useData('trains-between', T.trainsBetween, { from, to }, { auto: true, ttl: 36e5 });
  return (<>
    <StnPicker label="From" value={from} onPick={(c) => { setFrom(c); b.run({ from: c, to }); }} />
    <StnPicker label="To" value={to} onPick={(c) => { setTo(c); b.run({ from, to: c }); }} />
    <div className="btnrow">
      <button className="btn" style={{ flex: 1 }} onClick={() => b.run({ from, to })}><Icon n="train" size={17} /> Search</button>
      <button className="btn ghost" onClick={() => { setFrom(to); setTo(from); b.run({ from: to, to: from }); }}>⇄</button>
    </div>
    <div className="dim sm" style={{ marginTop: 6 }}>
      {T.ALL_STATIONS.length.toLocaleString('en-IN')} stations across India
    </div>

    {b.loading && <Spin t="Searching Indian Railways" />}
    {b.error && <Err error={b.error} retry={() => b.run({ from, to })} />}
    {b.data?.length === 0 && <Empty t="No direct trains on this route" />}

    {b.data?.length > 0 && (<>
      <div className="dim sm" style={{ margin: '12px 0 8px' }}>{b.data.length} trains</div>
      <div className="list">
        {b.data.map((x, i) => (
          <div className="col" key={i}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <b className="mono" style={{ color: 'var(--green)' }}>{x.no}</b>
              <b style={{ flex: 1, fontSize: 13 }}>{x.name}</b>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{x.dep}</span>
              <span className="dim sm" style={{ flex: 1, textAlign: 'center' }}>── {x.dur} ──</span>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{x.arr}</span>
            </div>
            <div style={{ display: 'flex', gap: 3, marginTop: 5 }}>
              {String(x.days || '').split('').map((v, j) => (
                <span key={j} style={{ width: 17, height: 17, borderRadius: 4, fontSize: 9,
                  display: 'grid', placeItems: 'center', fontWeight: 700,
                  background: v === '1' ? 'var(--green)' : 'var(--s3)',
                  color: v === '1' ? '#00110A' : 'var(--fg3)' }}>{DAYS[j]}</span>))}
            </div>
          </div>))}
      </div>
      <Src meta={b.meta} />
    </>)}
  </>);
}
