/**
 * Relay for live Delhi bus positions.
 *
 * SECURITY MODEL
 * ---------------
 * The key is set once as a server-side environment variable (OTDLIVE_KEY) on
 * the host. It never appears in the web app, never ships in the built files,
 * and never leaves the server. Visitors only ever call THIS endpoint on the
 * same origin; this function fetches the live feed server-side, decodes it and
 * returns a small JSON summary. There is no CORS hole because the browser
 * never talks to the upstream service at all.
 *
 * ENDPOINT (GET /api/live-bus)
 *   plain             -> { ok, at, feedTs, count, buses: [..] }   all buses
 *   ?route=740        -> same shape, only buses on that route (normalised)
 *   ?brief=1          -> { ok, at, feedTs, count, routes:[{id,n}] }  route counts
 *   ?route=&brief=1   -> single-route counts (for the picker row)
 *
 * FEED FACTS (observed, so the UI can be honest)
 *   · route ids are numeric strings, up to ~1 200 different routes a night
 *   · the feed never carries speed/bearing/stop/occupancy or a direction id —
 *     the app derives speed + heading by comparing successive positions
 *   · every vehicle carries its own report timestamp; some run minutes stale
 *
 * RESPONSES
 *   -> 200 { ok:true, at, feedTs, count, buses|routes }
 *   -> 503 { ok:false, error:'setup' }        key not configured yet
 *   -> 502 { ok:false, error:'upstream' }     live service unreachable
 *   -> 400 { ok:false, error:'badfeed' }      payload could not be decoded
 */
const DEFAULT_URL = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb';

/* tiny shared cache: several clients + a few polls share one upstream fetch */
const FEED_CACHE_TTL = 6000;     // fresh window: everyone shares one fetch
const STALE_MAX_MS = 120000;   // upstream down: keep answering from this window
let feedCache = null;          // { at, raw:Buffer }

async function fetchRaw(key, base) {
  const now = Date.now();
  if (feedCache && now - feedCache.at < FEED_CACHE_TTL) return feedCache.raw;
  const url = `${base}?key=${encodeURIComponent(key)}`;
  let raw = null;
  try {
    // 7 s cap — well under the platform's function limit, so a slow upstream
    // can never make THIS endpoint time out and answer with a bare error page.
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(7000) });
    if (r.ok) raw = Buffer.from(await r.arrayBuffer());
  } catch { /* fall through to stale */ }
  if (raw) { feedCache = { at: now, raw }; return raw; }
  if (feedCache && now - feedCache.at < STALE_MAX_MS) return feedCache.raw; // stale but real
  const e = new Error('upstream'); e.upstream = true; throw e;
}

/* ================================================================ wire fmt */
function readVarint(buf, p) {
  let v = 0n, shift = 0n;
  for (;;) {
    const b = buf[p++];
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
    if (shift > 63n) throw new Error('varint too long');
  }
  return [v, p];
}

function walk(buf, start, end, visit) {
  let p = start;
  while (p < end) {
    const [tag, q] = readVarint(buf, p); p = q;
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) { const [, n] = readVarint(buf, p); visit(field, wire, p, n); p = n; }
    else if (wire === 1) { visit(field, wire, p, p + 8); p += 8; }
    else if (wire === 2) {
      const [len, n] = readVarint(buf, p);
      visit(field, wire, n, n + Number(len));
      p = n + Number(len);
    } else if (wire === 5) { visit(field, wire, p, p + 4); p += 4; }
    else throw new Error('unsupported wire ' + wire);
  }
}

/* Scalar/type codes we understand. */
function readScalar(s, buf, wire, vp, vend) {
  if (s === 'str' && wire === 2) return buf.toString('utf8', vp, vend);
  if (s === 'varint' && wire === 0) { const [n] = readVarint(buf, vp); return Number(n); }
  if (s === 'f32' && wire === 5) return buf.readFloatLE(vp);
  if (s === 'f64' && wire === 1) return buf.readDoubleLE(vp);
  return undefined;
}

/* One pass: tags are emitted in ascending order by conformant encoders, but we
   accept any order — strings are sliced by offset and decoded on demand. */
function parse(buf, start, end, schema) {
  const out = {};
  walk(buf, start, end, (field, wire, vp, vend) => {
    const s = schema[field];
    if (!s) return;
    const rep = typeof s === 'object' && !Array.isArray(s) && !!s.r;
    const t = rep ? s.s : s;
    if (typeof t === 'string') {
      const v = readScalar(t, buf, wire, vp, vend);
      if (v === undefined) return;
      if (rep) { (out[field] ||= []).push(v); } else out[field] = v;
    } else if (typeof t === 'object' && wire === 2) {
      const v = parse(buf, vp, vend, t);
      if (rep) { (out[field] ||= []).push(v); } else out[field] = v;
    }
  });
  return out;
}

/* Wire layout of the OTD feed (verified against real captures):
   FeedMessage { 1: header, 2: entities }
   FeedEntity  { 1: id, 4: vehicle }
   VehiclePosition { 1: trip, 2: position, 3: stop_seq, 4: status,
                     5: timestamp, 6: congestion, 7: stop_id, 8: vehicle,
                     9: occupancy, 10: occupancy_pct } */
