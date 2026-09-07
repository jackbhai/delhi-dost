/** Live tools — every one backed by a multi-provider pool. */
import React, { useEffect, useState } from 'react';
import * as P from '../core/providers';
import { useLoc, LocBar } from '../core/geo';
import { useData, useDebounced, Spin, Err, Empty, Src, Search, Card, Stat, Chips, Field, Copy, fmt, wmo } from '../ui/kit';
import { Icon } from '../ui/icons';

const IST = 'Asia/Kolkata';

/* ---------------------------------------------------------------- WEATHER */
/**
 * Weather + air quality.
 *
 * Two fixes went in here, and both were real bugs rather than polish:
 *
 *  1. The air-quality card used to show a number that was not this city's.
 *     Its second provider authenticated with a public demo token that answers
 *     EVERY coordinate on Earth with one station in Shanghai — measured across
 *     Delhi, Mumbai, London and New York, all returning the identical reading
 *     with status "ok". That provider is gone (see src/core/providers.js) and
 *     air quality now comes from a model that returns a distinct value per
 *     coordinate, with a second independent read as failover.
 *
 *  2. The hourly strip started at midnight, so for most of the day it opened
 *     with hours that had already passed. It now starts at the current hour.
 *
 * The card also shows WHICH pollutant is driving the index, a 3-day air
 * forecast, and the observation timestamp — because an AQI number with no time
 * attached is not information.
 */
const AQ_BANDS = [
  { max: 50,  n: 'Good',        c: 'var(--green)', s: 'Air is clean. Nothing to avoid.' },
  { max: 100, n: 'Moderate',    c: '#a3e635',      s: 'Fine for almost everyone; unusually sensitive people may notice it.' },
  { max: 150, n: 'Unhealthy for sensitive groups', c: 'var(--warn)', s: 'Children, older people and anyone with asthma should ease off long outdoor effort.' },
  { max: 200, n: 'Unhealthy',   c: '#fb923c',      s: 'Everyone may feel it. Cut back on strenuous time outdoors.' },
  { max: 300, n: 'Very unhealthy', c: 'var(--bad)', s: 'Serious. Stay in where you can, and mask outdoors.' },
  { max: 1e9, n: 'Hazardous',   c: '#b91c1c',      s: 'Emergency conditions. Avoid going out.' },
];
const band = (v) => v == null ? null : AQ_BANDS.find((b) => v <= b.max);

