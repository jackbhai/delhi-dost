/**
 * Live Buses — route-centric Delhi bus tracker.
 *
 * LAYOUT (v3)
 *  · header + search + route chips = one control card
 *  · the map lives in its OWN collapsible card, fully separate from search
 *  · under the map, a text "route track" shows every live bus along the
 *    route's stops (Uttam Nagar → Janakpuri → Tilak Nagar …) with animated
 *    bus dots — so positions are readable with the map collapsed/off
 *
 * HOW IT WORKS (honest about the feed's nature)
 * · the feed broadcasts position + route id + trip id + report timestamp.
 *   It carries NO speed, bearing or direction — speeds/headings are estimated
 *   on this device from successive reports and shown with "~".
 * · Route ids are matched loosely ('0740' == '740', 'OMS(+)' == 'OMS'); when
 *   the route is known offline its corridor is drawn and each live bus is
 *   snapped onto it, giving stop-level text ("ab agla: Janakpuri West",
 *   "% of route done") — an estimate, never an official position.
 * · Stale reports (>3 min) are dimmed, never deleted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit';

const FULL_MS = 30000;
const ROUTE_MS = 12000;
const STALE_MS = 180000;
const MOVING_KMH = 3;
const SNAP_MAX_M = 4000;      // a bus farther than this from the corridor = unmatched

/* ---------------------------------------------------------------- helpers */
function normRoute(s) {
  let u = String(s || '').toUpperCase().trim();
  if (!u) return null;
  u = u.replace(/\([^)]*\)/g, ' ');
  let toks = u.split(/\s+/).filter(Boolean);
  toks = toks.filter((t, i) => i === 0 || (t !== 'EXT' && t !== 'STL'));
  let id = toks.join('').replace(/[^A-Z0-9]/g, '');
  if (!id) return null;
  id = id.replace(/^0+(?=[A-Z0-9])/, '');   // 0740->740 · 0OMS->OMS
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
  return new Date(sec * 1000).toTimeString().slice(0, 5);
};
const dirText = (deg) => {
  if (deg == null) return '—';
  const C = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return C[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
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
const shortName = (n) => String(n || '').replace(/\(T\)$/i, '').replace(/ Terminal$/i, '').trim();
/** Compact display label: strip terminal markers + alias pairs ("A / B" -> "A"). */
const label = (n) => {
  let s = shortName(n);
  const slash = s.indexOf('/');
  if (slash > 0 && /^[A-Z0-9]/.test(s)) s = s.slice(0, slash);
  return s.trim();
};

/* ------------------ corridor geometry cache + bus popup copy ---------------- */
const corrCache = new Map();   // norm-route -> {lines}|null  (geometry family, incl. no-geometry miss)
async function corridorForCached(route) {
  const key = normRoute(route) || String(route || '?');
  if (corrCache.has(key)) return corrCache.get(key);
  let c = null;
  try { c = await corridorFor(route); } catch { /* offline */ }
  if (corrCache.size > 400) corrCache.clear();
  corrCache.set(key, c && c.lines && c.lines.length ? c : null);
  return c && c.lines && c.lines.length ? c : null;
}
function bestSnap(b, lines) {
  let best = null;
  for (let li = 0; li < lines.length; li++) {
    const hit = busOnLine(lines[li], b.lat, b.lon);
    if (hit && (!best || hit.d < best.hit.d)) best = { li, hit };
  }
  return best;
}
/** Which end is this bus driving toward? Uses live heading vs corridor geometry; null when idle/unknown. */
function destEnd(b, ln) {
  if (b.hdg == null || b.spd == null || b.spd < MOVING_KMH) return null;
  const A = ln.stops[0], Z = ln.stops[ln.stops.length - 1];
  if (!A || !Z || A.lat == null || Z.lat == null) return null;
  const d = (x) => { let y = (x - b.hdg + 540) % 360 - 180; return y < -180 ? y + 360 : y; };
  const dA = Math.abs(d(bearing(b, A))), dZ = Math.abs(d(bearing(b, Z)));
  if (dZ <= 60 && dZ < dA) return { name: ln.to, rev: false };
  if (dA <= 60) return { name: ln.from, rev: true };
  return null;
}
/** HTML rows for a bus popup: kahan hai abhi + kaha ja rahi hai + status. */
function busPopupRows(b, lines, hit, li, kmAway) {
  const R = [];
  const moving = b.spd != null && b.spd >= MOVING_KMH;
  const stale = b.ts && Date.now() - b.ts * 1000 > STALE_MS;
  R.push(`<div style="display:flex;align-items:center;gap:6px"><b style="font-family:var(--font-mono);font-size:14px;color:var(--fg)">${esc(b.id || 'Bus')}</b>` +
    `<span style="margin-left:auto;background:rgba(255,176,32,.14);border:1px solid rgba(255,176,32,.45);color:#FFB020;border-radius:99px;padding:1px 8px;font:700 11px/1.6 var(--font-mono)">${esc(b.route || '—')}</span></div>`);
  R.push(`<div style="color:${stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020'};font-weight:700;font-size:12.5px">` +
    `${stale ? '● stale report' : moving ? '● moving' : '● standing / idhar hai'}${b.spd != null ? ' · ~' + Math.round(b.spd) + ' km/h' : ''}</div>`);
  const fam = lines && lines.length ? lines : null;
  if (fam) {
    const ln = fam[Math.min(li || 0, fam.length - 1)];
    if (hit && hit.d <= SNAP_MAX_M) {
      const pct = Math.round(hit.p * 100);
      const end = destEnd(b, ln);
      const leftStops = end ? (end.rev ? hit.seg + 1 : hit.left) : null;
      R.push(`<div style="font-size:12.5px;line-height:1.55"><span style="color:#8A94A8">abhi:</span> <b>${esc(label(hit.prev.n))}</b> se aage · agla <b>${esc(label(hit.next.n))}</b>${leftStops != null ? ' · ' + leftStops + ' stop baaki' : ''} (route ka ${pct}%)</div>`);
      if (end) {
        R.push(`<div style="font-size:12.5px"><span style="color:#8A94A8">ja rahi:</span> <b style="color:#2FE39B">→ ${esc(label(end.name))}</b> ki taraf${end.rev ? ' (heading ke hisaab se — ulti disha)' : ''}</div>`);
      } else {
        const both = `${esc(label(ln.from))} ↔ ${esc(label(ln.to))}`;
        R.push(moving
          ? `<div style="font-size:12.5px"><span style="color:#8A94A8">ja rahi:</span> heading abhi report nahi hui · corridor ${both}</div>`
          : `<div style="font-size:12.5px"><span style="color:#8A94A8">ja rahi:</span> abhi khadi hai — chalte hi pata chalega · corridor ${both}</div>`);
      }
    } else {
      if (kmAway != null) R.push(`<div style="font-size:12.5px;color:#8A94A8">abhi corridor se ~<b>${kmAway.toFixed(1)} km</b> door — depot / yard mein ho sakti hai</div>`);
      const pairs = [...new Set(fam.map((l) => `${esc(label(l.from))} ↔ ${esc(label(l.to))}`))].slice(0, 2);
      if (pairs.length) R.push(`<div style="font-size:12.5px"><span style="color:#8A94A8">ye route:</span> ${pairs.join('<br/>')}</div>`);
    }
  } else {
    R.push(`<div style="font-size:12.5px;color:#8A94A8">abhi: GPS report — ${b.lat.toFixed(4)}, ${b.lon.toFixed(4)}</div>`);
    R.push(`<div style="font-size:12.5px"><span style="color:#8A94A8">ja rahi:</span> ${b.hdg != null ? `<b>${esc(dirText(b.hdg))}</b> (${Math.round(b.hdg)}°) — route table me nahi, sirf GPS` : 'data nahi (route table me nahi)'}</div>`);
  }
  if (b.ts) R.push(`<div style="font-size:11.5px;color:var(--fg3)">report ${clock(b.ts)} · ${ago(b.ts * 1000)} pehle${b.trip ? ' · duty ' + esc(String(b.trip).split('_').slice(-1)[0] || '') : ''}</div>`);
  R.push(`<a href="geo:${b.lat},${b.lon}?q=${b.lat},${b.lon}" style="color:#4CC9FF;font-size:12.5px">open in maps ↗</a>`);
  return R.join('<div style="height:6px"></div>');
}
const PALETTE = ['#FFB020', '#4CC9FF', '#FF5D73', '#2FE39B', '#B98BFF', '#FF8A5C', '#FFD166', '#00C2D1', '#F06292', '#A8E05F'];
async function fetchJson(url, signal) {
  const r = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/* --------------------------- corridor geometry --------------------------- */
/** Load the static corridor family for a route (unique directions only). */
async function corridorFor(route) {
  const core = await import('../core/bus-route');
  const ROUTES = core.ROUTES || [], STOPS = core.STOPS || [];
  const seen = new Set(); const lines = []; let est = false;
  for (const r of ROUTES) {
    if (normRoute(r.r) !== normRoute(route)) continue;
    if (String(r.o || '').startsWith('MATCH')) est = true;
    const pair = `${r.f || '?'}~${r.t || '?'}`;
    if (seen.has(pair)) continue; seen.add(pair);
    const raw = (r.s || []).map((i) => (typeof i === 'number' && STOPS[i]) ? STOPS[i] : null).filter(Boolean);
    if (raw.length < 2) continue;
    const stops = []; const cum = [0]; let km = 0;
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) km += haversineM(raw[i - 1], raw[i]);
      stops.push({ n: raw[i].n, lat: raw[i].lat, lon: raw[i].lon });
      cum.push(Math.round(km));
    }
    lines.push({ from: r.f, to: r.t, stops, cum, total: Math.max(km, 1) });
  }
  return { norm: normRoute(route), lines, est };
}

/** Snap a point to a corridor line -> { d(m), i(seg), t(0..1), mAlong }. */
function snapLine(line, lat, lon) {
  const cm = Math.cos(lat * Math.PI / 180), K = 111320;
  const X = (p) => ({ x: p.lon * cm, y: p.lat });
  const p = X({ lat, lon });
  let best = { d: Infinity, i: -1, t: 0 };
  for (let i = 0; i < line.stops.length - 1; i++) {
    const a = X(line.stops[i]), b = X(line.stops[i + 1]);
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const qx = a.x + abx * t, qy = a.y + aby * t;
    const d = Math.hypot(p.x - qx, p.y - qy) * K;
    if (d < best.d) best = { d, i, t };
  }
  return best;
}
function busOnLine(line, lat, lon) {
  const s = snapLine(line, lat, lon);
  if (!line.stops[s.i] || !line.stops[s.i + 1]) return null;
  const mAlong = line.cum[s.i] + s.t * (line.cum[s.i + 1] - line.cum[s.i]);
  return {
    d: s.d, seg: s.i, t: s.t,
    p: Math.max(0, Math.min(1, mAlong / line.total)),
    prev: line.stops[s.i], next: line.stops[s.i + 1],
    left: line.stops.length - 1 - s.i,
  };
}

/** Rail sample stops, spaced ~equally along the corridor (≤13 labels). */
function sampleStops(line, max = 13) {
  const n = Math.min(max, line.stops.length);
  if (n === line.stops.length) return line.stops.map((s, i) => ({ ...s, p: i / (line.stops.length - 1) }));
  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (line.total * k) / (n - 1);
    let i = 0;
    while (i < line.stops.length - 2 && line.cum[i + 1] < target) i++;
    const seg = line.cum[i + 1] - line.cum[i] || 1;
    const t = Math.max(0, Math.min(1, (target - line.cum[i]) / seg));
    const mix = (a, b) => a + (b - a) * t;
    out.push({
      n: line.stops[i].n, lat: mix(line.stops[i].lat, line.stops[i + 1].lat),
      lon: mix(line.stops[i].lon, line.stops[i + 1].lon),
      p: k / (n - 1),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ tool */
export function LiveBus() {
  const [buses, setBuses] = useState(null);
  const [at, setAt] = useState(null);
  const [err, setErr] = useState('');
  const [relay, setRelay] = useState(null);
  const [route, setRoute] = useState('');
  const [routeBuses, setRouteBuses] = useState(null);
  const [routeErr, setRouteErr] = useState('');
  const [q, setQ] = useState('');
  const [fitTick, setFitTick] = useState(0);
  const [zoom, setZoom] = useState(11);
  const [selBus, setSelBus] = useState(null);
  const [busy, setBusy] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapShow, setMapShow] = useState(true);
  const [corr, setCorr] = useState(null);       // corridor family
  const [corrErr, setCorrErr] = useState('');
  const [dirIdx, setDirIdx] = useState(0);      // selected corridor direction
  const [staticHits, setStaticHits] = useState([]);

  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const leafRef = useRef(null);
  const markerLayer = useRef(null);
  const corridorLayer = useRef(null);
  const popupRef = useRef(null);
  const busMarkers = useRef(new Map());
  const busFocusRef = useRef(null);
  const movRef = useRef(new Map());
  const routeQRef = useRef('');
  const busesRef = useRef(null);
  const mapShowRef = useRef(true);

  /* ------------------------------ whole-Delhi polling -------------------- */
  useEffect(() => {
    let alive = true; let timer = null; let stopped = false;
    const tick = async (isRetry) => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 18000);
      try {
        const d = await fetchJson('/api/live-bus', ctl.signal);
        if (!alive || stopped) return;
        setBuses(d.buses || []); setAt(Date.now());
        setErr(d.stale ? 'stale' : ''); setRelay(null); setBusy(false);
      } catch (e) {
        if (!alive || stopped) return;
        const st = e && e.message;
        if (st === '404' || st === '503') { setRelay(st === '503' ? 'setup' : 'none'); stopped = true; clearInterval(timer); setBusy(false); return; }
        const haveData = busesRef.current && busesRef.current.length;
        if (!haveData && !isRetry) {
          setTimeout(() => { if (alive && !stopped) tick(true); }, 2500);
          setTimeout(() => { if (alive && !stopped) tick(true); }, 6500);
        }
        if (haveData) setErr('refresh-failed');
        setBusy(false);
      } finally { clearTimeout(to); }
    };
    tick(false);
    timer = setInterval(() => { if (!routeQRef.current) tick(false); }, FULL_MS);
    const vis = () => { if (!document.hidden && alive && !routeQRef.current) tick(false); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);

  /* ------------------------------ route polling -------------------------- */
  useEffect(() => {
    routeQRef.current = route;
    if (!route) { setRouteBuses(null); setRouteErr(''); setCorr(null); return; }
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
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        const dist = haversineM(prev, b);
        if (dt >= 8 && dt <= 90 && dist >= 12 && now - b.ts * 1000 < 60000) {
          const kmh = Math.min(120, (dist / dt) * 3.6);
          b.spd = prev.kmh ? prev.kmh * 0.6 + kmh * 0.4 : kmh;
          b.hdg = bearing(prev, b);
          b.dist = Math.round(dist);
        }
      }
      mov.set(b.id, { lat: b.lat, lon: b.lon, ts: now, kmh: b.spd });
    }
    return list;
  }
  useEffect(() => { if (buses) foldMotion(buses); }, [buses]);
  useEffect(() => { if (routeBuses) foldMotion(routeBuses); }, [routeBuses]);

  /* ------------------------------ corridor load -------------------------- */
  useEffect(() => {
    let alive = true;
    setCorr(null); setCorrErr(''); setDirIdx(0);
    if (!route) return;
    (async () => {
      try {
        const c = await corridorFor(route);
        if (alive && c && c.lines.length) setCorr(c);
        else if (alive) setCorrErr('static');
      } catch { if (alive) setCorrErr('static'); }
    })();
    return () => { alive = false; };
  }, [route]);

  /* ------------------------------ static search -------------------------- */
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
        const fam = new Map();
        for (const r of ROUTES) {
          const n = normRoute(r.r);
          if (!n) continue;
          // substring fallback only for close ids (leading-digit service variants, e.g. 1740 vs 740),
          // never for far-off substrings (98765 must not match 765):
          if (n === want || (s.length >= 3 && ((n.includes(want) && n.length - want.length <= 2) || (want.includes(n) && want.length - n.length <= 1)))) {
            const g = fam.get(n) || { norm: n, display: r.r, dirs: new Map() };
            if (r.r.length < g.display.length) g.display = r.r;
            const pair = `${r.f || '?'}~${r.t || '?'}`;
            if (!g.dirs.has(pair)) g.dirs.set(pair, { from: r.f || '?', to: r.t || '?' });
            fam.set(n, g);
          }
        }
        if (!alive) return;
        setStaticHits([...fam.values()].slice(0, 4).map((g) => ({
          id: g.display, norm: g.norm, dirs: [...g.dirs.values()].slice(0, 2),
        })));
      } catch { /* offline */ }
    })();
    return () => { alive = false; };
  }, [q]);

  /* --------------------------------- map init ----------------------------- */
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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, attribution: 'Map data © OpenStreetMap' }).addTo(map);
        markerLayer.current = L.layerGroup().addTo(map);
        corridorLayer.current = L.layerGroup().addTo(map);
        map.setView([28.6139, 77.209], 11);
        map.on('zoomend', () => setZoom(map.getZoom()));
        map.on('click', () => { if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; } setSelBus(null); });
        setMapReady(true);
      } catch { /* map optional */ }
    })();
    return () => { cancelled = true; setMapReady(false); setSelBus(null); mapRef.current?.remove(); mapRef.current = null; markerLayer.current = null; corridorLayer.current = null; leafRef.current = null; };
  }, [aliveMap]);

  /* resize the leaflet viewport whenever the collapsible card changes size */
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    mapShowRef.current = mapShow;
    const t = setTimeout(() => { try { mapRef.current?.invalidateSize(); } catch { /* */ } }, 320);
    return () => clearTimeout(t);
  }, [mapShow, route, mapReady]);

  /* ------------------------------- map drawing --------------------------- */
  const all = buses || [];
  const focus = route ? (routeBuses || []) : [];
  const drawList = route ? focus : all;
  const effZoom = Math.max(zoom, route ? 12 : 9);

  useEffect(() => {
    if (!mapReady || !mapShow) return;
    const L = leafRef.current, map = mapRef.current, ml = markerLayer.current, cl = corridorLayer.current;
    if (!L || !map || !ml || !cl) return;
    ml.clearLayers(); cl.clearLayers(); busMarkers.current.clear();
    const famLines = corr && route && corr.lines && corr.lines.length ? corr.lines : null;
    if (famLines) {
      for (const line of famLines) {
        const pts = line.stops.map((s0) => [s0.lat, s0.lon]);
        if (pts.length > 1) {
          L.polyline(pts, { color: '#FFB020', weight: 2.5, opacity: 0.55, dashArray: '6 8' }).addTo(cl);
          L.circleMarker(pts[0], { radius: 5, color: '#FFB020', fillOpacity: 1, bubblingMouseEvents: false }).addTo(cl).bindTooltip(label(line.from));
          L.circleMarker(pts[pts.length - 1], { radius: 5, color: '#FF8A5C', fillOpacity: 1, bubblingMouseEvents: false }).addTo(cl).bindTooltip(label(line.to));
        }
      }
    }
    if (!drawList.length) return;
    const list = drawList;
    /** popup for one bus: static corridor (route view) hota hai to turant, warna geo-cache se enrich */
    const openBus = async (b) => {
      setSelBus(b.id);
      let lines = famLines, hit = null, li = 0, kmAway = null;
      if (lines) {
        const bst = bestSnap(b, lines);
        if (bst) { li = bst.li; if (bst.hit.d <= SNAP_MAX_M) hit = bst.hit; else kmAway = bst.hit.d / 1000; }
      }
      const show = (l2, h2, lix, km) => {
        const popup = L.popup({ maxWidth: 245 }).setLatLng([b.lat, b.lon]).setContent(busPopupRows(b, l2, h2, lix, km));
        map.closePopup(); popupRef.current = popup; map.openPopup(popup);
      };
      if (lines) { show(lines, hit, li, kmAway); }
      else {
        const bb = b;
        show(null, null, 0, null);           // base: GPS rows — turant
        const cc = await corridorForCached(bb.route);
        const mk = busMarkers.current.get(bb.id);
        if (!mk || mk.b !== bb) return;      // marker expire ho gaya (poll refresh)
        const c2 = cc && cc.lines && cc.lines.length ? cc.lines : null;
        let h2 = null, lix = 0, km2 = null;
        if (c2) {
          const bst = bestSnap(bb, c2);
          if (bst) { lix = bst.li; if (bst.hit.d <= SNAP_MAX_M) h2 = bst.hit; else km2 = bst.hit.d / 1000; }
        }
        show(c2, h2, lix, km2);
      }
    };
    const deep = effZoom >= 13;
    const many = list.length > 700;
    if (many && !deep) {
      const cell = effZoom >= 12 ? 0.004 : effZoom >= 10 ? 0.014 : 0.03;
      const grid = new Map();
      for (const b of list) {
        const k = `${Math.round(b.lat / cell)}|${Math.round(b.lon / cell)}`;
        const c = grid.get(k) || { lat: 0, lon: 0, n: 0 };
        c.lat += b.lat; c.lon += b.lon; c.n++; grid.set(k, c);
      }
      for (const c of grid.values()) {
        const la = c.lat / c.n, lo = c.lon / c.n;
        const m = L.circleMarker([la, lo], { radius: 4 + Math.min(11, Math.sqrt(c.n) * 2.2), weight: 1, color: '#0B0F17', fillColor: '#FFB020', fillOpacity: 0.9, bubblingMouseEvents: false });
        m.bindTooltip(`${c.n} buses`, { direction: 'top' });
        m.on('click', () => map.setView([la, lo], Math.min(effZoom + 2, 16)));
        m.addTo(ml);
      }
      if (fitTick > 0) map.setView([28.6139, 77.209], effZoom);
      return;
    }
    for (const b of list) {
      const moving = b.spd != null && b.spd >= MOVING_KMH;
      const stale = b.ts && Date.now() - b.ts * 1000 > STALE_MS;
      const color = route ? (stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020') : hueOf(String(b.route || '?'));
      const m = L.circleMarker([b.lat, b.lon], {
        radius: route ? 7 : deep ? 4.5 : 5, weight: 1.4, color: stale ? '#444C5E' : '#0B0F17', fillColor: color, fillOpacity: 0.95,
        bubblingMouseEvents: false,
      });
      const tip = route ? `${b.id} · ${b.spd != null ? '~' + Math.round(b.spd) + ' km/h' : 'reporting'}` : `${esc(b.route || 'bus')}${b.spd != null ? ' · ~' + Math.round(b.spd) + ' km/h' : ''}`;
      m.bindTooltip(tip, { direction: 'top', opacity: 0.95 });
      m.on('click', () => { openBus(b); });
      m.addTo(ml);
      busMarkers.current.set(b.id, { m, b });
    }
    if (route && corr && fitTick > 0) {
      try {
        const pts = list.filter((x) => x.lat).map((x) => [x.lat, x.lon]);
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.12));
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, drawList, corr, effZoom, fitTick, mapReady, mapShow]);

  /* ------------------ text-row / marker click -> open the bus on the map ------ */
  useEffect(() => {
    if (!selBus || !mapReady || !mapShow) return;
    const ent = busMarkers.current.get(selBus);
    const L = leafRef.current, map = mapRef.current;
    if (!ent || !L || !map) return;
    const timer = setTimeout(() => {
      try { map.invalidateSize(); } catch { /* ignore */ }
      const e2 = busMarkers.current.get(selBus);
      if (!e2 || !map) return;
      const cur = e2.m.getLatLng();
      const prev = busFocusRef.current;
      if (!prev || Math.abs(prev.lat - cur.lat) > 0.0025 || Math.abs(prev.lng - cur.lng) > 0.0025) {
        map.setView(cur, Math.max(map.getZoom(), route ? 13 : 14), { animate: true });
        busFocusRef.current = { lat: cur.lat, lng: cur.lng };
      }
      e2.m.fire('click');
    }, 420);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBus, mapReady, mapShow, route, routeBuses, buses]);

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

  const suggestions = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    const sq = normRoute(s) || '';
    const live = routeCounts.filter((r) => {
      const n = normRoute(r.id); return !!n && (n.includes(sq) || r.id.includes(s));
    }).sort((a, b) => {
      const na = normRoute(a.id) || '', nb = normRoute(b.id) || '';
      const ea = na.startsWith(sq) ? 0 : 1, eb = nb.startsWith(sq) ? 0 : 1;
      return ea - eb || b.n - a.n;
    }).slice(0, 4);
    const out = live.map((r) => ({ id: r.id, n: r.n, kind: 'live' }));
    for (const h of staticHits) out.push({ id: h.id, norm: h.norm, dirs: h.dirs, kind: 'static' });
    return out.slice(0, 8);
  }, [q, routeCounts, staticHits]);

  /* ------------------- per-bus snapping onto the corridor ----------------- */
  const dirLines = corr ? corr.lines : [];
  const snapped = useMemo(() => {
    if (!route || !dirLines.length || !focus.length) return [];
    const out = [];
    for (const b of focus) {
      let best = null;
      for (let li = 0; li < dirLines.length; li++) {
        const hit = busOnLine(dirLines[li], b.lat, b.lon);
        if (hit && (!best || hit.d < best.hit.d)) best = { li, hit };
      }
      if (best && best.hit.d <= SNAP_MAX_M) out.push({ b, li: best.li, ...best.hit });
    }
    return out;
  }, [route, dirLines, focus]);

  /* auto-select the direction that most live buses actually match */
  const countsByDir = useMemo(() => {
    const c = new Array(dirLines.length).fill(0);
    for (const s of snapped) c[s.li]++;
    return c;
  }, [snapped, dirLines.length]);
  useEffect(() => {
    if (!dirLines.length) return;
    let top = 0;
    for (let i = 1; i < countsByDir.length; i++) if (countsByDir[i] > countsByDir[top]) top = i;
    if (countsByDir[top] > 0) setDirIdx(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, countsByDir.join(',')]);

  const line = dirLines[Math.min(dirIdx, Math.max(0, dirLines.length - 1))] || null;
  const rail = useMemo(() => (line ? sampleStops(line, 13) : []), [line]);
  const busDots = useMemo(() => {
    if (!line || !snapped.length) return [];
    return snapped.filter((s) => s.li === Math.min(dirIdx, dirLines.length - 1))
      .sort((a, b) => a.p - b.p)
      .map((s) => ({ ...s, stale: s.b.ts && Date.now() - s.b.ts * 1000 > STALE_MS, moving: s.b.spd != null && s.b.spd >= MOVING_KMH }));
  }, [snapped, line, dirIdx, dirLines.length]);
  const unmatched = useMemo(() => {
    const ids = new Set(snapped.map((s) => s.b.id));
    return focus.filter((b) => !ids.has(b.id));
  }, [focus, snapped]);
  const ROW = 44;

  const focusStats = useMemo(() => {
    if (!focus.length) return null;
    const mov = focus.filter((b) => b.spd != null && b.spd >= MOVING_KMH);
    const spds = focus.map((b) => b.spd).filter((x) => x != null);
    return { n: focus.length, moving: mov.length, avg: spds.length ? spds.reduce((a, b) => a + b, 0) / spds.length : null, max: spds.length ? Math.max(...spds) : null };
  }, [focus]);

  const pickRoute = (id) => { setRoute(id); setQ(''); setSelBus(null); };
  const setupMode = relay === 'setup';
  const showNoHit = q.trim().length >= 2 && suggestions.length === 0 && !busy && !relay && routeCounts.length > 0;

  /* ------------------------------- render -------------------------------- */
  return (
    <div style={{ paddingBottom: 30 }}>
      {/* ============ control card: header + search + chips ============ */}
      <Card pad={false}>
        <div style={{ padding: '13px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="hubico"><Icon n="map" size={24} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 15.5 }}>{route ? `Route ${route}` : 'Live Buses · Delhi'}</b>
            <div className="dim sm">
              {busy ? 'Connecting…'
                : relay ? (setupMode ? 'Key set nahi hai — setup steps README mein' : 'Live channel is host pe nahi hai')
                : route ? (routeErr ? 'Route data unreachable' : `${focus.length} buses on ${route}${focusStats ? ` · ${focusStats.moving} moving` : ''} · ${ago(at)}`)
                : err === 'refresh-failed' ? `${all.length} buses · refresh ruka, phir koshish`
                : err === 'stale' ? `${all.length} buses · cached data`
                : `${all.length} buses · ${routeCounts.length} routes · ${movingAll} moving · ${ago(at)}`}
            </div>
          </div>
          {route && <button className="btn ghost sm" onClick={() => pickRoute('')}><Icon n="x" size={13} /> All Delhi</button>}
        </div>

        {/* map toggle (map is its own card below) */}
        <div style={{ padding: '4px 16px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={`btn ghost sm ${mapShow ? '' : 'on'}`} onClick={() => setMapShow(!mapShow)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Icon n={mapShow ? 'down' : 'map'} size={13} /> {mapShow ? 'Map chhupao' : 'Map dikhao'}
          </button>
          {!route && !relay && all.length > 0 && (
            <button className="btn ghost sm" onClick={() => setFitTick((x) => x + 1)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon n="expand" size={13} /> Fit
            </button>)}
          {route && corr && dirLines.length > 1 && (
            <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {dirLines.map((dl, i) => (
                <button key={i} onClick={() => setDirIdx(i)}
                  style={{ display: 'inline-flex', gap: 5, alignItems: 'center', borderRadius: 999, padding: '4px 10px',
                    border: '1px solid ' + (i === Math.min(dirIdx, dirLines.length - 1) ? 'rgba(255,176,32,.6)' : 'var(--line)'),
                    background: i === Math.min(dirIdx, dirLines.length - 1) ? 'rgba(255,176,32,.14)' : 'var(--s2)',
                    color: 'var(--fg)', font: '600 11px/1.4 var(--font-body)', cursor: 'pointer' }}>
                  {shortName(dl.from)} → {shortName(dl.to)}
                  {countsByDir[i] > 0 && <span className="tag g">{countsByDir[i]}</span>}
                </button>))}
            </span>)}
        </div>

        {/* whole-city live route chips */}
        {!route && !relay && routeCounts.length > 0 && (
          <div style={{ padding: '0 16px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {routeCounts.slice(0, 12).map((r) => (
              <button key={r.id} onClick={() => pickRoute(r.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--s2)', border: '1px solid var(--line2)',
                  borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: 'var(--fg)', font: '700 12px/1.4 var(--font-body)' }}>
                {r.id}<span className="dim sm">{r.n}</span>
              </button>))}
          </div>)}

        {/* search — its own strip, above the map card */}
        <div style={{ padding: '4px 16px 12px', position: 'relative' }}>
          <div className="search" style={{ margin: '6px 0 0' }}>
            <Icon n="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Route search — 3476 · 740 · OMS+ · 522…"
              style={{ padding: '11px 0', fontSize: 14 }} />
            {q && <button onClick={() => setQ('')} aria-label="Clear" style={{ background: 'none', border: 0, color: 'var(--fg3)' }}><Icon n="x" size={15} /></button>}
          </div>
          {showNoHit && (
            <div style={{ position: 'absolute', zIndex: 70, left: 16, right: 16, top: 'calc(100% - 6px)', background: 'var(--s2)',
              border: '1px solid var(--line2)', borderRadius: 15, boxShadow: '0 20px 46px -16px #000', padding: '10px 12px' }}>
              <div className="dim sm" style={{ marginBottom: 6 }}>“{q}” abhi kisi live bus par nahi hai (route list me bhi nahi) — abhi chal rahe routes:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {routeCounts.slice(0, 5).map((r) => (
                  <button key={r.id} onMouseDown={(e) => { e.preventDefault(); pickRoute(r.id); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--s1)', border: '1px solid var(--line2)',
                      borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: 'var(--fg)', font: '700 12px/1.4 var(--font-mono)' }}>
                    {r.id}<span className="dim sm">{r.n}</span>
                  </button>))}
              </div>
            </div>)}
          {suggestions.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 70, left: 16, right: 16, top: 'calc(100% - 6px)', background: 'var(--s2)',
              border: '1px solid var(--line2)', borderRadius: 15, boxShadow: '0 20px 46px -16px #000', overflow: 'hidden' }}>
              {suggestions.map((s, si) => (
                <button key={s.id + si} onMouseDown={(e) => { e.preventDefault(); pickRoute(s.id); }}
                  style={{ display: 'flex', width: '100%', gap: 9, alignItems: 'center', padding: '10px 14px', background: 'none',
                    border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)' }}>
                  <b style={{ fontFamily: 'var(--font-mono)', fontSize: 14, flex: '0 0 auto' }}>{s.id}</b>
                  {s.kind === 'live'
                    ? <span className="tag g" style={{ fontWeight: 700, flex: '0 0 auto' }}>{s.n} live now</span>
                    : <span className="tag" style={{ color: 'var(--cyan)', borderColor: 'rgba(76,201,255,.4)', flex: '0 0 auto' }}>static · 0 live abhi</span>}
                  <span className="dim sm" style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.kind === 'static' && s.dirs && s.dirs.length
                      ? s.dirs.map((d, di) => <span key={di}>{di > 0 && ' · '}{shortName(d.from)} → {shortName(d.to)}</span>)
                      : s.kind === 'live' ? (routeCounts.find((r) => r.id === s.id) ? 'live abhi' : '') : ''}
                  </span>
                  <Icon n="right" size={14} style={{ color: 'var(--fg3)', flex: '0 0 auto' }} />
                </button>))}
            </div>)}
        </div>
      </Card>

      {/* ============ map card — separate + collapsible (always mounted; hidden via display so Leaflet survives) ============ */}
      <Card pad={false} style={{ marginTop: 12, overflow: 'hidden', display: mapShow ? '' : 'none' }}>
        <div style={{ height: route ? '38vh' : '48vh', minHeight: route ? 220 : 280, position: 'relative', background: 'var(--s1)' }}>
            <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
            {relay && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bg) 55%, transparent)', zIndex: 300 }}>
              <div className="state" style={{ padding: '0 18px' }}>
                {setupMode ? <p className="dim sm">Server key set nahi — OTDLIVE_KEY + redeploy karo (README).</p>
                  : (<>
                    <p style={{ fontWeight: 650 }}>Ye host live data nahi de sakta</p>
                    <p className="dim sm" style={{ maxWidth: 300, margin: '4px auto 12px' }}>GitHub Pages static hai — live buses ke liye Vercel wala version kholo:</p>
                    <a className="btn" style={{ color: '#170800', textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}
                      href="https://delhi-dost.vercel.app/#livebus" target="_blank" rel="noopener">
                      <Icon n="link" size={15} /> Live version kholo ↗</a>
                  </>)}
              </div>
            </div>}
            {busy && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bg) 60%, transparent)', zIndex: 400 }}>
              <div className="state"><span className="spin" /><p>Live buses se jud rahe hain…</p></div>
            </div>}
          </div>
          {!route && !relay && all.length > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', padding: '8px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}><i style={{ width: 8, height: 8, borderRadius: 99, background: '#2FE39B', display: 'inline-block' }} /> moving</span>
              <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}><i style={{ width: 8, height: 8, borderRadius: 99, background: '#FFB020', display: 'inline-block' }} /> standing</span>
              <span className="dim sm" style={{ display: 'flex', gap: 5, alignItems: 'center' }}><i style={{ width: 8, height: 8, borderRadius: 99, background: '#8A94A8', display: 'inline-block' }} /> stale</span>
              <span className="dim sm" style={{ marginLeft: 'auto' }}>{all.length} buses · {movingAll} moving · routes {routeCounts.length}</span>
            </div>)}
        </Card>

      {!mapShow && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setMapShow(true)} className="btn ghost"
            style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
            <Icon n="map" size={15} /> Map dikhao
          </button>
        </div>)}

      {/* ============ route text track — the map-free view ============ */}
      {route && (
        <>
          {focusStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
              <div className="stat"><div className="v">{focusStats.n}</div><div className="l">buses</div></div>
              <div className="stat"><div className="v" style={{ color: '#2FE39B' }}>{focusStats.moving}</div><div className="l">moving</div></div>
              <div className="stat"><div className="v" style={{ color: 'var(--cyan)' }}>{focusStats.avg ? '~' + Math.round(focusStats.avg) : '—'}</div><div className="l">avg km/h</div></div>
              <div className="stat"><div className="v">{focusStats.max ? '~' + Math.round(focusStats.max) : '—'}</div><div className="l">top km/h</div></div>
            </div>)}

          {/* the rail */}
          {line && rail.length > 1 && (
            <Card pad={false} style={{ marginTop: 12, overflow: 'hidden' }}>
              <div className="chead" style={{ padding: '13px 15px 2px' }}>
                <Icon n="route" size={15} /> Ab kahan hain — {shortName(line.from)} → {shortName(line.to)}
                <span className="dim sm" style={{ marginLeft: 6 }}>{corr && corr.est ? '(corridor GPS-fit estimate · official route table mein nahi — raat ke baad naya data aa sakta hai)' : '(positions snapped se estimate hain)'}</span>
              </div>
              <div className="dim sm" style={{ padding: '2px 15px 6px', maxHeight: 46, overflow: 'hidden' }}
                title={rail.map((st) => label(st.n)).join(' · ')}>
                {rail.map((st, i) => <span key={i}>{i > 0 && ' · '}{label(st.n)}</span>)}
              </div>
              <div style={{ position: 'relative', padding: '2px 8px 10px' }}>
                {/* rail stops */}
                <div>
                  {rail.map((st, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, height: ROW, padding: '0 10px',
                      borderBottom: i < rail.length - 1 ? '1px dashed var(--line)' : 'none', position: 'relative' }}>
                      <span style={{ width: 11, height: 11, borderRadius: 99, flex: '0 0 auto', background: i === 0 ? 'var(--green)' : i === rail.length - 1 ? 'var(--rose)' : 'var(--s3)',
                        border: '2px solid ' + (i === 0 ? 'rgba(255,176,32,.8)' : i === rail.length - 1 ? 'rgba(255,93,115,.8)' : 'var(--line2)') }} />
                      <b style={{ fontSize: 12.6, fontWeight: 650 }}>{label(st.n)}</b>
                      {i === 0 && <span className="dim sm">start</span>}
                      {i === rail.length - 1 && <span className="tag" style={{ color: 'var(--rose)', borderColor: 'rgba(255,93,115,.4)' }}>end</span>}
                      <span className="dim sm" style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
                        {Math.round(st.p * 100)}%</span>
                    </div>))}
                </div>
                {/* animated bus dots */}
                {busDots.map((s, i) => {
                  const topPx = s.p * (rail.length - 1) * ROW;
                  const left = 40 + (i % 5) * 3;
                  const col = s.stale ? '#8A94A8' : s.moving ? '#2FE39B' : '#FFB020';
                  return (
                    <div key={s.b.id} onClick={() => { setSelBus(s.b.id); if (!mapShow) setMapShow(true); }}
                      title={`${s.b.id} · ${s.b.spd != null ? '~' + Math.round(s.b.spd) + ' km/h' : 'standing'}`}
                      style={{ position: 'absolute', left, top: Math.min(Math.max(0, topPx + ROW / 2 - 11), rail.length * ROW),
                        transition: 'top 1.1s cubic-bezier(.4,0,.2,1), opacity .4s', cursor: 'pointer', zIndex: 5,
                        display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'auto' }}>
                      <span style={{ width: 11, height: 11, borderRadius: 99, background: col, boxShadow: `0 0 9px ${col}` }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, background: 'color-mix(in srgb, var(--s2) 88%, transparent)',
                        border: '1px solid var(--line2)', borderRadius: 7, padding: '1px 5px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                        {s.b.id.slice(-4)}{s.b.spd != null ? ` ~${Math.round(s.b.spd)}` : ''}</span>
                    </div>);
                })}
              </div>
            </Card>)}

          {corrErr === 'static' && focus.length > 0 && (
            <div className="note" style={{ marginTop: 12 }}>Is route ka offline corridor is build mein nahi hai — neeche raw live positions dikh rahi hain.</div>)}

          {/* per-bus stop-level text list */}
          <Card pad={false} style={{ marginTop: 12 }}>
            <div className="chead" style={{ padding: '13px 15px 2px' }}><Icon n="bus" size={15} /> Buses on {route}
              {snapped.length > 0 && <span className="dim sm" style={{ marginLeft: 8 }}>{snapped.length} route pe · bina map ke bhi pata — position stops ke hisaab se</span>}
            </div>
            {routeErr && <div className="dim sm" style={{ padding: '4px 15px' }}>Route refresh unreachable — last data dikh raha hai.</div>}

            {snapped.length === 0 && unmatched.length === 0 && focus.length === 0 && (
              <div className="state" style={{ padding: '20px 14px' }}>
                <p style={{ fontWeight: 650 }}>{route} pe abhi koi live bus nahi</p>
                {line && <p className="dim sm" style={{ maxWidth: 460, margin: '6px auto 12px' }}>
                  Route ka poora corridor upar hai ({shortName(line.from)} → {shortName(line.to)}). Is waqt koi bus report nahi ho rahi —
                  raat ke hours mein kuch routes band ho jaate hain; subah/din mein dobara try karo.</p>}
                {routeCounts.slice(0, 6).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                    <span className="dim sm" style={{ alignSelf: 'center' }}>Abhi live:</span>
                    {routeCounts.slice(0, 6).map((r) => (
                      <button key={r.id} className="btn ghost sm" onClick={() => pickRoute(r.id)}>{r.id} · {r.n}</button>))}
                  </div>)}
              </div>)}

            {(snapped.length > 0 || unmatched.length > 0) && (
              <div style={{ maxHeight: 430, overflow: 'auto' }}>
                {snapped.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 15px', fontSize: 10, color: 'var(--fg3)', letterSpacing: .5, textTransform: 'uppercase' }}>
                    <span style={{ flex: 1 }}>Bus · route position</span>
                    <span style={{ width: 68 }}>speed</span><span style={{ width: 90, textAlign: 'right' }}>aage</span>
                  </div>)}
                {snapped.map((s) => {
                  const lineThis = dirLines[s.li];
                  const b = s.b;
                  const moving = b.spd != null && b.spd >= MOVING_KMH;
                  const stale = b.ts && Date.now() - b.ts * 1000 > STALE_MS;
                  const pct = Math.round(s.p * 100);
                  /* ETA to next real stop: remaining metres along corridor / live speed.
                     Zero-length legs (merged data ke duplicate coords) skip hote hain. */
                  let etaMin = null;
                  if (moving && lineThis.cum && s.seg != null && s.t != null) {
                    const si0 = Math.min(s.seg, lineThis.stops.length - 2);
                    const mAt = (lineThis.cum[si0] || 0) + s.t * ((lineThis.cum[si0 + 1] || 0) - (lineThis.cum[si0] || 0));
                    const kmh = Math.max(6, b.spd || 0);
                    for (let k = si0; k < lineThis.stops.length - 1; k++) {
                      const remM = (lineThis.cum[k + 1] || 0) - mAt;
                      if (remM > 120) { etaMin = Math.max(1, Math.round(remM / (kmh / 3.6) / 60)); break; }
                    }
                  }
                  const etaChip = etaMin != null
                    ? <> · <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>≈{etaMin} min</span></> : null;
                  return (
                    <div key={b.id} onClick={() => { setSelBus(b.id); if (!mapShow) setMapShow(true); }}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 15px', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, flex: '0 0 auto', background: stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020',
                        boxShadow: moving ? '0 0 8px rgba(47,227,155,.7)' : 'none' }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{b.id}</b>
                          <span className="dim sm">{shortName(lineThis.from)} → {shortName(lineThis.to)}</span>
                          {stale && <span className="tag">stale</span>}
                        </span>
                        <span className="sm" style={{ display: 'block', marginTop: 1, color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Icon n="pin" size={11} style={{ color: 'var(--cyan)' }} />
                          {pct <= 4 ? <>start ke paas · abhi {label(s.next.n)} ki taraf{etaChip}</>
                            : pct >= 96 ? <><b>{label(lineThis.to)}</b> ke paas (end)</>
                            : <><b>{label(s.prev.n)}</b> se aage · agla {label(s.next.n)} · {s.left} stop{lineThis.stops.length > 1 ? 's' : ''} baaki{etaChip}</>}
                        </span>
                      </span>
                      <span style={{ width: 68, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: moving ? '#2FE39B' : 'var(--fg2)' }}>
                        {b.spd != null ? '~' + Math.round(b.spd) : '—'}<span className="dim sm"> km/h</span></span>
                      <span style={{ width: 90, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg3)' }}>
                        {pct}% · {clock(b.ts)}</span>
                    </div>);
                })}
                {unmatched.map((b) => {
                  const moving = b.spd != null && b.spd >= MOVING_KMH;
                  const stale = b.ts && Date.now() - b.ts * 1000 > STALE_MS;
                  return (
                    <div key={b.id} onClick={() => { setSelBus(b.id); if (!mapShow) setMapShow(true); }}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 15px', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, flex: '0 0 auto', background: stale ? '#8A94A8' : moving ? '#2FE39B' : '#FFB020' }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{b.id}</b>
                        <span className="dim sm" style={{ marginLeft: 6 }}>
                          {corr && corr.lines.length ? 'corridor se door (depot?)' : <>live GPS · {b.lat.toFixed(3)}, {b.lon.toFixed(3)} · static corridor is route ke liye nahi</>}
                        </span>
                      </span>
                      <span style={{ width: 68, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
                        {b.spd != null ? '~' + Math.round(b.spd) : '—'}</span>
                      <span style={{ width: 90, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg3)' }}>{clock(b.ts)}</span>
                    </div>);
                })}
              </div>)}
            <div className="dim sm" style={{ borderTop: '1px solid var(--line)', padding: '8px 15px' }}>
              Stops ke beech position = GPS point ko route line pe snap karke nikala jaata hai (estimate). Speed ~ estimate. Green = moving · amber = standing · grey = stale (&gt;3 min).
            </div>
          </Card>
        </>)}

      {/* ============ whole-city list footer ============ */}
      {!route && !relay && all.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
          {routeCounts.map((r) => (
            <button key={r.id} onClick={() => pickRoute(r.id)}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', padding: '8px 16px', background: 'none', border: 0,
                borderTop: '1px solid var(--line)', cursor: 'pointer', color: 'var(--fg)', textAlign: 'left' }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: hueOf(r.id) }} />
              <b style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.id}</b>
              <span className="dim sm" style={{ marginLeft: 'auto' }}>{r.n} buses</span>
              <Icon n="right" size={13} style={{ color: 'var(--fg3)' }} />
            </button>))}
        </div>)}
    </div>
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
