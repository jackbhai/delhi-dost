/**
 * Country reference, emergency numbers and a name lookup.
 *
 * Every source here was probed live before being used. The ones that failed
 * are simply absent rather than shipped as dead tiles:
 *   restcountries.com          DEPRECATED on /v3.1, /v3 and /v4 — this is why
 *                              the old Countries tool was broken
 *   emergencynumberapi.com     404 on every endpoint
 *   behindthename              needs a paid key
 * What is used instead:
 *   mledoze/countries          250 countries, full detail, static on jsDelivr
 *   agify / genderize /
 *   nationalize                real statistical name data, CORS enabled
 */
import React, { useCallback, useEffect, useState } from 'react';
import { allCountries, findCountry, countryByDial, emergencyFor,
         INDIA_HELPLINES } from '../core/world';
import { Card, Spin, Empty, Err, fmt } from '../ui/kit';
import { Icon } from '../ui/icons';

const call = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

/* ------------------------------------------------------ emergency numbers */
export function Emergency() {
  const [tab, setTab] = useState('india');
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (tab !== 'world' || list) return;
    allCountries().then(setList).catch(() => setErr('Could not load the country list'));
  }, [tab, list]);

  const shown = (list || []).filter((c) => {
    if (!emergencyFor(c.cca2)) return false;
    const s = q.toLowerCase().trim();
    return !s || c.name.toLowerCase().includes(s) || c.cca2.toLowerCase() === s;
  });

  return (<>
    <div className="cats">
      <button className={`cat ${tab === 'india' ? 'on' : ''}`} onClick={() => setTab('india')}>India</button>
      <button className={`cat ${tab === 'world' ? 'on' : ''}`} onClick={() => setTab('world')}>World</button>
    </div>

    {tab === 'india' && (<>
      <Card>
        <div className="chead"><Icon n="warn" size={16} /> One number for everything</div>
        <a className="btn" href={call('112')} style={{ width: '100%', textAlign: 'center',
          display: 'block', textDecoration: 'none', fontSize: 20, padding: '14px 0' }}>112</a>
        <div className="dim sm" style={{ marginTop: 8 }}>
          Works from any phone in India, even with no balance or no SIM. It reaches
          police, fire and ambulance together.
        </div>
      </Card>

      <div className="chead" style={{ marginTop: 14 }}>All national helplines</div>
      <div className="list">
        {INDIA_HELPLINES.map(([name, num, note]) => (
          <a className="row" key={num + name} href={call(num)}
            style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ width: 42, height: 42, borderRadius: 9, background: 'var(--s3)',
              display: 'grid', placeItems: 'center', flex: '0 0 auto', color: 'var(--green)' }}>
              <Icon n="signal" size={18} /></div>
            <div className="main">
              <b style={{ fontSize: 13.5 }}>{name}</b>
              {note && <span className="dim sm">{note}</span>}
            </div>
            <b style={{ color: 'var(--green)', fontSize: 15, fontFamily: 'var(--font-mono)' }}>{num}</b>
          </a>))}
      </div>
      <div className="src"><span className="dot" />
        <span>Tap any number to dial. Sourced from the issuing ministry or authority
          in each case.</span></div>
    </>)}

    {tab === 'world' && (<>
      <div className="fld">
        <div className="ip-wrap">
          <Icon n="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Country name or code…" />
        </div>
      </div>
      {err && <Err error={err} />}
      {!list && !err && <Spin t="Loading countries" />}
      {sel ? (
        <>
          <button className="btn ghost sm" onClick={() => setSel(null)} style={{ marginBottom: 10 }}>
            <Icon n="back" size={15} /> All countries</button>
          <CountryEmergency c={sel} />
        </>
      ) : list && (<>
        <div className="dim sm" style={{ margin: '10px 0 8px' }}>
          {shown.length} countries with confirmed numbers
        </div>
        <div className="list">
          {shown.map((c) => {
            const e = emergencyFor(c.cca2);
            return (
              <div className="row" key={c.cca2} onClick={() => setSel(c)} style={{ cursor: 'pointer' }}>
                <img src={c.flag} alt="" loading="lazy"
                  style={{ width: 34, height: 24, objectFit: 'cover', borderRadius: 4, flex: '0 0 auto' }} />
                <div className="main">
                  <b style={{ fontSize: 13.5 }}>{c.name}</b>
                  <span className="dim sm">{c.dial}</span>
                </div>
                <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{e.unified}</b>
              </div>);
          })}
        </div>
      </>)}
    </>)}
  </>);
}