export function Weather() {
  // Location comes from the global auto-detector (GPS -> IP -> default), so the
  // user never has to type a city.
  const { loc: auto } = useLoc();
  const [loc, setLoc] = useState(auto);
  useEffect(() => { setLoc(auto); }, [auto.lat, auto.lon]);   // eslint-disable-line
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  /* spread:false — the engine normally rotates between providers to share
     load, but these three are NOT equivalent: the primary carries UV, gusts
     and visibility and the fallbacks do not. Rotating meant a second city
     silently rendered a thinner card, which reads as a bug. Order is fixed;
     the fallbacks are still used the moment the primary fails. */
  const w = useData('weather', P.weather, { lat: loc.lat, lon: loc.lon },
    { ttl: 3e5, deps: [loc.lat, loc.lon], spread: false });
  const a = useData('air', P.air, { lat: loc.lat, lon: loc.lon }, { ttl: 3e5, deps: [loc.lat, loc.lon] });
  const g = useData('geocode', P.geocode, { q: dq }, { auto: false });
  useEffect(() => { if (dq.trim().length >= 2) g.run({ q: dq }); }, [dq]);  // eslint-disable-line

  const aq = a.data;
  const usBand = band(aq?.usaqi);
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const compass = (deg) => deg == null ? '' :
    ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg / 22.5) % 16];

  return (<><LocBar /><Search value={q} onChange={setQ} ph="Or search another city…" /><div className="btnrow">
      {['New Delhi','Amritsar','Mumbai','Bengaluru','Kolkata','Lahore','Dubai','London'].map((c) =>
        <button key={c} className="cat" onClick={() => setQ(c)}>{c}</button>)}
    </div>
    {q.trim().length >= 2 && g.data?.length > 0 && (
      <div className="list" style={{ marginTop: 10 }}>
        {g.data.slice(0, 5).map((r, i) => (
          <button key={i} className="col" style={{ background: 'none', border: 0, textAlign: 'left', width: '100%', cursor: 'pointer' }}
            onClick={() => { setLoc({ lat: r.lat, lon: r.lon, name: r.name }); setQ(''); }}><b>{r.name}</b><span className="dim sm">{[r.admin, r.country].filter(Boolean).join(', ')}</span></button>))}
      </div>)}

    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 30, letterSpacing: 1, margin: '14px 0 10px' }}>{loc.name}</h2>

    {w.loading && <Spin t="Reading the sky" />}
    {w.error && <Err error={w.error} retry={() => w.run()} />}
    {w.data && (<><Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ color: 'var(--green)', lineHeight: 1 }}><Icon n={wmo(w.data.code)[1]} size={54} /></div>
        <div><div className="big">{fmt(w.data.temp, 1)}<span style={{ fontSize: 20 }}>°C</span></div>
          <div className="dim sm">{wmo(w.data.code)[0]} · feels {fmt(w.data.feels)}°</div>
          {w.data.observedAt && <div className="dim" style={{ fontSize: 10.5, marginTop: 2 }}>
            observed {hhmm(w.data.observedAt)}</div>}</div>
      </div>
      <div className="g3" style={{ marginTop: 14 }}>
        <Stat l="Humidity" v={fmt(w.data.humidity) + '%'} />
        <Stat l="Wind" v={fmt(w.data.wind, 1)} s={`km/h ${compass(w.data.dir)}`} />
        <Stat l="Rain" v={fmt(w.data.precip, 1)} s="mm" />
      </div>
      <div className="g3" style={{ marginTop: 8 }}>
        {w.data.gust != null && <Stat l="Gusts" v={fmt(w.data.gust, 0)} s="km/h" />}
        {w.data.cloud != null && <Stat l="Cloud" v={fmt(w.data.cloud) + '%'} />}
        {w.data.uv != null && <Stat l="UV index" v={fmt(w.data.uv, 1)} />}
      </div>
      <div className="g3" style={{ marginTop: 8 }}>
        {w.data.visibility != null && <Stat l="Visibility" v={fmt(w.data.visibility, 1)} s="km" />}
        {w.data.dew != null && <Stat l="Dew point" v={fmt(w.data.dew, 1) + '°'} />}
        {w.data.pressure != null && <Stat l="Pressure" v={fmt(w.data.pressure, 0)} s="hPa" />}
      </div>
      {w.data.sunrise && (
        <div className="g2" style={{ marginTop: 8 }}>
          <Stat l="Sunrise" v={hhmm(w.data.sunrise)} />
          <Stat l="Sunset" v={hhmm(w.data.sunset)} /></div>)}
      <Src meta={w.meta} /></Card>

      {a.loading && !aq && <Spin t="Sampling the air" />}
      {a.error && <Err error={a.error} retry={() => a.run()} />}
      {aq && (
        <Card>
          <div className="chead">Air quality</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div className="big" style={{ color: usBand?.c }}>{fmt(aq.usaqi)}</div>
            <div><div style={{ color: usBand?.c, fontWeight: 700, fontSize: 13.5 }}>{usBand?.n}</div>
              <div className="dim" style={{ fontSize: 10.5 }}>US AQI{aq.aqi != null ? ` · European ${fmt(aq.aqi)}` : ''}</div></div>
          </div>
          {usBand && <p className="dim sm" style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{usBand.s}</p>}
          {aq.parts?.length > 0 && (
            <div className="dim sm" style={{ marginTop: 8 }}>
              Driven by <b style={{ color: 'var(--cyan)' }}>{aq.parts[0][0]}</b>
              {aq.parts.length > 1 ? `, then ${aq.parts[1][0]}` : ''}
            </div>)}
          <div className="g3" style={{ marginTop: 12 }}>
            <Stat l="PM2.5" v={fmt(aq.pm25, 1)} s="ug/m3" />
            <Stat l="PM10" v={fmt(aq.pm10, 1)} s="ug/m3" />
            <Stat l="Ozone" v={fmt(aq.o3, 1)} s="ug/m3" />
          </div>
          <div className="g3" style={{ marginTop: 8 }}>
            <Stat l="NO2" v={fmt(aq.no2, 1)} s="ug/m3" />
            <Stat l="SO2" v={fmt(aq.so2, 1)} s="ug/m3" />
            <Stat l="CO" v={fmt(aq.co, 0)} s="ug/m3" />
          </div>
          {(aq.dust != null || aq.nh3 != null) && (
            <div className="g2" style={{ marginTop: 8 }}>
              {aq.dust != null && <Stat l="Dust" v={fmt(aq.dust, 1)} s="ug/m3" />}
              {aq.nh3 != null && <Stat l="Ammonia" v={fmt(aq.nh3, 1)} s="ug/m3" />}
            </div>)}
          {aq.forecast?.length > 0 && (<>
            <div className="chead" style={{ marginTop: 14 }}>Next 24 hours</div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {aq.forecast.filter((_, i) => i % 3 === 0).slice(0, 9).map((h, i) => {
                const b = band(h.us);
                return (
                  <div key={i} style={{ flex: '0 0 auto', width: 54, textAlign: 'center',
                    background: 'var(--s2)', borderRadius: 10, padding: '8px 0' }}>
                    <div style={{ color: b?.c, fontWeight: 700, fontSize: 14 }}>{fmt(h.us)}</div>
                    <div className="dim" style={{ fontSize: 9.5, marginTop: 2 }}>
                      {new Date(h.t).toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false })}h</div>
                  </div>);
              })}
            </div>
          </>)}
          {aq.at && <div className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>Sampled {hhmm(aq.at)}</div>}
          <Src meta={a.meta} /></Card>)}

      {w.data.hourly?.length > 0 && (<>
        <div className="chead" style={{ marginTop: 16 }}>Next 24 hours</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {w.data.hourly.filter((_, i) => i % 2 === 0).map((h, i) => (
            <div key={i} style={{ flex: '0 0 auto', width: 58, textAlign: 'center',
              background: 'var(--s2)', borderRadius: 10, padding: '9px 0' }}>
              <div className="dim" style={{ fontSize: 9.5 }}>
                {new Date(h.t).toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false })}h</div>
              <div style={{ color: 'var(--green)', display: 'grid', placeItems: 'center', margin: '4px 0' }}>
                <Icon n={wmo(h.code)[1]} size={17} /></div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(h.v)}°</div>
              {h.pop > 0 && <div style={{ fontSize: 9.5, color: 'var(--cyan)' }}>{h.pop}%</div>}
            </div>))}
        </div>
      </>)}

      <div className="chead" style={{ marginTop: 16 }}>7-day forecast</div><div className="list">
        {w.data.daily.map((d, i) => (
          <div className="row" key={i}><span style={{ flex: 1, fontSize: 13.5 }}>
              {i === 0 ? 'Today' : new Date(d.date).toLocaleDateString('en', { weekday: 'short', day: 'numeric' })}
            </span><span style={{ color: 'var(--green)', display: 'grid', placeItems: 'center' }}><Icon n={wmo(d.code)[1]} size={20} /></span>
            {d.pop != null && <span style={{ color: 'var(--cyan)', fontSize: 11, width: 34, textAlign: 'right' }}>{d.pop}%</span>}
            <span style={{ fontSize: 13.5, width: 74, textAlign: 'right' }}><b>{fmt(d.max)}°</b><span className="dim">{fmt(d.min)}°</span></span></div>))}
      </div></>)}
  </>);
}

