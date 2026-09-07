/**
 * Delhi bus journey planner, route browser and timetable engine.
 *
 * Data: src/data/bus-delhi.json — every DTC / Delhi Transit route direction
 * published by the transport department, with the stop sequence, the coordinate
 * of every stop, the polyline the bus actually drives, and the departure
 * timetable.  Build it with scripts/build_transit_data.py.  Nothing invented.
 *
 * ---------------------------------------------------------------- DISTANCES
 * A route record carries `m`: the distance in metres along its own published
 * polyline at each stop.  A journey is therefore |m[a] - m[b]| — a road
 * distance, measured offline, no routing service needed.  Records whose source
 * straight-line sum is scaled by ROAD_FACTOR, the median road/straight ratio
 * measured against OSRM on real Delhi journeys.
 *
 * --------------------------------------------------------------------- FARES
 * Official DTC slabs, unchanged since the 2016 revision:
 *   Ordinary (green/orange) : <=4 km Rs5 · 4-10 km Rs10 · >10 km Rs15
 *   AC (red)                : <=4 km Rs10 · 4-8 km Rs15 · 8-12 km Rs20 · >12 km Rs25
 *   Children 5-12 yrs pay a reduced slab; under 5 free.
 *   DMRC metro feeder       : <=8 km Rs7 · >8 km Rs10
 *   Green Card day pass     : Rs40 non-AC · Rs50 AC
 *   Women travel free on DTC and cluster buses with the pink ticket.
 *
 * --------------------------------------------------------------- TIMETABLES
 * Each direction carries the published first/last departure, trips per day,
 * peak and off-peak headway, and the full list of departure times from its
 * own terminal.  statusNow()/nextDepartures() answer "is it running, and when
 * is the next one" from that plus the device clock — the transit GPS feeds for
 * keyless live vehicle position to poll; see the note in src/core/live.js.
 */
import DATA from '../data/bus-delhi.json';

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export const haversine = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Median road/straight ratio measured on real Delhi bus journeys via OSRM. */
export const ROAD_FACTOR = 1.28;

export const ROUTES = DATA.routes;
export const STOPS = DATA.stops;
export const BUILT = DATA.built;
export const SOURCE = DATA.source || '';
export const STATS = DATA.stats || {};
export const DAY_PASS = { nonAc: 40, ac: 50 };
export const PASSES = {
  daily: [40, 50], weekly: [280, 350], fortnight: [560, 700],
  monthly: [800, 1000], quarterly: [2280, 2850],
  halfYear: [4440, 5550], yearly: [8640, 10800],
  seniorMonthly: [50, 150], studentAllRoute: [150, 200],
};

/* ---- stop table: index-based (v2 and v1 files both use indices) ---------- */
const INDEXED = !DATA.routes.length || typeof DATA.routes[0].s[0] === 'number';
const AT_IDX = STOPS.map((s, i) => ({ ...s, i }));
const POS = new Map();
for (const s of AT_IDX) if (!POS.has(s.n)) POS.set(s.n, s);
const rec = (v) => (typeof v === 'number' ? AT_IDX[v] : POS.get(v));
export const nameOf = (v) => rec(v)?.n ?? String(v);

/** stop index (or name for legacy files) -> Set(route index) */
const AT = new Map();
ROUTES.forEach((r, i) => {
  for (const s of r.s) {
    if (!AT.has(s)) AT.set(s, new Set());
    AT.get(s).add(i);
  }
});

const BY_NAME = new Map();
for (const s of AT_IDX) {
  if (!BY_NAME.has(s.n)) BY_NAME.set(s.n, []);
  BY_NAME.get(s.n).push(s);
}

export const stopNames = [...BY_NAME.keys()].sort();
export const isStop = (n) => BY_NAME.has(n);

function routeCount(name) {
  const set = new Set();
  for (const s of BY_NAME.get(name) || []) {
    const ids = AT.get(INDEXED ? s.i : name);
    if (ids) for (const id of ids) set.add(id);
  }
  return set.size;
}