function CountryEmergency({ c }) {
  const e = emergencyFor(c.cca2);
  if (!e) return <Empty t="No confirmed numbers for this country" />;
  const rows = [['Police', e.police, 'shield'], ['Fire', e.fire, 'warn'],
                ['Ambulance', e.ambulance, 'heart'], ['All services', e.unified, 'signal']];
  return (<>
    <div className="hubhead">
      <img src={c.flag} alt="" style={{ width: 54, height: 38, objectFit: 'cover', borderRadius: 6 }} />
      <div><b>{c.name}</b><span className="dim sm">{c.dial} · {c.capital}</span></div>
    </div>
    <div className="g2">
      {rows.map(([label, num, ic]) => (
        <a className="stat" key={label} href={call(num)} style={{ textDecoration: 'none' }}>
          <div className="v" style={{ fontFamily: 'var(--font-mono)' }}>{num}</div>
          <div className="l"><Icon n={ic} size={12} /> {label}</div>
        </a>))}
    </div>
    {e.extra?.length > 0 && (<>
      <div className="chead" style={{ marginTop: 14 }}>Other helplines</div>
      <div className="list">
        {e.extra.map(([n, num]) => (
          <a className="row" key={num} href={call(num)} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="main"><b style={{ fontSize: 13 }}>{n}</b></div>
            <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{num}</b>
          </a>))}
      </div>
    </>)}
    <div className="note" style={{ marginTop: 12 }}>
      Roaming? {c.dial} is this country's dialling code. From abroad, dial the
      full international number.
    </div>
  </>);
}

/* -------------------------------------------------------- country browser */
export function Countries() {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    allCountries().then(setAll).catch((e) => setErr(e.message || 'Failed to load'));
  }, []);

  const shown = (all || []).filter((c) => {
    const s = q.toLowerCase().trim();
    return !s || c.name.toLowerCase().includes(s) || c.capital.toLowerCase().includes(s) ||
           c.cca2.toLowerCase() === s || c.cca3.toLowerCase() === s;
  });

  if (sel) return (<>
    <button className="btn ghost sm" onClick={() => setSel(null)} style={{ marginBottom: 10 }}>
      <Icon n="back" size={15} /> All countries</button>
    <div className="hubhead">
      <img src={sel.flag} alt="" style={{ width: 62, height: 44, objectFit: 'cover', borderRadius: 7 }} />
      <div style={{ minWidth: 0 }}>
        <b>{sel.name}</b>
        <span className="dim sm">{sel.official}</span>
      </div>
    </div>
    <div className="g2">
      <div className="stat"><div className="v" style={{ fontSize: 17 }}>{sel.capital || '—'}</div><div className="l">Capital</div></div>
      <div className="stat"><div className="v" style={{ fontSize: 17 }}>{sel.dial || '—'}</div><div className="l">Dial code</div></div>
      <div className="stat"><div className="v" style={{ fontSize: 17 }}>{fmt(sel.population)}</div><div className="l">Population</div></div>
      <div className="stat"><div className="v" style={{ fontSize: 17 }}>{fmt(sel.area)}</div><div className="l">km² area</div></div>
    </div>
    <Card>
      <div className="kv"><span>Region</span><b>{sel.region}{sel.subregion ? ` · ${sel.subregion}` : ''}</b></div>
      {sel.currency && <div className="kv"><span>Currency</span>
        <b>{sel.currency.name} ({sel.currency.code}{sel.currency.symbol ? ' ' + sel.currency.symbol : ''})</b></div>}
      {sel.languages.length > 0 && <div className="kv"><span>Languages</span><b>{sel.languages.join(', ')}</b></div>}
      {sel.timezones.length > 0 && <div className="kv"><span>Time zones</span><b>{sel.timezones.slice(0, 3).join(', ')}{sel.timezones.length > 3 ? ` +${sel.timezones.length - 3}` : ''}</b></div>}
      {sel.tld && <div className="kv"><span>Internet domain</span><b>{sel.tld}</b></div>}
      <div className="kv"><span>Codes</span><b>{sel.cca2} · {sel.cca3}</b></div>
      {sel.borders.length > 0 && <div className="kv"><span>Borders</span><b>{sel.borders.join(', ')}</b></div>}
    </Card>
    {emergencyFor(sel.cca2) && (
      <Card>
        <div className="chead"><Icon n="warn" size={16} /> Emergency</div>
        <div className="g2">
          <a className="stat" href={call(emergencyFor(sel.cca2).unified)} style={{ textDecoration: 'none' }}>
            <div className="v" style={{ fontFamily: 'var(--font-mono)' }}>{emergencyFor(sel.cca2).unified}</div>
            <div className="l">All services</div></a>
          <a className="stat" href={call(emergencyFor(sel.cca2).ambulance)} style={{ textDecoration: 'none' }}>
            <div className="v" style={{ fontFamily: 'var(--font-mono)' }}>{emergencyFor(sel.cca2).ambulance}</div>
            <div className="l">Ambulance</div></a>
        </div>
      </Card>)}
    {sel.maps && (
      <a className="btn ghost" href={sel.maps} target="_blank" rel="noreferrer"
        style={{ width: '100%', textAlign: 'center', display: 'block', textDecoration: 'none' }}>
        <Icon n="pin" size={15} /> Open in Maps</a>)}
  </>);

  return (<>
    <div className="fld">
      <div className="ip-wrap">
        <Icon n="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Country, capital or code…" />
      </div>
    </div>
    {err && <Err error={err} />}
    {!all && !err && <Spin t="Loading 250 countries" />}
    {all && (<>
      <div className="dim sm" style={{ margin: '10px 0 8px' }}>{shown.length} countries</div>
      <div className="list">
        {shown.slice(0, 80).map((c) => (
          <div className="row" key={c.cca2} onClick={() => setSel(c)} style={{ cursor: 'pointer' }}>
            <img src={c.flag} alt="" loading="lazy"
              style={{ width: 34, height: 24, objectFit: 'cover', borderRadius: 4, flex: '0 0 auto' }} />
            <div className="main">
              <b style={{ fontSize: 13.5 }}>{c.name}</b>
              <span className="dim sm">{c.capital} · {fmt(c.population)} people</span>
            </div>
            <span className="dim sm" style={{ fontFamily: 'var(--font-mono)' }}>{c.dial}</span>
          </div>))}
      </div>
    </>)}
  </>);
}