/* ---------------------------------------------------------------- WORLD CLOCK */
const ZONES = [
  ['Asia/Kolkata','🇮🇳 Delhi'], ['Asia/Karachi','🇵🇰 Karachi'], ['Asia/Dubai','🇦🇪 Dubai'],
  ['Europe/London','🇬🇧 London'], ['America/New_York','🇺🇸 New York'], ['America/Los_Angeles','🇺🇸 LA'],
  ['Asia/Singapore','🇸🇬 Singapore'], ['Asia/Tokyo','🇯🇵 Tokyo'], ['Australia/Sydney','🇦🇺 Sydney'],
  ['Europe/Paris','🇫🇷 Paris'], ['Asia/Shanghai','🇨🇳 Shanghai'], ['America/Toronto','🇨🇦 Toronto'],
];
export function WorldClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (<><Card><div className="chead">🇮🇳 India Standard Time</div><div className="big gradtext mono">
        {now.toLocaleTimeString('en-GB', { timeZone: IST, hour12: false })}
      </div><div className="dim sm" style={{ marginTop: 6 }}>
        {now.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div><div className="src"><span className="dot" /><span>Live · runs offline (Intl API)</span></div></Card><div className="list" style={{ marginTop: 12 }}>
      {ZONES.map(([tz, label]) => {
        const t = now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
        const d = now.toLocaleDateString('en-IN', { timeZone: tz, day: 'numeric', month: 'short' });
        const off = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
          .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || '';
        return (
          <div className="row" key={tz}><div className="main"><b>{label}</b><span className="dim sm">{d} · {off}</span></div><div className="end mono" style={{ fontSize: 16, fontWeight: 700 }}>{t}</div></div>);
      })}
    </div></>);
}

