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
 * ENDPOINT
 *   GET /api/live-bus
 *   -> 200 { ok, at, count, buses: [ {id,label,route,trip,lat,lon,bearing,
 *                                     speed,status,stop,ts} ] }
 *   -> 503 { ok:false, error:'setup' }        key not configured yet
 *   -> 502 { ok:false, error:'upstream' }     live service unreachable
 *   -> 400 { ok:false, error:'badfeed' }      payload could not be decoded
 */
const DEFAULT_URL = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb';

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
   accept any order — strings are sliced by offset and decoded on demand.
   schema values: 'str'|'varint'|'f32'|'f64' | nested schema | {r:true, s:…} for
   repeated fields (collected into arrays). */
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

/* GTFS-rt subset (field number -> type or nested schema). */
const VEHICLE = {
  1: { 1: 'str', 5: 'str' },          // trip
  4: { 1: 'f32', 2: 'f32', 3: 'f32', 4: 'f64', 5: 'f32' }, // position
  5: 'varint', 6: 'varint', 7: 'str',
  8: { 1: 'str', 2: 'str', 3: 'str' },// vehicle
  9: 'varint',
};
const FEED_ENTITY = { 1: { r: true, s: 'str' }, 4: { r: true, s: VEHICLE } };
const FEED = { 1: { r: true, s: FEED_ENTITY }, 2: { 1: 'str', 3: 'varint' } };

/** Decode a VehiclePositions.pb payload -> { feedTs, buses[] }. */
export function decodeGtfsRt(buf) {
  const feed = parse(buf, 0, buf.length, FEED);
  const entities = feed[1] || [];
  const header = feed[2] || {};
  const feedTs = header[3] ? header[3] * 1000 : Date.now();
  const buses = [];
  for (const e of entities) {
    const v = (e[4] || [])[0];       // repeated in schema; feeds send one
    if (!v) continue;
    const pos = v[4];
    if (!pos || !isFinite(pos[1]) || !isFinite(pos[2])) continue;
    const trip = v[1] || {};
    const desc = v[8] || {};
    buses.push({
      id: desc[1] || null,
      label: desc[2] || desc[3] || null,
      route: trip[5] || null,
      trip: trip[1] || null,
      lat: Math.round(pos[1] * 1e6) / 1e6,
      lon: Math.round(pos[2] * 1e6) / 1e6,
      bearing: pos[3] != null ? Math.round(pos[3]) : null,
      speed: pos[5] != null ? Math.round(pos[5] * 3.6) : null, // m/s -> km/h
      status: v[6] != null ? v[6] : null,
      stop: v[7] || null,
      ts: v[9] ? v[9] * 1000 : feedTs,
    });
  }
  return { feedTs, buses };
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
  const url = `${base}?key=${encodeURIComponent(key)}`;

  let raw;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: '*/*' } });
    clearTimeout(to);
    if (!r.ok) throw new Error('upstream ' + r.status);
    raw = Buffer.from(await r.arrayBuffer());
  } catch {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: 'upstream' }));
  }

  let decoded;
  try {
    decoded = decodeGtfsRt(raw);
  } catch {
    res.statusCode = 400;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: 'badfeed' }));
  }

  const body = {
    ok: true,
    at: Date.now(),
    count: decoded.buses.length,
    buses: decoded.buses,
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=5'); // short: clients may share one burst
  res.statusCode = 200;
  return res.end(JSON.stringify(body));
}