/* --------------------------------------------------------- dial code tool */
export function DialCodes() {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(null);
  const [byDial, setByDial] = useState(null);

  useEffect(() => { allCountries().then(setAll).catch(() => {}); }, []);
  useEffect(() => {
    const s = q.trim();
    if (/^\+?\d{1,4}$/.test(s)) countryByDial(s).then(setByDial).catch(() => setByDial([]));
    else setByDial(null);
  }, [q]);

  const list = byDial || (all || []).filter((c) => {
    const s = q.toLowerCase().trim();
    return !s || c.name.toLowerCase().includes(s) || c.dial.includes(s);
  });

  return (<>
    <div className="fld">
      <div className="ip-wrap">
        <Icon n="signal" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Country name, or a code like +91" />
      </div>
    </div>
    {!all && <Spin t="Loading" />}
    {all && (<>
      <div className="dim sm" style={{ margin: '10px 0 8px' }}>
        {byDial ? `${list.length} country/countries use ${q}` : `${list.length} countries`}
      </div>
      <div className="list">
        {list.slice(0, 90).map((c) => (
          <div className="row" key={c.cca2}>
            <img src={c.flag} alt="" loading="lazy"
              style={{ width: 34, height: 24, objectFit: 'cover', borderRadius: 4, flex: '0 0 auto' }} />
            <div className="main">
              <b style={{ fontSize: 13.5 }}>{c.name}</b>
              <span className="dim sm">{c.capital}</span>
            </div>
            <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 15 }}>{c.dial}</b>
          </div>))}
      </div>
      <div className="src"><span className="dot" />
        <span>Type a code to find the country, or a country to find its code.
          Some countries share a code — all matches are shown.</span></div>
    </>)}
  </>);
}

/* ----------------------------------------------------------- name lookup */
/**
 * What a name says about a person, statistically.
 *
 * agify / genderize / nationalize are the same dataset family, built from tens
 * of millions of real profiles. They return a sample size, which is shown —
 * a prediction from 100 records deserves less trust than one from 10,000, and
 * hiding that would be dishonest.
 */