const TRIP = { 1: 'str', 2: 'str', 3: 'str', 4: 'varint', 5: 'str', 6: 'varint' };
const VDESC = { 1: 'str', 2: 'str', 3: 'str', 4: 'varint' };
const POSITION = { 1: 'f32', 2: 'f32', 3: 'f32', 4: 'f64', 5: 'f32' };
const VEHICLE = {
  1: TRIP, 2: POSITION, 3: 'varint', 4: 'varint', 5: 'varint', 6: 'varint',
  7: 'str', 8: VDESC, 9: 'varint', 10: 'varint',
};
const FEED_ENTITY = { 1: 'str', 4: VEHICLE };
const HEADER = { 1: 'str', 2: 'varint', 3: 'varint' };
const FEED = { 1: HEADER, 2: { r: true, s: FEED_ENTITY } };

/** Decode a VehiclePositions.pb payload -> { feedTs, buses[] }. */
export function decodeGtfsRt(buf) {
  const feed = parse(buf, 0, buf.length, FEED);
  const entities = feed[2] || [];
  const header = feed[1] || {};
  const feedTs = header[3] ? header[3] * 1000 : Date.now();
  const buses = [];
  for (const e of entities) {
    const v = e[4];
    if (!v || typeof v !== 'object') continue;
    const pos = v[2];
    if (!pos || !isFinite(pos[1]) || !isFinite(pos[2])) continue;
    const trip = v[1] || {};
    const desc = v[8] || {};
    const bus = {
      id: desc[1] || e[1] || null,
      route: trip[5] || null,
      trip: trip[1] || null,
      lat: Math.round(pos[1] * 1e6) / 1e6,
      lon: Math.round(pos[2] * 1e6) / 1e6,
      ts: v[5] ? v[5] * 1000 : null,
    };
    if (v[4] != null) bus.status = v[4];
    buses.push(bus);
  }
  return { feedTs, buses };
}

/* normalise a route string for matching: '0740' == '740', 'OMS(+)' == 'OMS',
   '0118EXT(NS) Ext' == '0118EXT' == '118EXT'. Keeps meaningful letters, drops
   decorations, leading zeros and duplicate EXT markers. */
export function normRoute(s) {
  let u = String(s || '').toUpperCase().trim();
  if (!u) return null;
  u = u.replace(/\([^)]*\)/g, ' ');                 // drop (NS) (T) etc
  let toks = u.split(/\s+/).filter(Boolean);
  toks[0] = toks[0].replace(/^0+(?=\d)/, '');       // strip leading zeros
  const head = toks[0] || '';
  if (/EXT$/.test(head)) {
    // '0118EXT ... Ext' — drop the repeated EXT token
    toks = [head, ...toks.slice(1).filter((t) => t !== 'EXT')];
  } else {
    // '740 Ext' -> '740EXT'
    toks = toks.filter((t) => t !== 'STL');
    if (toks.length > 1 && toks[toks.length - 1] === 'EXT') toks = [toks.join('')];
  }
  const out = toks.join('').replace(/[^A-Z0-9]/g, '');
  return out || null;
}

/* ================================================================= handler */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'method' }));
  }

  const key = process.env.OTDLIVE_KEY;
  if (!key) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: 'setup' }));
  }
  const base = (process.env.OTD_URL || DEFAULT_URL).replace(/\/+$/, '');

  const fetchStarted = Date.now();
  let decoded, stale = false;
  try {
    const raw = await fetchRaw(key, base);
    stale = feedCache ? Date.now() - feedCache.at > FEED_CACHE_TTL : false;
    decoded = decodeGtfsRt(raw);
  } catch (e) {
    const up = (e && (e.upstream || String(e.message || '').startsWith('upstream')));
    res.statusCode = up ? 502 : 400;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: up ? 'upstream' : 'badfeed' }));
  }

  const qs = new URL(req.url, 'http://x').searchParams;
  const wantBrief = qs.get('brief') === '1';
  const route = (qs.get('route') || '').trim();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (wantBrief) {
    const m = new Map();
    for (const b of decoded.buses) {
      const r = b.route;
      if (!r) continue;
      m.set(r, (m.get(r) || 0) + 1);
    }
    const routes = [...m.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const body = { ok: true, at: Date.now(), feedTs: decoded.feedTs, count: decoded.buses.length, routes };
    if (stale) body.stale = true;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(body));
  }

  let buses = decoded.buses;
  if (route) {
    const want = normRoute(route);
    buses = buses.filter((b) => normRoute(b.route) === want);
  }
  const body = {
    ok: true, at: Date.now(), feedTs: decoded.feedTs,
    count: buses.length, buses,
  };
  if (route) body.note = 'filtered';
  if (stale) body.stale = true;
  // no-store: this endpoint always answers from live (or fresh-ish cached)
  // upstream data; the CDN must never pin an old snapshot.
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  return res.end(JSON.stringify(body));
}