/* ---------------------------------------------------------------- FESTIVALS */
const CCS = [['IN','🇮🇳 India'],['PK','🇵🇰 Pakistan'],['US','🇺🇸 USA'],['GB','🇬🇧 UK'],
  ['AE','🇦🇪 UAE'],['CA','🇨🇦 Canada'],['AU','🇦🇺 Australia'],['SG','🇸🇬 Singapore'],
  ['BD','🇧🇩 Bangladesh'],['NP','🇳🇵 Nepal'],['LK','🇱🇰 Sri Lanka'],['MY','🇲🇾 Malaysia']];
export function Festivals() {
  const [cc, setCc] = useState('IN');
  const [year, setYear] = useState(new Date().getFullYear());
  const h = useData('holidays', P.holidays, { cc, year }, { ttl: 864e5, deps: [cc, year] });
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (h.data || []).filter((x) => x.date >= today);
  const next = upcoming[0];
  return (<><div className="cats">{CCS.map(([c, l]) =><button key={c} className={`cat ${cc===c?'on':''}`} onClick={() => setCc(c)}>{l}</button>)}</div><div className="btnrow">{[year-1, year, year+1].map((y) =><button key={y} className={`cat ${year===y?'on':''}`} onClick={() => setYear(y)}>{y}</button>)}</div>
    {h.loading && <Spin t="Loading festivals" />}
    {h.error && <Err error={h.error} retry={() => h.run()} />}
    {h.data && (<>
      {next && (
        <Card style={{ marginTop: 12 }}><div className="chead">Next festival</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 30, letterSpacing: 1 }} className="gradtext">{next.name}</div><div className="dim sm" style={{ marginTop: 4 }}>
            {new Date(next.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}{Math.ceil((new Date(next.date) - new Date()) / 864e5)} days away
          </div></Card>)}
      <div className="dim sm" style={{ margin: '12px 0 8px' }}>{h.data.length} holidays in {year}</div><div className="list">
        {h.data.map((x, i) => {
          const past = x.date < today;
          const d = new Date(x.date);
          return (
            <div className="row" key={i} style={{ opacity: past ? .38 : 1 }}><div style={{ width: 46, textAlign: 'center', background: 'var(--s2)', borderRadius: 10, padding: '6px 0', flex: '0 0 auto' }}><b style={{ display: 'block', fontSize: 16, lineHeight: 1 }}>{d.getDate()}</b><span style={{ fontSize: 9, color: 'var(--fg3)', textTransform: 'uppercase' }}>
                  {d.toLocaleDateString('en', { month: 'short' })}</span></div><div className="main"><b>{x.name}</b><span className="dim sm">{d.toLocaleDateString('en', { weekday: 'long' })}</span></div></div>);
        })}
      </div><Src meta={h.meta} /></>)}
  </>);
}

/* ---------------------------------------------------------------- ON THIS DAY */
export function OnThisDay() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  const o = useData('otd', P.onthisday, { m, d }, { ttl: 864e5 });
  const [kind, setKind] = useState('Event');
  return (<><div className="dim sm" style={{ marginBottom: 10 }}>
      {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })} through history
    </div><Chips items={['Event','Born','Died','Holiday']} value={kind} onPick={setKind} />
    {o.loading && <Spin />}
    {o.error && <Err error={o.error} retry={() => o.run()} />}
    {o.data && (<><div className="list" style={{ marginTop: 10 }}>
        {o.data.filter((x) => x.kind === kind).map((x, i) => (
          x.url ? <a className="col" key={i} href={x.url} target="_blank" rel="noreferrer">
            {x.year && <b className="gradtext" style={{ fontSize: 16 }}>{x.year}</b>}
            <span className="sm">{x.text}</span></a>
          : <div className="col" key={i}>{x.year && <b>{x.year}</b>}<span className="sm">{x.text}</span></div>))}
      </div><Src meta={o.meta} /></>)}
  </>);
}