export function searchStops(q, limit = 8) {
  if (!q?.trim()) return [];
  const s = q.toLowerCase().trim();
  const a = [], b = [];
  for (const n of stopNames) {
    const l = n.toLowerCase();
    if (l.startsWith(s)) a.push(n);
    else if (l.includes(s)) b.push(n);
    if (a.length >= limit * 2) break;
  }
  const rank = (x) => -routeCount(x);          // busiest interchanges first
  a.sort((x, y) => rank(x) - rank(y));
  b.sort((x, y) => rank(x) - rank(y));
  return [...a, ...b].slice(0, limit);
}

/* ------------------------------------------------------------------ fares */
const SLABS = DATA.fare || {};
/** The published slab tables themselves, so the UI renders data and never a
 *  copy of it that could drift. Each row is [upto-km-or-null, price]. */
export const FARE_TABLE = SLABS;
const slabsFor = (ac) => (ac ? SLABS.ac : SLABS.ordinary) ||
  (ac ? [[4, 10], [8, 15], [12, 20], [null, 25]] : [[4, 5], [10, 10], [null, 15]]);

function slabFare(km, slabs) {
  for (const [hi, amt] of slabs) if (hi === null || km <= hi) return amt;
  return slabs[slabs.length - 1][1];
}
export const busFare = (km, ac = false) => slabFare(km, slabsFor(ac));
export const childFare = (km, ac = false) => slabFare(km, (ac ? SLABS.child_ac : SLABS.child_ordinary) ||
  (ac ? [[4, 5], [8, 8], [12, 10], [null, 13]] : [[4, 3], [10, 5], [null, 8]]));
export const feederFare = (km) => slabFare(km, SLABS.feeder || [[8, 7], [null, 10]]);

export function fareSlab(km, ac = false) {
  const slabs = slabsFor(ac);
  let lo = 0;
  for (const [hi, fare] of slabs) {
    if (hi === null || km <= hi) return { lo, hi: hi ?? Infinity, fare, nextAt: hi ?? null };
    lo = hi;
  }
  return { lo: 0, hi: Infinity, fare: ac ? 25 : 15, nextAt: null };
}

/* --------------------------------------------------------------- distance */
/** metres along the route's own polyline at stop position i (undefined if none) */
export const alongMetres = (r, i) => (r.m && r.sm !== 0 ? Math.abs(r.m[i]) : undefined);

/**
 * Distance of a ride from position i to position j on route r.
 * Returns { km, shape } — shape=true when it came from the route polyline.
 */
export function journeyKm(r, i, j) {
  if (r.m && r.sm !== 0) {
    const km = Math.abs((r.m[j] ?? 0) - (r.m[i] ?? 0)) / 1000;
    if (km > 0.02) return { km: +km.toFixed(2), shape: true };
  }
  let s = 0;
  for (let k = Math.min(i, j); k < Math.max(i, j); k++) {
    const a = rec(r.s[k]), b = rec(r.s[k + 1]);
    if (a && b) s += haversine(a, b);
  }
  return { km: +(s * ROAD_FACTOR).toFixed(2), shape: false };
}
/** kept for the older call sites / verification scripts */
export const routeKm = (r, i, j) => journeyKm(r, i, j).km;

/** Full published length of a route, km. */
export const routeLength = (r) => r.km ?? +(r.s.reduce((s, v, i) =>
  i ? s + haversine(rec(r.s[i - 1]) || { lat: 0, lon: 0 }, rec(v) || { lat: 0, lon: 0 }) : 0, 0)
  * ROAD_FACTOR).toFixed(2);

/** Average running speed in km/h, from the published length and travel time. */
export function routeSpeed(r) {
  if (!r.mins || !r.km) return null;
  const h = r.mins / 60;
  return h > 0 ? +(r.km / h).toFixed(1) : null;
}

