/**
 * Live Buses — real positions of Delhi buses on a map.
 *
 * The browser never talks to the live service directly and never holds a key.
 * It asks the app's own relay (/api/live-bus) on the same origin, and that
 * relay — a tiny serverless function — is the only place the key exists.
 * Nothing here works without that relay: if it is missing the screen says so
 * plainly and points at the setup guide.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit';

const REFRESH_MS = 30000;
const STATUS_TEXT = { 0: 'arriving', 1: 'at stop', 2: 'moving' };

/* Marker colours rotate by route so nearby routes differ; one route keeps one
   colour for the whole session. */
const PALETTE = ['#FF3E4E', '#FDB913', '#00A9E0', '#00732F', '#B81C8B', '#00A886', '#6B3529',
  '#E6A03C', '#1F7AF0', '#8E44AD', '#E84393', '#2E86AB'];
const hueOf = (() => {
  const m = new Map(); let n = 0;
  return (k) => { if (!m.has(k)) m.set(k, PALETTE[n++ % PALETTE.length]); return m.get(k); };
})();

const ago = (ts) => {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.round(s)}s ago`;
  return `${Math.round(s / 60)}m ago`;
};

async function fetchFeed(signal) {
  const r = await fetch('/api/live-bus', { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  const d = await r.json();
  if (!d || !d.ok) throw new Error('bad payload');
  return d.buses || [];
}

export function LiveBus() {
  const [buses, setBuses] = useState(null);          // null = not loaded yet
  const [err, setErr] = useState('');
  const [at, setAt] = useState(null);
  const [q, setQ] = useState('');
  const [fit, setFit] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [relay, setRelay] = useState(null); // null=checking, 'none', 'setup'
  const [mapReady, setMapReady] = useState(false);
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const leafRef = useRef(null);
  const layerRef = useRef(null);

  /* ------------------------------ data polling --------------------------- */
  useEffect(() => {
    let alive = true; let timer = null;
    const tick = async () => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 12000);
      try {
        const list = await fetchFeed(ctl.signal);
        if (!alive) return;
        setBuses(list); setAt(Date.now()); setErr('');
      } catch (e) {
        if (!alive) return;
        const status = e && e.message;
        if (status === '404' || status === '503') {
          // relay does not exist here (or key not set yet): no point polling
          setRelay(status === '503' ? 'setup' : 'none');
          alive = false;
          clearInterval(timer);
          if (status === '404') setBuses((prev) => prev ?? []);
          return;
        }
        setErr(e.name === 'AbortError' ? 'timed out' : 'unreachable');
        setBuses((prev) => prev ?? []);
      } finally { clearTimeout(to); }
    };
    tick();
    timer = setInterval(tick, REFRESH_MS);
    const vis = () => { if (!document.hidden && alive) tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
  }, [attempt]);



  /* ------------------------- redraw markers on data ----------------------- */
  const list = buses || [];
  useEffect(() => {
    if (!mapReady) return;
    const L = leafRef.current, map = mapRef.current, group = layerRef.current;
    if (!L || !map || !group) return;
    group.clearLayers();
    if (!list.length) return;
    const mk = (v) => {
      const c = hueOf(String(v.route || '?').split(' ')[0]);
      const m = L.circleMarker([v.lat, v.lon], {
        radius: 6.5, weight: 1.6, color: '#0B0F17', fillColor: c, fillOpacity: 0.95,
      });
      m.bindTooltip(v.route || 'Bus', { direction: 'top', opacity: 0.92 });
      const rows = [`<b>${esc(v.route || '—')}</b>`];
      if (v.trip) rows.push('trip ' + esc(v.trip));
      if (v.status != null) rows.push(esc(STATUS_TEXT[v.status] || 'moving'));
      if (v.speed != null) rows.push(Math.round(v.speed) + ' km/h');
      if (v.stop) rows.push('near ' + esc(v.stop));
      rows.push(`<span style="opacity:.6">updated ${ago(v.ts)}</span>`);
      m.bindPopup(rows.join('<br/>'));
      return m;
    };
    list.forEach((v) => mk(v).addTo(group));
    if (fit > 0 || !map.__fitted) {
      map.__fitted = true;
      try {
        const pts = list.filter((v) => isFinite(v.lat) && isFinite(v.lon));
        if (pts.length) {
          map.fitBounds(L.latLngBounds(pts.map((v) => [v.lat, v.lon])).pad(0.06), { animate: false });
        }
      } catch { /* ignore */ }
    }
  }, [mapReady, buses, fit, list.length]);

  const routes = useMemo(() => {
    const seen = new Set();
    list.forEach((v) => { if (v.route) seen.add(v.route); });
    return [...seen].sort();
  }, [list.length]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter((v) => !s || String(v.route || '').toLowerCase().includes(s)
      || String(v.trip || '').toLowerCase().includes(s));
  }, [list, q]);

  const busy = buses === null;
  const dead = !busy && (!!err && list.length === 0 || relay === 'none' || relay === 'setup');
  const setupMode = relay === 'setup';
  const showMap = !busy;

  /* ------------------------------- the map ------------------------------- */
  useEffect(() => {
    if (!showMap || mapRef.current || !boxRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('leaflet');
        await import('leaflet/dist/leaflet.css');
        const L = mod.default || mod;
        if (cancelled || !boxRef.current) return;
        leafRef.current = L;
        const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true, minZoom: 4 });
        mapRef.current = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, attribution: 'Map data © OpenStreetMap' })
          .addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        map.setView([28.6139, 77.209], 11);
        setMapReady(true);
      } catch { /* map optional — the list still works */ }
    })();
    return () => {
      cancelled = true;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null; layerRef.current = null; leafRef.current = null;
    };
  }, [showMap]);

  return (
    <div style={{ paddingBottom: 30 }}>
      <Card pad={false}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="hubico"><Icon n="map" size={24} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>Live Buses · Delhi</b>
            <div className="dim sm">
              {busy ? 'Connecting…'
                : dead ? 'Live channel unreachable'
                : `${list.length} buses on the road${at ? ` · ${ago(at)}` : ''}`}
            </div>
          </div>
          {!busy && list.length > 0 && (
            <button className="btn" onClick={() => setFit((x) => x + 1)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon n="expand" size={14} /> Fit map
            </button>)}
          {dead && (
            <button className="btn" onClick={() => { setAttempt((a) => a + 1); }}>
              Try again</button>)}
        </div>

        {busy && <div className="state" style={{ padding: '34px 0' }}>
          <span className="dot live" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 8 }} />
          Connecting to the live channel…
        </div>}

        {dead && (
          <div className="state" style={{ padding: '18px 24px 26px' }}>
            <p>Live bus positions are currently unreachable.</p>
            <p className="dim sm" style={{ maxWidth: 520, margin: '8px auto 14px' }}>
              This screen reads through the app's own relay endpoint (<span className="mono">/api/live-bus</span>),
              so no key ever reaches your browser. If this page is not running through that relay yet,
              follow the deploy steps in <b>KEY-SAFETY-GUIDE.md</b> (it ships with the project).</p>
          </div>)}

        {!busy && (
          <div style={{ height: '52vh', minHeight: 300, position: 'relative', background: 'var(--s1)' }}>
            <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
          </div>)}

        {!busy && !dead && list.length === 0 && (
          <div className="state" style={{ padding: '34px 0' }}>
            <p>No bus positions reported right now.</p>
            <p className="dim sm">Live data updates every few seconds — refresh soon.</p>
          </div>)}

        {list.length > 0 && (<>

          <div style={{ padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by route… (e.g. 522, GL-23)"
              style={{ background: 'var(--s2)', border: '1px solid var(--line)', color: 'var(--fg)',
                borderRadius: 10, padding: '8px 12px', minWidth: 170, flex: 1, font: 'inherit' }} />
            <span className="dim sm">{shown.length} of {list.length}</span>
          </div>

          {routes.length > 0 && (
            <div style={{ padding: '0 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {routes.slice(0, 24).map((r) => (
                <button key={r} onClick={() => setQ(q === r ? '' : r)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: q === r ? 'var(--green)' : 'var(--s2)',
                    color: q === r ? '#000' : 'var(--fg)', border: 0, borderRadius: 999,
                    padding: '4px 10px', font: '600 12px/1.4 var(--font-body)', cursor: 'pointer' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: hueOf(r) }} />
                  {r}
                </button>))}
            </div>)}

          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {shown.slice(0, 400).map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center',
                padding: '9px 16px', borderTop: '1px solid var(--line)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, flex: 'none',
                  background: hueOf(String(v.route || '?').split(' ')[0]) }} />
                <b style={{ minWidth: 58 }}>{v.route || '—'}</b>
                <span className="dim sm" style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.status != null ? (STATUS_TEXT[v.status] || 'moving') : 'moving'}
                  {v.stop ? ` · near ${v.stop}` : v.trip ? ` · trip ${v.trip}` : ''}
                </span>
                <span className="dim sm">{v.speed != null ? Math.round(v.speed) + ' km/h' : ''}</span>
                <span className="dim sm">{ago(v.ts)}</span>
              </div>))}
            {shown.length > 400 && (
              <div className="dim sm" style={{ padding: '10px 16px' }}>Showing first 400 — refine the filter.</div>)}
          </div>
        </>)}
      </Card>
    </div>
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