/* ---------------------------------------------------------------- CURRENCY */
export function Currency() {
  const [base, setBase] = useState('USD'), [amt, setAmt] = useState('100');
  const c = useData('fx', P.currency, { base }, { ttl: 36e5, deps: [base] });
  const FAV = ['INR','PKR','USD','EUR','GBP','AED','SAR','CAD','AUD','SGD','JPY','CNY'];
  const n = parseFloat(amt) || 0;
  return (<><div className="g2"><Field label="Amount" type="number" inputMode="decimal" value={amt} onChange={(e)=>setAmt(e.target.value)} /><Field label="From" as="select" value={base} onChange={(e)=>setBase(e.target.value)}>
        {['USD','INR','PKR','EUR','GBP','AED','SAR','JPY','AUD','CAD','CHF','CNY','SGD'].map((x)=><option key={x}>{x}</option>)}
      </Field></div>
    {c.loading && <Spin t="Fetching rates" />}
    {c.error && <Err error={c.error} retry={()=>c.run()} />}
    {c.data && (
      <Card><div className="chead">{fmt(n,2)} {c.data.base} equals</div>
        {FAV.filter((x)=>x!==base && c.data.rates[x]).map((x)=>(
          <div className="kv" key={x}><span style={{fontWeight:700,color:'var(--fg)'}}>{x}</span><b style={{fontSize:16}}>{fmt(n*c.data.rates[x],2)}
              <span className="dim sm" style={{fontWeight:400,marginLeft:8}}>@{fmt(c.data.rates[x],4)}</span></b></div>))}
        <div className="dim sm" style={{marginTop:8}}>Rate date: {c.data.date}</div><Src meta={c.meta} /></Card>)}
  </>);
}

/* ---------------------------------------------------------------- CRYPTO */
export function Crypto() {
  const c = useData('crypto', P.crypto, {}, { ttl: 6e4 });
  return (<><div className="btnrow"><button className="btn ghost sm" onClick={()=>c.run()}> Refresh</button></div>
    {c.loading && <Spin t="Loading markets" />}
    {c.error && <Err error={c.error} retry={()=>c.run()} />}
    {c.data && (<><div className="list">
        {c.data.map((x,i)=>(
          <div className="row" key={i}><span className="dim mono" style={{width:22,fontSize:11}}>{x.rank}</span><div className="main"><b>{x.sym}</b><span className="dim sm">{x.name}</span></div><div className="end"><b>${fmt(x.price, x.price<1?6:2)}</b><br/><span style={{color:x.change>=0?'var(--green)':'var(--bad)',fontSize:11.5}}>
                {x.change>=0?'▲':'▼'} {fmt(Math.abs(x.change),2)}%</span></div></div>))}
      </div><Src meta={c.meta} /></>)}
  </>);
}

/* ---------------------------------------------------------------- INDIA */
export function Pincode() {
  const [q, setQ] = useState('');
  const p = useData('pin', P.pincode, { q }, { auto: false });
  const go = () => /^\d{6}$/.test(q.trim()) && p.run({ q: q.trim() });
  return (<><Search value={q} onChange={setQ} onSubmit={go} ph="6-digit PIN code" /><div className="btnrow">{['110001','143001','400001','560001','700001'].map((x)=><button key={x} className="cat" onClick={()=>{setQ(x);p.run({q:x});}}>{x}</button>)}</div>
    {p.loading && <Spin />}
    {p.error && <Err error={p.error} retry={go} />}
    {p.data && (<><div className="dim sm" style={{margin:'10px 0'}}>{p.data.length} post office(s)</div><div className="list">{p.data.map((x,i)=>(
        <div className="col" key={i}><b>{x.name}</b><span className="dim sm">{x.branch} · {x.district}, {x.state}</span>
          {x.division && <span className="dim sm">Division {x.division} · Circle {x.circle}</span>}
        </div>))}</div><Src meta={p.meta} /></>)}
  </>);
}

export function Ifsc() {
  const [q, setQ] = useState('');
  const f = useData('ifsc', P.ifsc, { q }, { auto: false });
  const go = () => q.trim().length === 11 && f.run({ q: q.trim() });
  return (<><Search value={q} onChange={(v)=>setQ(v.toUpperCase())} onSubmit={go} ph="IFSC e.g. HDFC0000001" /><div className="btnrow">{['HDFC0000001','SBIN0000001','ICIC0000001'].map((x)=><button key={x} className="cat" onClick={()=>{setQ(x);f.run({q:x});}}>{x}</button>)}</div>
    {f.loading && <Spin />}
    {f.error && <Err error={f.error} retry={go} />}
    {f.data && (
      <Card><div className="chead">{f.data.bank}</div><div className="kv"><span>Branch</span><b>{f.data.branch}</b></div><div className="kv"><span>IFSC</span><b className="mono">{f.data.ifsc}</b></div>
        {f.data.micr && <div className="kv"><span>MICR</span><b className="mono">{f.data.micr}</b></div>}
        <div className="kv"><span>City</span><b>{f.data.city}</b></div><div className="kv"><span>State</span><b>{f.data.state}</b></div><div className="kv"><span>Address</span><b style={{fontWeight:400,fontSize:12.5}}>{f.data.address}</b></div><div className="btnrow">{[['UPI',f.data.upi],['NEFT',f.data.neft],['IMPS',f.data.imps],['RTGS',f.data.rtgs]]
          .map(([k,v])=><span key={k} className={`tag ${v?'g':''}`}>{k} {v?'':''}</span>)}</div><Src meta={f.meta} /></Card>)}
  </>);
}