/* -------------------------------------------------------------- timetable */
const pad = (n) => String(n).padStart(2, '0');
/** minutes since midnight for a Date, in *Delhi* time (the data is Delhi-only) */
export function minutesOfDay(d = new Date()) {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  return ist.getHours() * 60 + ist.getMinutes();
}
export const fmtTime = (m) => {
  if (m == null) return '—';
  const x = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(x / 60), mi = x % 60;
  const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return `${h12}:${pad(mi)} ${ap}`;
};
export const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m} min`);

/** Every published departure time of one direction, minutes since midnight. */
export function departures(r) {
  const d = r.tt?.d;
  if (d?.length) return [...d].sort((a, b) => a - b);
  const w = serviceWindow(r);
  if (!w) return [];
  const span = w[1] - w[0];
  const n = Math.max(2, r.tt?.k || Math.round(span / 30) || 8);
  const gap = span / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(w[0] + i * gap));
}

/** First / last departure published for this direction. */
export function serviceWindow(r) {
  const a = r.tt?.a, b = r.tt?.b;
  if (a != null && b != null) return [a, b];
  const d = r.tt?.d;
  if (d?.length) return [d[0], d[d.length - 1]];
  return null;
}

/** Headway that applies right now: peak window or off-peak. */
export function headwayNow(r, at = minutesOfDay()) {
  const pw = r.tt?.pw || [[8, 10], [17, 19]];
  const inPeak = pw.some(([a, b]) => at >= a * 60 && at < b * 60);
  const range = inPeak ? r.tt?.pk : r.tt?.op;
  const both = inPeak ? (r.tt?.pk || r.tt?.op) : (r.tt?.op || r.tt?.pk);
  const pick = range || both;
  const lo = pick?.[0] ?? null, hi = pick?.[1] ?? null;
  return { peak: inPeak, lo, hi,
           label: lo == null ? null : lo === hi ? `every ${lo} min` : `every ${lo}–${hi} min` };
}

/**
 * Is this direction running right now, and when is the next departure?
 * state: running · soon · closed · last · before
 */
export function statusNow(r, now = new Date()) {
  const at = minutesOfDay(now);
  const win = serviceWindow(r);
  const deps = departures(r);
  if (!win && !deps.length) return { known: false, state: 'unknown' };
  const next = deps.filter((m) => m >= at);
  if (win && at < win[0]) {
    return { known: true, state: 'before', opens: win[0], opensAt: fmtTime(win[0]),
             inMins: win[0] - at, next: deps.slice(0, 3), nextLabel: fmtTime(deps[0]) };
  }
  if (win && at > win[1] + 2) {
    return { known: true, state: 'closed', closedAfter: fmtTime(win[1]), lastLeft: win[1],
             next: [], opens: win[0], opensAt: fmtTime(win[0]),
             inMins: 1440 - at + win[0] };
  }
  if (!next.length) {
    return { known: true, state: 'last', last: win ? win[1] : deps.at(-1), lastAt: fmtTime(deps.at(-1) ?? win?.[1]),
             next: [], opens: win?.[0], opensAt: win ? fmtTime(win[0]) : null,
             inMins: win ? 1440 - at + win[0] : null };
  }
  const wait = next[0] - at;
  return { known: true, state: wait <= 5 ? 'soon' : 'running',
           next: next.slice(0, 4), wait, nextAt: fmtTime(next[0]),
           last: win?.[1], lastAt: win ? fmtTime(win[1]) : null,
           left: deps.filter((m) => m < at).length, total: deps.length,
           headway: headwayNow(r, at) };
}

/**
 * When a bus that leaves the terminal at `dep` reaches a given stop position.
 * Uses the route's own published length and end-to-end time — a proportion of
 * a published number, not a guess from thin air.
 */
export function arrivalAt(r, pos, depMin) {
  if (!r.m || r.sm === 0 || !r.mins) return null;
  const frac = r.m[r.m.length - 1] ? r.m[pos] / r.m[r.m.length - 1] : null;
  if (frac == null) return null;
  return Math.round(depMin + frac * r.mins);
}

/** The next few buses past a given stop, as clock times. */
/**
 * Published travel time between two stops of one direction, scaled to the real
 * gap between them.  `at` (minutes since midnight) adds the wait for the next
 * departure so a caller can show an arrival clock time as well as a duration.
 */
export function busEta(rec, iFrom, iTo, at = null) {
  const n = rec.s.length;
  if (n < 2 || !rec.mins) return null;
  let km = 0;
  for (let k = Math.min(iFrom, iTo); k < Math.max(iFrom, iTo); k++) {
    const a = rec.m && rec.m[k + 1] > rec.m[k] ? (rec.m[k + 1] - rec.m[k]) / 1000
                                               : haversine(STOPS[rec.s[k]], STOPS[rec.s[k + 1]]);
    km += a;
  }
  if (km <= 0) return null;
  const full = (rec.m && rec.m[n - 1] ? rec.m[n - 1] : 0) / 1000 || rec.km || 0;
  const share = full > 0 ? Math.min(1, km / full) : Math.abs(iTo - iFrom) / (n - 1);
  let mins = Math.max(1, Math.round(Math.max(share, 0.01) * rec.mins));
  if (at != null) {
    const nxt = departures(rec).find((x) => x >= at);
    mins += nxt != null ? Math.min(nxt - at, 60) : 0;
  }
  return mins;
}

/** The next few departures from the terminal, with the wait that applies. */
export function nextDepartures(r, now = new Date(), n = 4) {
  const s = statusNow(r, now);
  const list = ((s.nextAll && s.nextAll.length ? s.nextAll : s.next) || []).slice(0, n);
  return { times: list, labels: list.map(fmtTime), wait: s.wait ?? null, state: s.state };
}

export function nextAtStop(r, pos, now = new Date(), n = 4) {
  const at = minutesOfDay(now);
  const out = [];
  for (const d of departures(r)) {
    const a = arrivalAt(r, pos, d);
    const t = a == null ? d : a;
    if (t >= at) out.push({ dep: d, at: t, mins: t - at });
    if (out.length >= n) break;
  }
  return out;
}

/** Return direction of the same route, when the source publishes one. */
export const returnOf = (r) => (r.rv != null ? ROUTES[r.rv] : null);
export const indexOf = (r) => ROUTES.indexOf(r);

/* ------------------------------------------------- exact distance (online) */
/**
 * Road distance from OSRM (CORS `*`, no key).  Only for records without a
 * published polyline — everything else is already measured offline.
 */
export async function roadDistance(path, { anchors = 3, ms = 9000 } = {}) {
  const pts = path.map(rec).filter(Boolean);
  if (pts.length < 2) return null;
  const pick = [pts[0]];
  for (let i = 1; i <= anchors; i++) {
    const j = Math.round((i * (pts.length - 1)) / (anchors + 1));
    if (j > 0 && j < pts.length - 1) pick.push(pts[j]);
  }
  pick.push(pts[pts.length - 1]);
  const coords = pick.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const urls = [
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=false`,
  ];
  for (const u of urls) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(u, { signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error(j.code || 'no route');
      return { km: +(j.routes[0].distance / 1000).toFixed(2),
               mins: Math.round(j.routes[0].duration / 60), src: 'OSRM' };
    } catch { /* next provider */ } finally { clearTimeout(t); }
  }
  return null;
}