export function NameLookup() {
  const [name, setName] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const look = useCallback(async (n) => {
    const s = String(n || '').trim();
    if (!s) return;
    setBusy(true); setErr(''); setData(null);
    try {
      /* These three share one free quota (100 lookups a day per IP) and answer
         429 {"error":"Request limit reached"} once it runs out. Reporting that
         honestly matters — showing "—" and "0 records" made a working tool look
         broken when it was simply out of quota for the day. */
      const grab = async (url) => {
        const r = await fetch(url);
        const j = await r.json().catch(() => ({}));
        if (r.status === 429 || j?.error) throw new Error('quota');
        return j;
      };
      const [age, gender, nat, countries] = await Promise.all([
        grab(`https://api.agify.io?name=${encodeURIComponent(s)}&country_id=IN`),
        grab(`https://api.genderize.io?name=${encodeURIComponent(s)}&country_id=IN`),
        grab(`https://api.nationalize.io?name=${encodeURIComponent(s)}`),
        allCountries().catch(() => []),
      ]);
      const byCode = new Map(countries.map((c) => [c.cca2, c]));
      setData({
        name: s,
        age: age.age, ageCount: age.count || 0,
        gender: gender.gender, genderProb: gender.probability, genderCount: gender.count || 0,
        countries: (nat.country || []).map((c) => ({
          code: c.country_id,
          pct: Math.round(c.probability * 100),
          info: byCode.get(c.country_id) || null,
        })),
      });
    } catch (e) {
      setErr(e.message === 'quota'
        ? 'The name database has hit its daily free limit. It resets at midnight UTC — everything else in the app is unaffected.'
        : 'Could not look that up — try again');
    } finally { setBusy(false); }
  }, []);

  return (<>
    <div className="fld">
      <div className="ip-wrap">
        <Icon n="smile" size={16} />
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { look(name); e.target.blur(); } }}
          placeholder="Any first name or surname…" enterKeyHint="search" />
      </div>
    </div>
    <div className="cats">
      {['Aarav', 'Priya', 'Rahul', 'Ananya', 'Arjun', 'Sharma', 'Khan', 'Kaur'].map((n) => (
        <button key={n} className="cat" onClick={() => { setName(n); look(n); }}>{n}</button>))}
    </div>

    {busy && <Spin t="Looking up" />}
    {err && <div className="note bad">{err}</div>}

    {data && (<>
      <Card>
        <div className="chead">{data.name}</div>
        <div className="g2">
          <div className="stat">
            <div className="v">{data.age ?? '—'}</div>
            <div className="l">Likely age</div>
          </div>
          <div className="stat">
            <div className="v" style={{ textTransform: 'capitalize' }}>{data.gender || '—'}</div>
            <div className="l">{data.genderProb ? `${Math.round(data.genderProb * 100)}% confident` : 'Gender'}</div>
          </div>
        </div>
        <div className="src"><span className="dot" />
          <span>Based on {fmt(Math.max(data.ageCount, data.genderCount))} real records.
            {Math.max(data.ageCount, data.genderCount) < 200
              ? ' That is a small sample — treat it loosely.'
              : ''}</span></div>
      </Card>

      {data.countries.length > 0 && (
        <Card>
          <div className="chead"><Icon n="globe" size={16} /> Where this name is from</div>
          <div className="list">
            {data.countries.map((c) => (
              <div className="row" key={c.code}>
                {c.info
                  ? <img src={c.info.flag} alt="" loading="lazy"
                      style={{ width: 32, height: 22, objectFit: 'cover', borderRadius: 4, flex: '0 0 auto' }} />
                  : <div style={{ width: 32, height: 22, background: 'var(--s3)', borderRadius: 4 }} />}
                <div className="main">
                  <b style={{ fontSize: 13 }}>{c.info?.name || c.code}</b>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                  <div style={{ width: 74, height: 6, borderRadius: 3, background: 'var(--s3)', overflow: 'hidden' }}>
                    <div style={{ width: `${c.pct}%`, height: '100%', background: 'var(--green)' }} />
                  </div>
                  <b style={{ color: 'var(--green)', fontSize: 12, minWidth: 32, textAlign: 'right' }}>{c.pct}%</b>
                </div>
              </div>))}
          </div>
        </Card>)}
    </>)}

    {!data && !busy && (
      <div className="src" style={{ marginTop: 14 }}><span className="dot" />
        <span>Statistical, not personal — it describes how a name is distributed
          across millions of records, and says nothing about any individual.</span></div>)}
  </>);
}