/* ---------------------------------------------------------------- GENERIC SEARCH */
function SearchTool({ cap, pool, ph, presets = [], render, initial = '' }) {
  const [q, setQ] = useState(initial);
  const s = useData(cap, pool, { q }, { auto: !!initial });
  const go = () => q.trim() && s.run({ q: q.trim() });
  return (<><Search value={q} onChange={setQ} onSubmit={go} ph={ph} />
    {presets.length > 0 && <div className="btnrow">{presets.map((x)=><button key={x} className="cat" onClick={()=>{setQ(x);s.run({q:x});}}>{x}</button>)}</div>}
    {s.loading && <Spin />}
    {s.error && <Err error={s.error} retry={go} />}
    {s.data && s.data.length === 0 && <Empty />}
    {s.data && s.data.length > 0 && <>{render(s.data)}<Src meta={s.meta} /></>}
  </>);
}

export const Wikipedia = () =><SearchTool cap="wiki" pool={P.wiki} ph="Search Wikipedia…"
  presets={['Punjab','ISRO','Delhi','Cricket']} render={(d)=>(
  <div className="list">{d.map((p,i)=>(
    <a className="col" key={i} href={p.url} target="_blank" rel="noreferrer"><b>{p.title}</b>{p.desc && <span className="dim sm">{p.desc}</span>}
      {p.excerpt && <span className="sm">{p.excerpt}</span>}</a>))}</div>)} />;

export const Dictionary = () =><SearchTool cap="dict" pool={P.dictionary} ph="Look up a word…"
  presets={['serendipity','ephemeral','resilience']} render={(d)=>(
  <Card><div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12}}><b style={{fontSize:24,fontFamily:'var(--font-display)',letterSpacing:1}}>{d.word}</b>
      {d.phonetic && <span className="dim mono sm">{d.phonetic}</span>}
      {d.audio && <button className="btn ghost sm" onClick={()=>new Audio(d.audio).play()}></button>}
    </div>
    {d.meanings.map((m,i)=>(
      <div key={i} style={{marginBottom:14}}><div style={{fontStyle:'italic',color:'var(--cyan)',fontSize:12.5,marginBottom:6}}>{m.pos}</div><ol style={{paddingLeft:20,display:'flex',flexDirection:'column',gap:7}}>
          {m.defs.map((x,j)=><li key={j} className="sm">{x.d}
            {x.ex && <div className="dim sm" style={{fontStyle:'italic',marginTop:3}}>"{x.ex}"</div>}</li>)}
        </ol></div>))}
  </Card>)} />;

export const News = () =><SearchTool cap="news" pool={P.news} ph="Search tech news…" initial=" "
  render={(d)=>(<div className="list">{d.map((h,i)=>(
    <a className="col" key={i} href={h.url} target="_blank" rel="noreferrer"><b>{h.title}</b><span className="dim sm">▲ {h.points} ·  {h.comments} · {h.author} · {h.date}</span></a>))}</div>)} />;

export const Movies = () =><SearchTool cap="movies" pool={P.movies} ph="Search movies & shows…"
  presets={['Dune','Sacred Games','3 Idiots']} render={(d)=>(
  <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))'}}>
    {d.map((m,i)=>(
      <div className="tile" key={i} style={{padding:0,overflow:'hidden',minHeight:0,display:'block'}}>
        {m.img ? <img src={m.img} alt="" loading="lazy" style={{width:'100%',aspectRatio:'2/3',objectFit:'cover'}} />
          : <div style={{aspectRatio:'2/3',display:'grid',placeItems:'center',fontSize:30,background:'var(--s2)'}}><Icon n="film" size={18} /></div>}
        <div style={{padding:9,textAlign:'left'}}><b style={{fontSize:12,display:'block'}}>{m.title}</b><span className="dim" style={{fontSize:10.5}}>{String(m.year).slice(0,4)}{m.rating?` ·  ${m.rating}`:''}</span></div></div>))}
  </div>)} />;