/** Attach OSRM road distance + recomputed fares to an option, in place. */
export async function refineFare(opt) {
  const legs = await Promise.all(opt.legs.map((l) => roadDistance(l.path)));
  if (legs.some((x) => !x)) return null;
  let km = 0, mins = 0;
  opt.legs.forEach((l, i) => {
    l.roadKm = legs[i].km; l.roadMins = legs[i].mins;
    l.fare = busFare(legs[i].km); l.fareAc = busFare(legs[i].km, true);
    km += legs[i].km; mins += legs[i].mins;
  });
  opt.roadKm = +km.toFixed(2);
  opt.fare = opt.legs.reduce((s, l) => s + l.fare, 0);
  opt.fareAc = opt.legs.reduce((s, l) => s + l.fareAc, 0);
  opt.fareChild = opt.legs.reduce((s, l) => s + childFare(l.roadKm), 0);
  opt.minutes = Math.round(mins * 1.35 + opt.changes * 8 + 3);
  opt.exact = true;
  opt.src = 'OSRM';
  return opt;
}

/* ---------------------------------------------------------------- planner */
/**
 * Journeys from A to B: direct buses, plus one-change options when there are
 * fewer than three direct ones.  Distances come from the route polylines when
 * the source published them, otherwise straight line x ROAD_FACTOR.
 */
