/**
 * Live Buses — route-centric Delhi bus tracker.
 *
 * The browser only ever talks to the app's own relay (/api/live-bus); the key
 * lives in that serverless function and never reaches the client.
 *
 * HOW IT WORKS (honest about the feed's nature)
 * · the feed broadcasts positions + route id + trip id + report timestamps.
 *   It carries NO speed, NO bearing and NO direction id — so nothing here
 *   invents those as "live" values. Speeds and headings are ESTIMATED on this
 *   device by comparing a bus's successive reported positions (shown with a
 *   "~" and labelled as estimates).
 * · Route numbers are matched loosely ('0740' == '740', 'OMS(+)' == 'OMS') so
 *   a static route family and the live broadcast find each other; when the
 *   chosen route is known offline, its corridor is drawn faintly on the map
 *   and its endpoints shown — even when no bus is broadcasting right now.
 * · Stale reports (older than ~3 minutes) are dimmed, never deleted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit';

const FULL_MS = 30000;        // whole-Delhi refresh
const ROUTE_MS = 12000;       // one-route refresh
const STALE_MS = 180000;      // report older than this = stale
const MOVING_KMH = 3;         // above this an estimated speed counts as moving

/* ---------------------------------------------------------------- helpers */
function normRoute(s) {
  let u = String(s || '').toUpperCase().trim();
  if (!u) return null;
  u = u.replace(/\([^)]*\)/g, ' ');
  let toks = u.split(/\s+/).filter(Boolean);
  toks = toks.filter((t, i) => i === 0 || (t !== 'EXT' && t !== 'STL'));
  let id = toks.join('').replace(/[^A-Z0-9]/g, '');
  if (!id) return null;
  id = id.replace(/^0+(?=[A-Z0-9])/, '');
  return id;
}
const ago = (ts) => {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 10) return 'now';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
};
const clock = (sec) => {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  return d.toTimeString().slice(0, 5);
};
const dirText = (deg) => {
  if (deg == null) return '—';
  const C = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return C[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
};
const haversineM = (a, b) => {
  const R = 6371000, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const bearing = (a, b) => {
  const y = Math.sin((b.lon - a.lon) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lon - a.lon) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const PALETTE = ['#FFB020', '#4CC9FF', '#FF5D73', '#2FE39B', '#B98BFF', '#FF8A5C', '#FFD166', '#00C2D1', '#F06292', '#A8E05F'];

async function fetchJson(url, signal) {
  const r = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/* ------------------------------------------------------------------ tool */
export function LiveBus() {
  const [buses, setBuses] = useState(null);        // full Delhi list
  const [at, setAt] = useState(null);
  const [err, setErr] = useState('');
  const [relay, setRelay] = useState(null);        // null | 'none' | 'setup'
  const [route, setRoute] = useState('');          // focused route (raw user form)
  const [routeBuses, setRouteBuses] = useState(null);
  const [routeErr, setRouteErr] = useState('');
  const [q, setQ] = useState('');
  const [fitTick, setFitTick] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [staticHits, setStaticHits] = useState([]);
  const fittedRef = useRef('');
  const [zoom, setZoom] = useState(11);
  const [selBus, setSelBus] = useState(null);      // drill-down plate
  const [corridor, setCorridor] = useState(null);  // static match { family, lines, routes }
  const [corridorErr, setCorridorErr] = useState('');
  const [busy, setBusy] = useState(true);

  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const leafRef = useRef(null);
  const markerLayer = useRef(null);
  const corridorLayer = useRef(null);
  const popupRef = useRef(null);
  const movRef = useRef(new Map());                // id -> last fix
  const routeQRef = useRef('');

  /* ------------------------------ whole-Delhi polling -------------------- */
  useEffect(() => {
    let alive = true; let timer = null;
    const tick = async () => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 14000);
      try {
        const d = await fetchJson('/api/live-bus', ctl.signal);
        if (!alive) return;
        setBuses(d.buses || []); setAt(Date.now()); setErr(''); setRelay(null); setBusy(false);
      } catch (e) {
        if (!alive) return;
        const st = e && e.message;
        if (st === '404' || st === '503') { setRelay(st === '503' ? 'setup' : 'none'); alive = false; clearInterval(timer); setBusy(false); return; }
        setErr('unreachable'); setBusy(false);
      } finally { clearTimeout(to); }
    };
    tick();
    timer = setInterval(tick, FULL_MS);
    const vis = () => { if (!document.hidden && alive && !routeQRef.current) tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);

  /* ------------------------------ route polling -------------------------- */
  useEffect(() => {
    routeQRef.current = route;
    if (!route) { setRouteBuses(null); setRouteErr(''); return; }
    let alive = true; let timer = null;
    const tick = async () => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 10000);
      try {
        const d = await fetchJson(`/api/live-bus?route=${encodeURIComponent(route)}`, ctl.signal);
        if (!alive) return;
        setRouteBuses(d.buses || []); setRouteErr('');
      } catch (e) {
        if (alive && e && e.message !== '404' && e.message !== '503') setRouteErr('unreachable');
      } finally { clearTimeout(to); }
    };
    tick();
    timer = setInterval(tick, ROUTE_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [route]);

  /* ------------------------- movement estimation ------------------------- */
  function foldMotion(list) {
    const mov = movRef.current;
    const now = Date.now();
    for (const b of list) {
      if (!b.lat || !b.lon || !b.ts) continue;
      const prev = mov.get(b.id);
      const rec = { lat: b.lat, lon: b.lon, ts: now, age: now - b.ts * 1000 };
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        const dist = haversineM(prev, rec);
        if (dt >= 8 && dt <= 90 && dist >= 12 && now - b.ts * 1000 < 60000) {
          const kmh = Math.min(120, (dist / dt) * 3.6);
          b.spd = prev.kmh ? (prev.kmh * 0.6 + kmh * 0.4) : kmh;
          b.hdg = bearing(prev, rec);
          b.dist = Math.round(dist);
        }
      }
      mov.set(b.id, { ...rec, kmh: b.spd });
    }
    if (mov.size > 30000) { // bounded memory: drop entries we no longer need
      const keep = new Set(list.map((x) => x.id));
      for (const k of mov.keys()) if (!keep.has(k)) mov.delete(k);
    }
    return list;
  }
  useEffect(() => { if (buses) foldMotion(buses); }, [buses]);
  useEffect(() => { if (routeBuses) foldMotion(routeBuses); }, [routeBuses]);

  /* ------------------------------ static corridor ------------------------ */
  useEffect(() => {
    let alive = true;
    setCorridor(null); setCorridorErr('');
    if (!route) return;
    const norm = normRoute(route);
    (async () => {
      try {
        const core = await import('../core/bus-route');
        const ROUTES = core.ROUTES || [];
        const STOPS = core.STOPS || [];
        const rec = (i) => (typeof i === 'number' ? STOPS[i] : null);
        const hits = ROUTES.filter((r) => normRoute(r.r) === norm);
        if (!hits.length || !alive) return;
        const lines = hits.map((r) => ({
          from: r.f, to: r.t, pts: (r.s || []).map((i) => { const s = rec(i); return s && s.lat != null ? [s.lat, s.lon] : null; }).filter(Boolean),
        })).filter((l) => l.pts.length > 1);
        if (alive) setCorridor({ norm, lines });
      } catch { if (alive) setCorridorErr('route map unavailable'); }
    })();
    return () => { alive = false; };
  }, [route]);

  /* --------------------------------- map init ----------------------------- */
  // Map mounts whenever the channel is past "connecting" — even on a host
  // without the relay, so the city + route corridors stay visible.
  const aliveMap = !busy;
  useEffect(() => {
    if (!aliveMap || mapRef.current || !boxRef.current) return;
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
        markerLayer.current = L.layerGroup().addTo(map);
        corridorLayer.current = L.layerGroup().addTo(map);
        map.setView([28.6139, 77.209], 11);
        map.on('zoomend', () => setZoom(map.getZoom()));
        map.on('click', () => { if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; } setSelBus(null); });
        setMapReady(true);          // redraw hook: markers draw as soon as leaflet is live
      } catch { /* map optional */ }
    })();
    return () => { cancelled = true; setMapReady(false); setSelBus(null); mapRef.current?.remove(); mapRef.current = null; markerLayer.current = null; corridorLayer.current = null; leafRef.current = null; };
  }, [aliveMap]);

  /* ------------------------------- map drawing --------------------------- */
  const all = buses || [];
  const focus = route ? (routeBuses || []) : [];
  const drawList = route ? focus : all;
  const effZoom = Math.max(zoom, route ? 12 : 9);

  useEffect(() => {
    if (!mapReady) return;
    const L = leafRef.current, map = mapRef.current, ml = markerLayer.current, cl = corridorLayer.current;
    if (!L || !map || !ml || !cl) return;
    ml.clearLayers(); cl.clearLayers();
    if (corridor && corridor.lines.length && route) {
      for (const line of corridor.lines.slice(0, 6)) {
        L.polyline(line.pts, { color: '#FFB020', weight: 2.5, opacity: 0.55, dashArray: '6 8' }).addTo(cl);
        L.circleMarker(line.pts[0], { radius: 5, color: '#FFB020', fillOpacity: 1 }).addTo(cl).bindTooltip(line.from || '');
        L.circleMarker(line.pts[line.pts.length - 1], { radius: 5, color: '#FF8A5C', fillOpacity: 1 }).addTo(cl).bindTooltip(line.to || '');
      }
    }
    const list = drawList;
    if (!list.length) return;

    const openBus = (bus) => {
      setSelBus(bus.id);
      const rows = [
        `<b style="font-size:14px">${esc(bus.id || 'Bus')}</b>`,
        `route <b>${esc(bus.route || '—')}</b>${bus.trip ? ' · trip ' + esc(bus.trip) : ''}`,
        bus.spd ? `~${Math.round(bus.spd)} km/h moving` : 'report only (no motion yet)',
        bus.hdg != null ? `heading ${esc(dirText(bus.hdg))} (${Math.round(bus.hdg)}°)` : '',
        bus.ts ? `reported ${clock(bus.ts)} · ${ago(bus.ts * 1000)} ago` : '',
        `<a href="geo:${bus.lat},${bus.lon}?q=${bus.lat},${bus.lon}" style="color:#4CC9FF">open in maps ↗</a>`,
      ].filter(Boolean).join('<br/>');
      const popup = L.popup({ maxWidth: 230, autoPan: false }).setLatLng([bus.lat, bus.lon]).setContent(rows);
      map.closePopup(); popupRef.current = popup; map.openPopup(popup);
    };

    const many = list.length > (route ? 0 : 700);
    if (many) {
      // grid clustering for the whole-city view
      const cell = effZoom >= 12 ? 0.004 : effZoom >= 10 ? 0.014 : 0.03;
      const grid = new Map();
      for (const b of list) {
        const k = `${Math.round(b.lat / cell)}|${Math.round(b.lon / cell)}`;
        const c = grid.get(k) || { lat: 0, lon: 0, n: 0 };
        c.lat += b.lat; c.lon += b.lon; c.n++;
        grid.set(k, c);
      }
      for (const c of grid.values()) {
        const la = c.lat / c.n, lo = c.lon / c.n;
        const m = L.circleMarker([la, lo], { radius: 4 + Math.min(11, Math.sqrt(c.n) * 2.2), weight: 1, color: '#0B0F17', fillColor: '#FFB020', fillOpacity: 0.9 });
        m.bindTooltip(`${c.n} buses`, { direction: 'top' });
        m.on('click', () => map.setView([la, lo], Math.min(effZoom + 2, 15)));
        m.addTo(ml);
      }
      if (fittedRef.current !== 'city' || fitTick > 0) { map.setView([28.6139, 77.209], effZoom); fittedRef.current = 'city'; }
      return;
    }

    const staleOf = (b) => b.ts && Date.now() - b.ts * 1000 > STALE_MS;
    for (const b of list) {
      const moving = b.spd != null && b.spd >= MOVING_KMH;
      const stale = staleOf(b);
      const color = route ? (stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020') : hueOf(b.route);
      const m = L.circleMarker([b.lat, b.lon], {
        radius: route ? 7 : 5, weight: 1.4, color: stale ? '#444C5E' : '#0B0F17', fillColor: color, fillOpacity: 0.95,
      });
      if (route) {
        m.bindTooltip(`${b.id} · ${b.spd != null ? '~' + Math.round(b.spd) + ' km/h' : 'reporting'}`, { direction: 'top', opacity: 0.95 });
        m.on('click', () => openBus(b));
      } else {
        m.bindTooltip(`${esc(b.route || 'bus')}${b.spd != null ? ' · ~' + Math.round(b.spd) + ' km/h' : ''}`, { direction: 'top', opacity: 0.9 });
        m.on('click', () => openBus(b));
      }
      m.addTo(ml);
    }
    const routeKey = route;
    if (routeKey && (fittedRef.current !== routeKey || fitTick > 0) && corridor?.lines?.length) {
      try {
        const pts = focus.filter((b) => b.lat).map((b) => [b.lat, b.lon]);
        if (pts.length) { map.fitBounds(L.latLngBounds(pts).pad(0.12)); fittedRef.current = routeKey; }
      } catch { /* ignore */ }
    } else if (!routeKey) map.setView([28.6139, 77.209], effZoom);
    else map.setView([28.6139, 77.209], 12);
    fittedRef.current = routeKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, drawList, corridor, effZoom, fitTick, mapReady]);

  const hueOf = useMemo(() => {
    const m = new Map(); let n = 0;
    return (k) => { if (!m.has(k)) m.set(k, PALETTE[n++ % PALETTE.length]); return m.get(k); };
  }, []);

  /* ------------------------------ derived views --------------------------- */
  const routeCounts = useMemo(() => {
    const m = new Map();
    for (const b of all) { const r = b.route || '?'; m.set(r, (m.get(r) || 0) + 1); }
    return [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [all]);

  const movingAll = useMemo(() => all.filter((b) => b.spd != null && b.spd >= MOVING_KMH).length, [all]);
  const freshAll = useMemo(() => all.filter((b) => b.ts && Date.now() - b.ts * 1000 <= STALE_MS).length, [all]);

  /* Static route directory lookup — typed route may be an offline-only family
     (OMS+, 0740 …). Matches are shown under the live results so the user can
     open the corridor even when no bus broadcasts right now. */
  useEffect(() => {
    let alive = true;
    setStaticHits([]);
    const s = q.trim();
    if (s.length < 2) return;
    const want = normRoute(s);
    if (!want) return;
    (async () => {
      try {
        const core = await import('../core/bus-route');
        const ROUTES = core.ROUTES || [];
        const rec = (i) => (typeof i === 'number' ? (core.STOPS || [])[i] : null);
        const fam = new Map();
        for (const r of ROUTES) {
          const n = normRoute(r.r);
          if (n === want) {
            const g = fam.get(n) || { norm: n, display: r.r, lines: new Map() };
            if (r.r.length < g.display.length) g.display = r.r;
            const pair = `${r.f || '?'}~${r.t || '?'}`;
            if (!g.lines.has(pair)) g.lines.set(pair, { from: r.f || '?', to: r.t || '?' });
            fam.set(n, g);
          }
        }
        if (!alive) return;
        setStaticHits([...fam.values()].slice(0, 3).map((g) => ({
          id: g.display, norm: g.norm,
          routes: [...g.lines.values()].slice(0, 2),
        })));
      } catch { /* offline or no match */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const suggestions = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    const sq = normRoute(s);
    const fromLive = routeCounts.filter((r) => {
      const n = normRoute(r.id); return !!n && (n.includes(sq) || r.id.includes(s));
    }).slice(0, 4);
    const out = fromLive.map((r) => ({ id: r.id, n: r.n, kind: 'live' }));
    // static families that exactly match what they typed — incl. offline-only
    for (const h of staticHits) out.push({ id: h.id, norm: h.norm, routes: h.routes, kind: 'static' });
    return out.slice(0, 7);
  }, [q, routeCounts, staticHits]);

  const focusStats = useMemo(() => {
    if (!focus.length) return null;
    const mov = focus.filter((b) => b.spd != null && b.spd >= MOVING_KMH);
    const spds = focus.map((b) => b.spd).filter((x) => x != null);
    return {
      n: focus.length, moving: mov.length,
      avg: spds.length ? spds.reduce((a, b) => a + b, 0) / spds.length : null,
      max: spds.length ? Math.max(...spds) : null,
    };
  }, [focus]);

  const sortedFocus = useMemo(() => {
    return [...focus].sort((a, b) => {
      const av = a.spd ?? -1, bv = b.spd ?? -1;
      return bv - av;
    });
  }, [focus]);

  /* ---------------------------------- render ------------------------------ */
  const setupMode = relay === 'setup';
  const pickRoute = (id) => { setRoute(id); setQ(''); setSelBus(null); };

  return (
    <div style={{ paddingBottom: 30 }}>
      <Card pad={false}>
        {/* header */}
        <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="hubico"><Icon n="map" size={24} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 15.5 }}>{route ? `Route ${route}` : 'Live Buses · Delhi'}</b>
            <div className="dim sm">
              {busy ? 'Connecting…'
                : relay ? (setupMode ? 'Key set nahi hai — setup steps README mein' : 'Live channel is host pe nahi hai — relay deploy karo')
                : route ? (routeErr ? 'Route data unreachable' : `${focus.length} buses on ${route}${focusStats ? ` · ${focusStats.moving} moving` : ''} · ${ago(at)}`)
                : `${all.length} buses · ${routeCounts.length} routes · ${movingAll} moving · ${ago(at)}`}
            </div>
          </div>
          {route && <button className="btn ghost sm" onClick={() => pickRoute('')}><Icon n="x" size={13} /> All Delhi</button>}
          {!busy && all.length > 0 && !route && (
            <button className="btn ghost sm" onClick={() => setFitTick((x) => x + 1)}><Icon n="expand" size={13} /> Fit</button>)}
        </div>

        {/* route quick chips (whole city) */}
        {!route && !relay && routeCounts.length > 0 && (
          <div style={{ padding: '0 12px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="dim sm" style={{ padding: '6px 2px 0' }}>Live routes:</span>
            {routeCounts.slice(0, 16).map((r) => (
              <button key={r.id} onClick={() => pickRoute(r.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--s2)',
                  border: '1px solid var(--line2)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer',
                  color: 'var(--fg)', font: '700 12px/1.4 var(--font-body)' }}>
                {r.id}<span className="dim sm">{r.n}</span>
              </button>))}
          </div>)}

        {/* search */}
        {!relay && (
          <div style={{ padding: '4px 16px 8px', position: 'relative' }}>
            <div className="search" style={{ margin: '6px 0 0' }}>
              <Icon n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Route search — 740, OMS+, 3476, bus plate…"
                style={{ padding: '11px 0', fontSize: 14 }} />
              {q && <button onClick={() => setQ('')} aria-label="Clear" style={{ background: 'none', border: 0, color: 'var(--fg3)' }}><Icon n="x" size={15} /></button>}
            </div>
            {suggestions.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 50, left: 16, right: 16, top: 'calc(100% - 2px)', background: 'var(--s2)',
                border: '1px solid var(--line2)', borderRadius: 14, boxShadow: '0 18px 40px -18px #000', overflow: 'hidden' }}>
                {suggestions.map((s, si) => (
                  <button key={s.id + si} onMouseDown={(e) => { e.preventDefault(); pickRoute(s.id); }}
                    style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'none',
                      border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)' }}>
                    <b style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{s.id}</b>
                    {s.kind === 'live'
                      ? <span className="tag g" style={{ fontWeight: 700 }}>{s.n} live now</span>
                      : <span className="tag" style={{ color: 'var(--cyan)', borderColor: 'rgba(76,201,255,.4)' }}>static · 0 live abhi</span>}
                    <span className="dim sm" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                      {s.kind === 'static' && s.routes && s.routes.length ? `${s.routes[0].from} → ${s.routes[0].to}` : ''}
                    </span>
                    <Icon n="right" size={14} style={{ color: 'var(--fg3)', flex: '0 0 auto' }} />
                  </button>))}
              </div>)}
          </div>)}

        {/* relay message */}
        {relay && (
          <div className="state" style={{ padding: '10px 24px 18px' }}>
            <p className="dim sm" style={{ maxWidth: 520, margin: '0 auto' }}>
              {setupMode
                ? 'Live channel ready par server key set nahi hai — Vercel project ke Environment Variables mein OTDLIVE_KEY daal kar redeploy karo (README).'
                : 'Ye page relay ke bina host ho raha hai (jaise GitHub Pages). Live buses ke liye Vercel deploy karo — README mein steps hain.'}
            </p>
          </div>)}

        {/* map (mounts as soon as we are past connecting; overlay states on top) */}
        <div style={{ height: route ? '46vh' : '52vh', minHeight: route ? 260 : 300, position: 'relative', background: 'var(--s1)' }}>
          <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
          {busy && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bg) 55%, transparent)', zIndex: 400 }}>
            <div className="state"><span className="spin" /><p>Live buses se jud rahe hain…</p></div>
          </div>}
          {!busy && relay && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bg) 45%, transparent)', zIndex: 300 }}>
            <div className="state" style={{ padding: '0 18px' }}>
              {setupMode ? (
                <><p className="dim sm">Server key set nahi — OTDLIVE_KEY + redeploy karo (README).</p></>
              ) : (
                <>
                  <p style={{ fontWeight: 650 }}>Ye host live data nahi de sakta</p>
                  <p className="dim sm" style={{ maxWidth: 300, margin: '4px auto 12px' }}>GitHub Pages sirf static hai — live buses ke liye Vercel wala version kholo (key wahi hai):</p>
                  <a className="btn" style={{ color: '#170800', textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}
                    href="https://delhi-dost.vercel.app/#livebus" target="_blank" rel="noopener">
                    <Icon n="link" size={15} /> Live version kholo ↗
                  </a>
                </>
              )}
            </div>
          </div>}
        </div>

        {/* drill-down bus */}
        {selBus && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', background: 'color-mix(in srgb, var(--s2) 55%, transparent)' }}>
            {(() => { const b = all.find((x) => x.id === selBus) || focus.find((x) => x.id === selBus); if (!b) return null;
              return (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: b.spd != null && b.spd >= MOVING_KMH ? '#2FE39B' : '#FFB020' }} />
                  <b style={{ fontFamily: 'var(--font-mono)' }}>{b.id}</b>
                  <span className="tag c">route {b.route}</span>
                  {b.trip && <span className="dim sm">trip {b.trip}</span>}
                  {b.spd != null && <span className="tag g">~{Math.round(b.spd)} km/h</span>}
                  {b.hdg != null && <span className="dim sm">heading {dirText(b.hdg)}</span>}
                  {b.dist != null && <span className="dim sm">{b.dist} m moved</span>}
                  <span className="dim sm">report {ago(b.ts * 1000)} ago</span>
                  <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setSelBus(null)}>Close</button>
                </div>);
            })()}
          </div>)}

        {/* route panel */}
        {route && (
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {corridor?.lines?.length > 0 && (
              <div style={{ padding: '10px 16px 2px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {corridor.lines.slice(0, 3).map((l, i) => (
                  <span key={i} className="dim sm"><Icon n="route" size={12} style={{ color: 'var(--green)' }} /> {l.from} → {l.to}</span>))}
              </div>)}
            {focusStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '10px 16px 6px' }}>
                <div className="stat"><div className="v">{focusStats.n}</div><div className="l">buses</div></div>
                <div className="stat"><div className="v" style={{ color: '#2FE39B' }}>{focusStats.moving}</div><div className="l">moving</div></div>
                <div className="stat"><div className="v" style={{ color: 'var(--cyan)' }}>{focusStats.avg ? '~' + Math.round(focusStats.avg) : '—'}</div><div className="l">avg km/h</div></div>
                <div className="stat"><div className="v">{focusStats.max ? '~' + Math.round(focusStats.max) : '—'}</div><div className="l">top km/h</div></div>
              </div>)}
            <div className="dim sm" style={{ padding: '4px 16px 8px', display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon n="info" size={13} />
              Speeds are estimates from successive position reports. Green = moving · amber = standing · grey = stale (&gt;3 min old).
            </div>

            {routeErr && <div className="dim sm" style={{ padding: '6px 16px' }}>Route refresh unreachable right now — showing last data.</div>}

            {sortedFocus.length === 0 ? (
              <div className="state" style={{ padding: '22px 16px' }}>
                <p style={{ fontWeight: 650 }}>{route} pe abhi koi live bus nahi</p>
                {corridor?.lines?.length ? (
                  <p className="dim sm" style={{ maxWidth: 520 }}>
                    Ye route map pe dikh raha hai (terminals ke saath). Is waqt us number ki koi bus report nahi ho rahi —
                    raat ke hours mein kuch routes band ho jaate hain; subah ya din mein dobara try karo.</p>
                ) : (
                  <p className="dim sm">Is number pe abhi koi report nahi hai. Dusre number try karo — neeche "Live routes" chips se.</p>)}
                {routeCounts.slice(0, 8).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                    <span className="dim sm" style={{ alignSelf: 'center' }}>Abhi live:</span>
                    {routeCounts.slice(0, 8).map((r) => (
                      <button key={r.id} className="btn ghost sm" onClick={() => pickRoute(r.id)}>{r.id} · {r.n}</button>))}
                  </div>)}
              </div>
            ) : (
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 16px', fontSize: 10.5, color: 'var(--fg3)', letterSpacing: .6, textTransform: 'uppercase' }}>
                  <span style={{ flex: 1 }}>Bus</span><span style={{ width: 74 }}>speed</span><span style={{ width: 64 }}>heading</span><span style={{ width: 56, textAlign: 'right' }}>report</span>
                </div>
                {sortedFocus.map((b) => {
                  const moving = b.spd != null && b.spd >= MOVING_KMH;
                  const stale = b.ts && Date.now() - b.ts * 1000 > STALE_MS;
                  return (
                    <button key={b.id} onClick={() => { setSelBus(b.id === selBus ? null : b.id); if (mapRef.current) mapRef.current.setView([b.lat, b.lon], 14); }}
                      style={{ display: 'flex', width: '100%', gap: 6, alignItems: 'center', padding: '9px 16px', background: 'none', border: 0,
                        borderTop: '1px solid var(--line)', cursor: 'pointer', color: 'var(--fg)', textAlign: 'left' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, flex: '0 0 auto', background: stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020',
                        boxShadow: moving ? '0 0 8px rgba(47,227,155,.7)' : 'none' }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, display: 'block' }}>{b.id}{stale && <span className="dim sm" style={{ marginLeft: 6 }}>stale</span>}</b>
                        <span className="dim sm" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.trip || ''}</span>
                      </span>
                      <span style={{ width: 74, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: moving ? '#2FE39B' : 'var(--fg2)' }}>
                        {b.spd != null ? '~' + Math.round(b.spd) : '—'}<span className="dim sm"> km/h</span></span>
                      <span style={{ width: 64, fontSize: 12.5, color: 'var(--fg2)' }}>{b.hdg != null ? dirText(b.hdg) : '—'}</span>
                      <span style={{ width: 56, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg3)' }}>
                        {clock(b.ts)}</span>
                    </button>);
                })}
              </div>)}
          </div>)}

        {/* whole-city strip */}
        {!route && !relay && all.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: '#2FE39B', display: 'inline-block' }} /> moving
            </span>
            <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: '#FFB020', display: 'inline-block' }} /> standing
            </span>
            <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: '#8A94A8', display: 'inline-block' }} /> stale
            </span>
            <span className="dim sm" style={{ marginLeft: 'auto' }}>{freshAll}/{all.length} fresh · ~{movingAll} moving</span>
          </div>)}
      </Card>
    </div>
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