export const Books = () =><SearchTool cap="books" pool={P.books} ph="Search books…"
  presets={['Ramayana','Premchand','Tagore']} render={(d)=>(
  <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))'}}>
    {d.map((b,i)=>(
      <a className="tile" key={i} href={b.url} target="_blank" rel="noreferrer"
        style={{padding:0,overflow:'hidden',minHeight:0,display:'block',textDecoration:'none'}}>
        {b.cover ? <img src={b.cover} alt="" loading="lazy" style={{width:'100%',aspectRatio:'2/3',objectFit:'cover'}} />
          : <div style={{aspectRatio:'2/3',display:'grid',placeItems:'center',fontSize:30,background:'var(--s2)'}}><Icon n="book" size={20} /></div>}
        <div style={{padding:9,textAlign:'left'}}><b style={{fontSize:11.5,display:'block'}}>{b.title.slice(0,44)}</b><span className="dim" style={{fontSize:10}}>{b.author}</span></div></a>))}
  </div>)} />;

export const Repos = () =><SearchTool cap="gh" pool={P.github} ph="Search GitHub…"
  presets={['react','fastapi','llm']} render={(d)=>(
  <div className="list">{d.map((r,i)=>(
    <a className="col" key={i} href={r.url} target="_blank" rel="noreferrer"><b>{r.name}</b>{r.desc && <span className="dim sm">{r.desc}</span>}
      <span className="sm"> {fmt(r.stars)} · ⑂ {fmt(r.forks)}{r.lang?` · ${r.lang}`:''}</span></a>))}</div>)} />;

export const Countries = () =><SearchTool cap="country" pool={P.country} ph="Search a country…"
  presets={['India','Pakistan','Japan']} render={(d)=>(
  <>{d.map((c,i)=>(
    <Card key={i}><div className="chead">{c.flag && <img src={c.flag} alt="" style={{width:26,height:18,borderRadius:3,objectFit:'cover'}} />} {c.name}</div>
      {c.capital && <div className="kv"><span>Capital</span><b>{c.capital}</b></div>}
      {c.population != null && <div className="kv"><span>Population</span><b>{fmt(c.population)}</b></div>}
      <div className="kv"><span>Region</span><b>{c.region}</b></div>
      {c.languages && <div className="kv"><span>Languages</span><b style={{fontSize:12.5}}>{c.languages}</b></div>}
      {c.currencies && <div className="kv"><span>Currency</span><b style={{fontSize:12.5}}>{c.currencies}</b></div>}
    </Card>))}</>)} />;

/* ---------------------------------------------------------------- SPACE */
export function Space() {
  const i = useData('iss', P.iss, {}, { ttl: 5000 });
  const a = useData('astros', P.astros, {}, { ttl: 36e5 });
  useEffect(() => { const t = setInterval(() => i.run(), 10000); return () => clearInterval(t); }, []); // eslint-disable-line
  return (<><Card><div className="chead"><Icon n="satellite" size={17} /> ISS live position</div>
      {i.loading && !i.data && <Spin t="Tracking" />}
      {i.error && <Err error={i.error} retry={()=>i.run()} />}
      {i.data && (<><div className="g2"><Stat l="Latitude" v={fmt(i.data.lat,3)} /><Stat l="Longitude" v={fmt(i.data.lon,3)} /></div>
        {i.data.alt != null && <div className="g2" style={{marginTop:8}}><Stat l="Altitude" v={fmt(i.data.alt,1)} s="km" /><Stat l="Speed" v={fmt(i.data.vel)} s="km/h" /></div>}
        <a className="btn ghost" style={{display:'block',textAlign:'center',marginTop:10,textDecoration:'none'}}
          href={`https://www.openstreetmap.org/?mlat=${i.data.lat}&mlon=${i.data.lon}#map=3/${i.data.lat}/${i.data.lon}`}
          target="_blank" rel="noreferrer">View on map </a><Src meta={i.meta} /></>)}
    </Card>
    {a.data && (
      <Card><div className="chead">‍ People in space right now — {a.data.length}</div>
        {a.data.map((p,x)=><div className="kv" key={x}><span>{p.craft}</span><b>{p.name}</b></div>)}
        <Src meta={a.meta} /></Card>)}
  </>);
}

