/**
 * Joining the two datasets: which DTC bus actually stops at which metro station.
 *
 * The metro station pages publish the bus stops within a kilometre of each
 * station, but only by name and with a route COUNT.  The bus dataset has every
 * stop's name with its route list.  Matching the two by name turns "15 routes"
 * into the route numbers themselves — which is what makes a metro exit useful
 * to someone holding a bus timetable.
 *
 * Names are matched exactly first, then squashed (case, punctuation, brackets)
 * and substring-matched, because the two pages of the same source spell the
 * same place slightly differently ("ISBT Kashmere Gate Terminal" vs "ISBT
 * Kashmiri Gate").  A match is only accepted when it is unambiguous.
 */
import { STATIONS } from './metro-route.js';
import { STOPS, routesAtIndex } from './bus-route.js';

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, '');

let bySquash = null;
function index() {
  if (bySquash) return bySquash;
  bySquash = new Map();
  STOPS.forEach((s, i) => {
    const k = squash(s.n);
    if (!bySquash.has(k)) bySquash.set(k, []);
    bySquash.get(k).push(i);
  });
  return bySquash;
}

/**
 * Bus-table stop indices whose name matches a metro page's stop name.
 * Returned as indices, not names, so the caller can also require the stop to be
 * physically near the station — "Nehru Place" is a name that recurs across the
 * city and matching on name alone would pull in every bus that ever used it.
 */
export function matchStopIdx(want) {
  const idx = index();
  const k = squash(want);
  const exact = idx.get(k);
  if (exact?.length) return exact;
  if (k.length < 9) return [];            // too short to substring-match safely
  const hits = [];
  for (const [key, list] of idx) {
    if (key.length < 7) continue;
    if (key.includes(k) || k.includes(key)) hits.push(...list);
    if (hits.length > 16) break;
  }
  return [...new Set(hits)];
}

/**
 * Bus stops walking distance from a metro station, with the route numbers that
 * call there.  `station` is a station name.
 */
export function busAtStation(station, limit = 6) {
  const s = STATIONS.find((x) => x.n === station);
  if (!s) return [];
  const raw = (s.b || []).slice(0, limit);
  const rad = (d) => (d * Math.PI) / 180;
  const near = (i, metres) => {
    if (s.lat == null) return true;
    const o = STOPS[i];
    const dLat = rad(o.lat - s.lat), dLon = rad(o.lon - s.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(s.lat)) * Math.cos(rad(o.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1000 <= metres;
  };
  return raw.map((b) => {
    // a published distance of, say, 80 m means the stop is 80 m away; allow for
    // the platform being on the other side of a wide road before rejecting a name match
    const limit_m = Math.max(450, (b.m ?? 0) + 350);
    const hits = matchStopIdx(b.n).filter((i) => near(i, limit_m));
    const seen = new Set();
    for (const i of hits) for (const r of routesAtIndex(i)) seen.add(r.r);
    const nums = [...seen].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    return {
      name: b.n, m: b.m ?? null, declared: b.routes ?? null,
      count: nums.length, numbers: nums.slice(0, 16),
      stopsMatched: hits.length, verified: hits.length > 0,
    };
  });
}

/** Metro stations within `km` of a bus stop, with the lines that serve them. */
export function metroNearStop(stopName, km = 1.2) {
  const s = STOPS.find((x) => x.n === stopName);
  if (!s) return [];
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const out = [];
  for (const st of STATIONS) {
    if (st.lat == null) continue;
    const dLat = rad(st.lat - s.lat), dLon = rad(st.lon - s.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(s.lat)) * Math.cos(rad(st.lat)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(h));
    if (d <= km) out.push({ n: st.n, km: +d.toFixed(2), lines: st.l || [] });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 4);
}
