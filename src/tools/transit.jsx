/**
 * India transport + traveller tools.
 *   Nearby  — auto-located stations, ATMs, hospitals, fuel, food around you
 *   Travel  — Wikivoyage city guide, currency + emergency numbers
 * Everything is CORS-verified and keyless.
 */
import React, { useEffect, useState } from 'react';
import { jget, resolve } from '../core/engine';
import { useLoc, LocBar } from '../core/geo';
import { useData, Spin, Err, Empty, Src, Search, Card, Chips, Field, Stat, fmt } from '../ui/kit';
import { Icon } from '../ui/icons';

/* ------------------------------------------------------------ TRAINS */
const STATIONS = [
  ['NDLS','New Delhi'],['DLI','Old Delhi'],['NZM','H. Nizamuddin'],['ANVT','Anand Vihar'],
  ['ASR','Amritsar Jn'],['LDH','Ludhiana'],['JUC','Jalandhar City'],['UMB','Ambala Cant'],
  ['CDG','Chandigarh'],['LKO','Lucknow'],['CNB','Kanpur'],['BSB','Varanasi'],
  ['HWH','Howrah'],['CSTM','Mumbai CST'],['BCT','Mumbai Central'],['ADI','Ahmedabad'],
  ['JP','Jaipur'],['SBC','Bengaluru'],['MAS','Chennai'],['HYB','Hyderabad'],['PNBE','Patna'],
];

const trainPool = [
  { id: 'between-live', label: 'Between stations', async run({ from, to }) {
      const txt = await jget(
        `https://erail.in/rail/getTrains.aspx?Station_From=${from}&Station_To=${to}&DataSource=0&Language=0&Cache=true`,
        { text: true, proxy: true });
      const rows = txt.split('^').slice(1).filter(Boolean);
      const out = rows.map((r) => {
        const f = r.split('~').filter((x) => x !== '');
        if (f.length < 14) return null;
        return {
          no: f[0], name: f[1], fromName: f[2], from: f[3], toName: f[4], to: f[5],
          dep: f[10], arr: f[11], dur: f[12], days: f[13],
        };
      }).filter(Boolean);
      if (!out.length) throw new Error('no trains found');
      return out; } },
];

const DAYS = ['M','T','W','T','F','S','S'];