export function Quakes() {
  const q = useData('quakes', P.quakes, {}, { ttl: 3e5 });
  return (<>
    {q.loading && <Spin t="Reading seismographs" />}
    {q.error && <Err error={q.error} retry={()=>q.run()} />}
    {q.data && (<><div className="list">{q.data.map((x,i)=>(
        <a className="row" key={i} href={x.url} target="_blank" rel="noreferrer"><div style={{width:44,height:44,borderRadius:11,display:'grid',placeItems:'center',flex:'0 0 auto',
            background:x.mag>=6?'rgba(255,92,122,.18)':x.mag>=4.5?'rgba(255,209,102,.16)':'var(--s2)',
            color:x.mag>=6?'var(--bad)':x.mag>=4.5?'var(--warn)':'var(--fg2)',fontWeight:800,fontSize:15}}>
            {x.mag?.toFixed(1)}</div><div className="main"><b style={{fontSize:13}}>{x.place}</b><span className="dim sm">{new Date(x.time).toLocaleString('en-IN')} · {fmt(x.depth,1)} km deep</span></div></a>))}</div><Src meta={q.meta} /></>)}
  </>);
}

/* ---------------------------------------------------------------- MISC LIVE */
export function MyIp() {
  const i = useData('ip', P.ipinfo, {}, { ttl: 6e5 });
  return (<>
    {i.loading && <Spin />}
    {i.error && <Err error={i.error} retry={()=>i.run()} />}
    {i.data && (<Card><div className="chead">Your connection</div><div className="big mono gradtext" style={{fontSize:26}}>{i.data.ip}</div>
      {i.data.city && <><div className="kv" style={{marginTop:12}}><span>Location</span><b>{[i.data.city,i.data.region,i.data.country].filter(Boolean).join(', ')}</b></div><div className="kv"><span>ISP</span><b style={{fontSize:12.5}}>{i.data.org}</b></div><div className="kv"><span>Timezone</span><b>{i.data.tz}</b></div></>}
      <div className="btnrow"><Copy text={i.data.ip} label="Copy IP" /></div><Src meta={i.meta} /></Card>)}
  </>);
}

export function Jokes() {
  const j = useData('joke', P.jokes, {}, { ttl: 0 });
  return (<Card>
    {j.loading && <Spin />}
    {j.error && <Err error={j.error} retry={()=>j.run()} />}
    {j.data && (<><div style={{fontSize:16,lineHeight:1.5}}>{j.data.setup}</div><div className="gradtext" style={{fontSize:18,fontWeight:700,marginTop:12}}>{j.data.punch}</div><button className="btn" style={{marginTop:14,width:'100%'}} onClick={()=>j.run()}> Another</button><Src meta={j.meta} /></>)}
  </Card>);
}

export function Quotes() {
  const q = useData('quote', P.quotes, {}, { ttl: 0 });
  return (<Card>
    {q.loading && <Spin />}
    {q.error && <Err error={q.error} retry={()=>q.run()} />}
    {q.data && (<><div style={{fontSize:17,lineHeight:1.55,fontStyle:'italic'}}>"{q.data.text}"</div><div className="dim" style={{marginTop:10}}>— {q.data.author}</div><div className="btnrow"><button className="btn sm" onClick={()=>q.run()}> New</button><Copy text={`"${q.data.text}" — ${q.data.author}`} /></div><Src meta={q.meta} /></>)}
  </Card>);
}

export function NameGuess() {
  const [q, setQ] = useState('');
  const n = useData('name', P.nameInfo, { q }, { auto: false });
  return (<><Search value={q} onChange={setQ} onSubmit={()=>q.trim()&&n.run({q:q.trim()})} ph="Enter a first name…" /><div className="btnrow">{['Arjun','Priya','Ahmed','Simran'].map((x)=><button key={x} className="cat" onClick={()=>{setQ(x);n.run({q:x});}}>{x}</button>)}</div>
    {n.loading && <Spin />}
    {n.error && <Err error={n.error} />}
    {n.data && (<Card><div className="chead">Prediction for "{n.data.name}"</div><div className="g2"><Stat l="Likely age" v={n.data.age ?? '—'} /><Stat l="Gender" v={n.data.gender ?? '—'} s={n.data.prob?`${Math.round(n.data.prob*100)}% sure`:''} /></div><div className="dim sm" style={{marginTop:10}}>Based on {fmt(n.data.count)} records</div><Src meta={n.meta} /></Card>)}
  </>);
}