export function planBus(fromName, toName, { max = 6 } = {}) {
  if (!BY_NAME.has(fromName) || !BY_NAME.has(toName)) throw new Error('Unknown stop');
  if (fromName === toName) throw new Error('Origin and destination are the same');

  const keysOf = (n) => (INDEXED ? BY_NAME.get(n).map((s) => s.i) : [n]);
  const fromKeys = keysOf(fromName), toKeys = keysOf(toName);
  const A = new Set(), B = new Set();
  for (const k of fromKeys) for (const i of AT.get(k) || []) A.add(i);
  for (const k of toKeys) for (const i of AT.get(k) || []) B.add(i);

  const out = [];
  const idxIn = (r, keys) => {
    for (const k of keys) { const i = r.s.indexOf(k); if (i >= 0) return i; }
    return -1;
  };
  const legOf = (r, ri, i, j, from, to) => {
    const { km, shape } = journeyKm(r, i, j);
    const rev = j < i;                       // boarding index is always the `from` end
    const path = rev ? r.s.slice(j, i + 1).reverse() : r.s.slice(i, j + 1);
    const speed = routeSpeed(r);
    const mins = speed ? Math.max(3, Math.round((km / speed) * 60)) : Math.round(km / 0.28);
    const win = serviceWindow(r);
    return { ref: r.r, from, to, stops: Math.abs(j - i), km: +km.toFixed(2), shape,
             op: r.o || '', dir: `${r.f} → ${r.t}`, minutes: mins,
             ri, i0: rev ? j : i, i1: rev ? i : j, boardFrom: rev ? 'end' : 'start',
             timed: !!(r.tt && r.tt.d && r.tt.d.length),
             first: win ? win[0] : null, last: win ? win[1] : null,
             trips: r.tt?.k ?? (r.tt?.d?.length || null),
             path, names: path.map(nameOf) };
  };

  /* ---- direct ---- */
  for (const ri of A) {
    if (!B.has(ri)) continue;
    const r = ROUTES[ri];
    const i = idxIn(r, fromKeys), j = idxIn(r, toKeys);
    if (i < 0 || j < 0 || i === j) continue;
    const leg = legOf(r, ri, i, j, fromName, toName);
    out.push({ changes: 0, legs: [leg], stops: leg.stops, km: leg.km, shape: leg.shape });
  }

  /* ---- one interchange ---- */
  if (out.length < 3) {
    const seen = new Set(out.map((o) => o.legs.map((l) => l.ref).join('>')));
    const cand = [];
    for (const r1i of A) {
      const r1 = ROUTES[r1i];
      const i1 = idxIn(r1, fromKeys);
      if (i1 < 0) continue;
      for (const mid of r1.s) {
        if (fromKeys.includes(mid) || toKeys.includes(mid)) continue;
        const via = AT.get(mid);
        if (!via) continue;
        for (const r2i of via) {
          if (r2i === r1i || !B.has(r2i)) continue;
          const r2 = ROUTES[r2i];
          const m1 = r1.s.indexOf(mid), m2 = r2.s.indexOf(mid), j2 = idxIn(r2, toKeys);
          if (m1 < 0 || m2 < 0 || j2 < 0 || m2 === j2) continue;
          const k = `${r1.r}>${r2.r}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const l1 = legOf(r1, r1i, i1, m1, fromName, nameOf(mid));
          const l2 = legOf(r2, r2i, m2, j2, nameOf(mid), toName);
          cand.push({
            changes: 1,
            legs: [l1, l2],
            interchange: nameOf(mid),
            stops: l1.stops + l2.stops,
            km: +(l1.km + l2.km).toFixed(2),
            shape: l1.shape && l2.shape,
          });
        }
      }
      if (cand.length > 400) break;
    }
    cand.sort((a, b) => a.stops - b.stops);
    out.push(...cand.slice(0, 4));
  }

  for (const o of out) {
    o.legs.forEach((l) => {
      l.fare = busFare(l.km);
      l.fareAc = busFare(l.km, true);
    });
    o.fare = o.legs.reduce((s, l) => s + l.fare, 0);
    o.fareAc = o.legs.reduce((s, l) => s + l.fareAc, 0);
    o.fareChild = o.legs.reduce((s, l) => s + childFare(l.km), 0);
    o.estKm = o.km;
    o.minutes = o.shape
      ? o.legs.reduce((s, l) => s + l.minutes, 0) + o.changes * 8
      : Math.round(o.km / 0.28 + o.changes * 8 + 3);
    o.exact = !!o.shape;                 // measured along the driven route
    o.src = o.shape ? 'route shape' : 'straight line';
    const at = minutesOfDay();
    o.nowState = o.legs.map((l) => statusNow(ROUTES[l.ri]).state);
    o.running = o.nowState.every((s) => s === 'running' || s === 'soon' || s === 'unknown');
    o.boardAt = at;
  }
  out.sort((a, b) => a.changes - b.changes || a.stops - b.stops);
  return out.slice(0, max);
}

/** Every route serving any platform with this name. */
export function routesAt(stopName) {
  const set = new Set();
  for (const s of BY_NAME.get(stopName) || []) {
    for (const id of AT.get(INDEXED ? s.i : stopName) || []) set.add(id);
  }
  return [...set].map((i) => ROUTES[i])
    .sort((a, b) => a.r.localeCompare(b.r, undefined, { numeric: true }));
}

/** Routes calling at one specific physical platform (index into STOPS). */
export function routesAtIndex(i) {
  return [...(AT.get(i) || [])].map((j) => ROUTES[j]);
}

/** Coordinates of a published stop by name (first occurrence wins). */
export const stopAt = (n) => {
  const s = BY_NAME.get(n)?.[0];
  return s && s.lat != null ? { lat: s.lat, lon: s.lon, n: s.n } : null;
};

export function nearestStops(lat, lon, n = 5) {
  const best = new Map();
  for (const s of AT_IDX) {
    const km = haversine({ lat, lon }, s);
    const cur = best.get(s.n);
    if (!cur || km < cur.km) best.set(s.n, { ...s, km });
  }
  return [...best.values()].sort((a, b) => a.km - b.km).slice(0, n);
}

const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Look up a route by its number (tolerant about AC- / spaces / leading zeros). */
export function findRoute(ref) {
  const q = norm(ref).replace(/^0+/, '');
  if (!q) return [];
  const exact = [], part = [];
  for (const r of ROUTES) {
    const k = norm(r.r).replace(/^0+/, '');
    if (k === q) exact.push(r);
    else if (k.includes(q) && q.length >= 2) part.push(r);
    if (exact.length > 24) break;
  }
  return exact.length ? exact : part;
}

/** Distinct route numbers, so the browser can show "1,234 routes". */
export const routeNumbers = (() => {
  const s = new Set();
  for (const r of ROUTES) s.add(norm(r.r));
  return [...s];
})();

/** Free-text search over route numbers and both terminals. */
export function searchRoutes(q, limit = 40) {
  const s = String(q || '').toLowerCase().trim();
  const out = [];
  for (const r of ROUTES) {
    if (!s || r.r.toLowerCase().includes(s) || r.f.toLowerCase().includes(s) ||
        r.t.toLowerCase().includes(s)) out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** Index of the stop of `name` on route r, from either end. */
export function stopIndexOn(r, name, fromStart = true) {
  const keys = new Set((BY_NAME.get(name) || []).map((s) => s.i));
  const seq = r.s.map((v, i) => ({ v, i })).filter((x) => keys.has(x.v));
  if (!seq.length) return -1;
  return fromStart ? seq[0].i : seq[seq.length - 1].i;
}

export const routeStops = (r) => r.s.map(nameOf);
export const routeMeta = (r) => ({
  agency: r.o || 'DTC / cluster',
  km: r.km ?? null,
  minutes: r.mins ?? null,
  speed: routeSpeed(r),
  window: serviceWindow(r),
  trips: r.tt?.k ?? (r.tt?.d?.length || null),
  headway: r.tt?.pk || r.tt?.op || null,
  peakWindows: r.tt?.pw || null,
  stopCount: r.s.length,
  shape: r.sm !== 0,
});