export function Trains() {
  const [from, setFrom] = useState('NDLS');
  const [to, setTo] = useState('ASR');
  const t = useData('trains', trainPool, { from, to }, { auto: true, ttl: 36e5, deps: [] });
  return (<>
    <div className="g2">
      <Field label="From" as="select" value={from} onChange={(e) => setFrom(e.target.value)}>
        {STATIONS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
      </Field>
      <Field label="To" as="select" value={to} onChange={(e) => setTo(e.target.value)}>
        {STATIONS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
      </Field>
    </div>
    <div className="btnrow">
      <button className="btn" onClick={() => t.run({ from, to })}><Icon n="train" size={17} /> Search trains</button>
      <button className="btn ghost" onClick={() => { setFrom(to); setTo(from); t.run({ from: to, to: from }); }}>⇄ Swap</button>
    </div>
    {t.loading && <Spin t="Searching Indian Railways" />}
    {t.error && <Err error={t.error} retry={() => t.run({ from, to })} />}
    {t.data?.length === 0 && <Empty t="No direct trains on this route" />}
    {t.data?.length > 0 && (<>
      <div className="dim sm" style={{ margin: '12px 0 8px' }}>{t.data.length} trains found</div>
      <div className="list">
        {t.data.map((x, i) => (
          <div className="col" key={i}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <b className="mono" style={{ color: 'var(--green)' }}>{x.no}</b>
              <b style={{ flex: 1, fontSize: 13.5 }}>{x.name}</b>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{x.dep}</span>
              <span className="dim sm" style={{ flex: 1, textAlign: 'center' }}>
                ── {x.dur} ──</span>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{x.arr}</span>
            </div>
            <div style={{ display: 'flex', gap: 3, marginTop: 5 }}>
              {String(x.days || '').split('').map((d, j) => (
                <span key={j} style={{ width: 17, height: 17, borderRadius: 4, fontSize: 9,
                  display: 'grid', placeItems: 'center',
                  background: d === '1' ? 'var(--green)' : 'var(--s3)',
                  color: d === '1' ? '#000' : 'var(--fg3)', fontWeight: 700 }}>{DAYS[j]}</span>))}
            </div>
          </div>))}
      </div>
      <Src meta={t.meta} />
    </>)}
  </>);
}


async function ovp(endpoint, query, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(endpoint, {
      method: 'POST', signal: c.signal,
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------ METRO */
const NETWORKS = {
  Delhi:      [28.40, 76.80, 28.90, 77.40],
  Mumbai:     [18.90, 72.75, 19.30, 73.05],
  Bengaluru:  [12.85, 77.45, 13.15, 77.75],
  Chennai:    [12.90, 80.10, 13.20, 80.35],
  Kolkata:    [22.45, 88.25, 22.70, 88.45],
  Hyderabad:  [17.30, 78.30, 17.55, 78.60],
  Lucknow:    [26.75, 80.85, 26.95, 81.05],
  Jaipur:     [26.85, 75.70, 26.98, 75.85],
  Kochi:      [9.90, 76.25, 10.10, 76.40],
  Nagpur:     [21.05, 78.98, 21.20, 79.15],
  Pune:       [18.45, 73.75, 18.65, 73.95],
  Ahmedabad:  [22.95, 72.50, 23.15, 72.70],
};

const metroPool = [
  { id: 'map1', label: 'Map', async run({ city }) { return overpass(city, 'https://overpass-api.de/api/interpreter'); } },
  { id: 'map2', label: 'Map 2', async run({ city }) { return overpass(city, 'https://overpass.kumi.systems/api/interpreter'); } },
];

async function overpass(city, endpoint) {
  const [s, w, n, e] = NETWORKS[city] || NETWORKS.Delhi;
  const q = `[out:json][timeout:25];(node["railway"="station"]["station"="subway"](${s},${w},${n},${e});` +
            `node["railway"="station"]["subway"="yes"](${s},${w},${n},${e}););out body 300;`;
  const d = await ovp(endpoint, q);
  const seen = new Set();
  const out = (d.elements || []).filter((x) => x.tags?.name).map((x) => ({
    name: x.tags.name, line: x.tags.line || x.tags.network || '', lat: x.lat, lon: x.lon,
    operator: x.tags.operator || '',
  })).filter((x) => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!out.length) throw new Error('no stations');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function Metro() {
  const [city, setCity] = useState('Delhi');
  const [q, setQ] = useState('');
  const { loc } = useLoc();
  const m = useData('metro', metroPool, { city }, { ttl: 6048e5, deps: [city] });
  const list = (m.data || []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  const dist = (a) => {
    const R = 6371, dLat = (a.lat - loc.lat) * Math.PI / 180, dLon = (a.lon - loc.lon) * Math.PI / 180;
    const h = Math.sin(dLat/2)**2 + Math.cos(loc.lat*Math.PI/180)*Math.cos(a.lat*Math.PI/180)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const near = [...list].sort((a, b) => dist(a) - dist(b)).slice(0, 3);
  return (<>
    <LocBar />
    <div className="cats" style={{ marginTop: 10 }}>
      {Object.keys(NETWORKS).map((c) =>
        <button key={c} className={`cat ${city === c ? 'on' : ''}`} onClick={() => setCity(c)}>{c}</button>)}
    </div>
    {m.loading && <Spin t="Loading metro network" />}
    {m.error && <Err error={m.error} retry={() => m.run()} />}
    {m.data && (<>
      {near.length > 0 && dist(near[0]) < 60 && (
        <Card>
          <div className="chead"><Icon n="pin" size={17} /> Nearest to you</div>
          {near.map((x, i) => (
            <div className="kv" key={i}><span>{x.name}</span>
              <b style={{ color: 'var(--green)' }}>{dist(x).toFixed(1)} km</b></div>))}
        </Card>)}
      <Search value={q} onChange={setQ} ph={`Search ${m.data.length} stations…`} />
      <div className="dim sm" style={{ marginBottom: 8 }}>{list.length} stations</div>
      <div className="list">
        {list.slice(0, 120).map((x, i) => (
          <a className="row" key={i} target="_blank" rel="noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=17/${x.lat}/${x.lon}`}>
            <span style={{ fontSize: 17 }}><Icon n="metro" size={17} /></span>
            <div className="main"><b>{x.name}</b>
              {x.line && <span className="dim sm">{x.line}</span>}</div>
            <span className="dim sm">{dist(x) < 500 ? dist(x).toFixed(1) + ' km' : ''}</span>
          </a>))}
      </div>
      <Src meta={m.meta} />
    </>)}
  </>);
}

/* ------------------------------------------------------------ NEARBY */
const AMENITIES = [
  { v: 'atm',       l: 'ATM', i:'bank',      q: '["amenity"="atm"]' },
  { v: 'hospital',  l: 'Hospital', i:'heart', q: '["amenity"~"hospital|clinic"]' },
  { v: 'pharmacy',  l: <><Icon n="pill" size={18} /> Pharmacy</>, q: '["amenity"="pharmacy"]' },
  { v: 'fuel',      l: 'Fuel', i:'drop',     q: '["amenity"="fuel"]' },
  { v: 'restaurant',l: 'Food', i:'smile',     q: '["amenity"~"restaurant|fast_food|cafe"]' },
  { v: 'bus',       l: <><Icon n="bus" size={17} /> Bus stop</>, q: '["highway"="bus_stop"]' },
  { v: 'railway',   l: <><Icon n="train" size={17} /> Station</>,  q: '["railway"="station"]' },
  { v: 'police',    l: 'Police', i:'shield',   q: '["amenity"="police"]' },
  { v: 'toilets',   l: 'Toilets', i:'info',  q: '["amenity"="toilets"]' },
  { v: 'hotel',     l: 'Hotel', i:'home',    q: '["tourism"~"hotel|guest_house|hostel"]' },
  { v: 'attraction',l: 'Sights', i:'camera',   q: '["tourism"~"attraction|museum|viewpoint"]' },
  { v: 'temple',    l: 'Worship',  q: '["amenity"="place_of_worship"]' },
];

const nearbyPool = [
  { id: 'near1', label: 'Nearby', async run(p) { return near(p, 'https://overpass-api.de/api/interpreter'); } },
  { id: 'near2', label: 'Nearby 2', async run(p) { return near(p, 'https://overpass.kumi.systems/api/interpreter'); } },
];

async function near({ lat, lon, filter, radius }) {
  const q = `[out:json][timeout:18];node${filter}(around:${radius},${lat},${lon});out 60;`;
  const d = await ovp(endpointOf(), q, 11000);
  const out = (d.elements || []).map((x) => {
    const la = x.lat ?? x.center?.lat, lo = x.lon ?? x.center?.lon;
    if (!la) return null;
    const R = 6371, dLat = (la - lat) * Math.PI / 180, dLon = (lo - lon) * Math.PI / 180;
    const h = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180)*Math.cos(la*Math.PI/180)*Math.sin(dLon/2)**2;
    return { name: x.tags?.name || x.tags?.operator || '(unnamed)', lat: la, lon: lo,
      km: 2 * R * Math.asin(Math.sqrt(h)),
      extra: x.tags?.cuisine || x.tags?.brand || x.tags?.healthcare || x.tags?.religion || '' };
  }).filter(Boolean).sort((a, b) => a.km - b.km);
  if (!out.length) throw new Error('nothing found nearby');
  return out;
}
let _ep = 0;
const EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const endpointOf = () => EPS[(_ep++) % EPS.length];

export function Nearby() {
  const { loc } = useLoc();
  const [kind, setKind] = useState('atm');
  const [radius, setRadius] = useState(2000);
  const f = AMENITIES.find((a) => a.v === kind);
  const n = useData('nearby', nearbyPool,
    { lat: loc.lat, lon: loc.lon, filter: f.q, radius },
    { ttl: 6e5, deps: [kind, radius, loc.lat, loc.lon] });
  return (<>
    <LocBar />
    <div className="cats" style={{ marginTop: 10 }}>
      {AMENITIES.map((a) =>
        <button key={a.v} className={`cat ${kind === a.v ? 'on' : ''}`} onClick={() => setKind(a.v)}>{a.l}</button>)}
    </div>
    <Chips items={[{v:1000,l:'1 km'},{v:2000,l:'2 km'},{v:5000,l:'5 km'},{v:10000,l:'10 km'}]}
      value={radius} onPick={setRadius} />
    {n.loading && <Spin t="Scanning your area" />}
    {n.error && <Err error={n.error} retry={() => n.run()} />}
    {n.data && (<>
      <div className="dim sm" style={{ margin: '10px 0 8px' }}>{n.data.length} found within {radius/1000} km</div>
      <div className="list">
        {n.data.slice(0, 50).map((x, i) => (
          <a className="row" key={i} target="_blank" rel="noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=18/${x.lat}/${x.lon}`}>
            <div className="main"><b>{x.name}</b>
              {x.extra && <span className="dim sm">{x.extra}</span>}</div>
            <span style={{ color: 'var(--green)', fontSize: 12.5, fontWeight: 600 }}>
              {x.km < 1 ? Math.round(x.km * 1000) + ' m' : x.km.toFixed(1) + ' km'}</span>
          </a>))}
      </div>
      <Src meta={n.meta} />
    </>)}
  </>);
}

/* ------------------------------------------------------------ TRAVEL GUIDE */
const guidePool = [
  { id: 'wikivoyage', label: 'Wikivoyage', async run({ q }) {
      const d = await jget(`https://en.wikivoyage.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'DelhiDost/1.0' } });
      if (!d.extract) throw new Error('no guide');
      return { title: d.title, extract: d.extract, thumb: d.thumbnail?.source || '',
        url: d.content_urls?.desktop?.page || '' }; } },
  { id: 'wikipedia-sum', label: 'Wikipedia', async run({ q }) {
      const d = await jget(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'DelhiDost/1.0' } });
      if (!d.extract) throw new Error('no summary');
      return { title: d.title, extract: d.extract, thumb: d.thumbnail?.source || '',
        url: d.content_urls?.desktop?.page || '' }; } },
];

const EMERGENCY = {
  India: [['112','All emergencies'],['100','Police'],['101','Fire'],['102','Ambulance'],
    ['1091','Women helpline'],['1098','Child helpline'],['1073','Road accident'],['139','Railway enquiry']],
  Pakistan: [['15','Police'],['16','Fire'],['1122','Rescue']],
};

export function TravelGuide() {
  const { loc } = useLoc();
  const [q, setQ] = useState('');
  const g = useData('guide', guidePool, { q: q || loc.name }, { auto: true, ttl: 864e5, deps: [loc.name] });
  return (<>
    <LocBar />
    <Search value={q} onChange={setQ} onSubmit={() => q.trim() && g.run({ q: q.trim() })}
      ph={`Guide for a city… (showing ${loc.name})`} />
    <div className="btnrow">{['Delhi','Amritsar','Jaipur','Goa','Manali','Lahore'].map((c) =>
      <button key={c} className="cat" onClick={() => { setQ(c); g.run({ q: c }); }}>{c}</button>)}</div>
    {g.loading && <Spin t="Loading guide" />}
    {g.error && <Err error={g.error} retry={() => g.run({ q: q || loc.name })} />}
    {g.data && (
      <Card>
        {g.data.thumb && <img src={g.data.thumb} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12 }} />}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: 1 }} className="gradtext">
          {g.data.title}</div>
        <p className="sm" style={{ marginTop: 8, lineHeight: 1.6 }}>{g.data.extract}</p>
        {g.data.url && <a className="btn ghost sm" style={{ marginTop: 10, display: 'inline-block', textDecoration: 'none' }}
          href={g.data.url} target="_blank" rel="noreferrer">Read full guide ↗</a>}
        <Src meta={g.meta} />
      </Card>)}
    <Card>
      <div className="chead">Emergency numbers — India</div>
      {EMERGENCY.India.map(([n, l]) => (
        <div className="kv" key={n}><span>{l}</span>
          <a href={`tel:${n}`} style={{ color: 'var(--green)', fontWeight: 800, fontSize: 16, textDecoration: 'none' }}>{n}</a>
        </div>))}
    </Card>
  </>);
}

/* ------------------------------------------------------------ MANDI PRICES */
const DGI_KEY = '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b'; // public sample key
const mandiPool = [
  { id: 'datagovin', label: 'data.gov.in', async run() {
      // NOTE: the public sample key returns a small page and server-side
      // filters[state] frequently yields 0 rows, so we pull a page and filter
      // in the client instead of trusting the filter param.
      const d = await jget(`https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070` +
        `?api-key=${DGI_KEY}&format=json&limit=500`);
      const rec = d.records || [];
      if (!rec.length) throw new Error('no records published right now');
      return rec.map((r) => ({ commodity: r.commodity, market: r.market, district: r.district,
        state: r.state, min: +r.min_price, max: +r.max_price, modal: +r.modal_price,
        date: r.arrival_date, variety: r.variety })); } },
];

export function Mandi() {
  const [state, setState] = useState('All');
  const [q, setQ] = useState('');
  const m = useData('mandi', mandiPool, {}, { ttl: 18e5 });
  const rows = m.data || [];
  const states = ['All', ...[...new Set(rows.map((r) => r.state).filter(Boolean))].sort()];
  const list = rows
    .filter((x) => state === 'All' || x.state === state)
    .filter((x) => !q || (x.commodity + x.market + x.district).toLowerCase().includes(q.toLowerCase()));
  return (<>
    {m.loading && <Spin t="Loading mandi prices" />}
    {m.error && <Err error={m.error} retry={() => m.run()} />}
    {m.data && (<>
      <div className="cats">{states.map((s2) =>
        <button key={s2} className={`cat ${state === s2 ? 'on' : ''}`} onClick={() => setState(s2)}>{s2}</button>)}</div>
      <Search value={q} onChange={setQ} ph="Filter commodity, market or district…" />
      <div className="dim sm" style={{ marginBottom: 8 }}>
        {list.length} entries · ₹ per quintal
        {rows.length < 30 && <> · <span style={{ color: 'var(--warn)' }}>
          the government feed publishes only a few markets at a time</span></>}
      </div>
      {list.length === 0
        ? <Empty t="No entries for this filter" />
        : <div className="list">
            {list.map((x, i) => (
              <div className="col" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b>{x.commodity}</b><b style={{ color: 'var(--green)' }}>₹{fmt(x.modal)}</b>
                </div>
                <span className="dim sm">{x.market}, {x.district} · {x.state}</span>
                <span className="dim sm">Range ₹{fmt(x.min)} – ₹{fmt(x.max)} · {x.date}</span>
              </div>))}
          </div>}
      <Src meta={m.meta} />
    </>)}
  </>);
}


/* ------------------------------------------------------------ METRO LINES */
const linePool = [
  { id: 'lines1', label: 'Lines', async run({ city }) { return lines(city, 0); } },
  { id: 'lines2', label: 'Lines 2', async run({ city }) { return lines(city, 1); } },
];
async function lines(city, epi) {
  const [s, w, n, e] = NETWORKS[city] || NETWORKS.Delhi;
  const q = `[out:json][timeout:30];relation["route"~"subway|light_rail"](${s},${w},${n},${e});out tags 80;`;
  const d = await ovp(EPS[epi], q);
  const seen = new Set();
  const out = (d.elements || []).map((x) => {
    const t = x.tags || {};
    const name = t.name || t.ref || '';
    if (!name) return null;
    const key = (t.colour || '') + name.replace(/\s*\(.*\)/, '');
    if (seen.has(key)) return null;
    seen.add(key);
    return { name, colour: t.colour || t.color || '', from: t.from || '', to: t.to || '',
      operator: t.operator || '', ref: t.ref || '' };
  }).filter(Boolean);
  if (!out.length) throw new Error('no lines');
  return out;
}

export function MetroLines() {
  const [city, setCity] = useState('Delhi');
  const l = useData('metrolines', linePool, { city }, { ttl: 6048e5, deps: [city] });
  return (<>
    <div className="cats">{Object.keys(NETWORKS).map((c) =>
      <button key={c} className={`cat ${city === c ? 'on' : ''}`} onClick={() => setCity(c)}>{c}</button>)}</div>
    {l.loading && <Spin t="Loading metro lines" />}
    {l.error && <Err error={l.error} retry={() => l.run()} />}
    {l.data && (<>
      <div className="dim sm" style={{ margin: '10px 0 8px' }}>{l.data.length} lines · {city}</div>
      <div className="list">
        {l.data.map((x, i) => (
          <div className="col" key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 13, height: 13, borderRadius: 4, flex: '0 0 auto',
                background: x.colour || 'var(--green)', border: '1px solid var(--line2)' }} />
              <b>{x.name}</b>
            </div>
            {(x.from || x.to) && <span className="dim sm">{x.from} → {x.to}</span>}
            {x.operator && <span className="dim sm">{x.operator}</span>}
          </div>))}
      </div>
      <Src meta={l.meta} />
    </>)}
  </>);
}

/* ------------------------------------------------------------ BUS ROUTES */
const busPool = [
  { id: 'busmap1', label: 'Bus map', async run(p) { return busRoutes(p, 0); } },
  { id: 'busmap2', label: 'Bus map 2', async run(p) { return busRoutes(p, 1); } },
];
async function busRoutes({ lat, lon, radius }, epi) {
  const q = `[out:json][timeout:30];relation["route"="bus"](around:${radius},${lat},${lon});out tags 120;`;
  const d = await ovp(EPS[epi], q);
  const seen = new Set();
  const out = (d.elements || []).map((x) => {
    const t = x.tags || {};
    const ref = t.ref || t.name || '';
    if (!ref || seen.has(ref)) return null;
    seen.add(ref);
    return { ref, name: t.name || '', from: t.from || '', to: t.to || '', operator: t.operator || '' };
  }).filter(Boolean);
  if (!out.length) throw new Error('no bus routes nearby');
  return out.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
}

export function BusRoutes() {
  const { loc } = useLoc();
  const [radius, setRadius] = useState(3000);
  const [q, setQ] = useState('');
  const b = useData('bus', busPool, { lat: loc.lat, lon: loc.lon, radius },
    { ttl: 864e5, deps: [loc.lat, loc.lon, radius] });
  const list = (b.data || []).filter((x) =>
    !q || (x.ref + x.name + x.from + x.to).toLowerCase().includes(q.toLowerCase()));
  return (<>
    <LocBar />
    <Chips items={[{v:2000,l:'2 km'},{v:3000,l:'3 km'},{v:5000,l:'5 km'},{v:10000,l:'10 km'}]}
      value={radius} onPick={setRadius} />
    {b.loading && <Spin t="Finding bus routes near you" />}
    {b.error && <Err error={b.error} retry={() => b.run()} />}
    {b.data && (<>
      <Search value={q} onChange={setQ} ph="Filter route number or stop…" />
      <div className="dim sm" style={{ marginBottom: 8 }}>{list.length} routes within {radius/1000} km</div>
      <div className="list">
        {list.slice(0, 80).map((x, i) => (
          <div className="row" key={i}>
            <span style={{ minWidth: 52, padding: '5px 8px', borderRadius: 8, textAlign: 'center',
              background: 'var(--s3)', color: 'var(--green)', fontWeight: 800, fontSize: 12.5,
              flex: '0 0 auto' }}>{x.ref}</span>
            <div className="main">
              <b style={{ fontSize: 13 }}>{x.from && x.to ? `${x.from} → ${x.to}` : x.name}</b>
              {x.operator && <span className="dim sm">{x.operator}</span>}
            </div>
          </div>))}
      </div>
      <Src meta={b.meta} />
    </>)}
  </>);
}
