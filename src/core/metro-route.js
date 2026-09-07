/**
 * Delhi Metro journey planner, line status and fare engine.
 *
 * Data: src/data/metro-delhi.json — built by scripts/build_transit_data.py from
 * the published line and station pages of the network, with station geometry
 * 16 line records across 12 corridors, 287 stations, every station carrying
 * the bus stops within a kilometre of it.
 *
 * Fares: DMRC slabs effective 25 Aug 2025 (first revision in 8 years), taken
 * from the corporation's own announcement — Rs 1 to Rs 4 higher, Rs 5 on the
 * Airport Express Line — and cross-checked against four news reports.
 * Sunday / national-holiday slabs are one step below the weekday ones.
 *
 * Algorithm: k-shortest-paths via repeated Dijkstra with edge penalties, so the
 * user sees several genuinely different options (fastest / fewest changes),
 * not one answer.
 *
 * "Live": DMRC publishes no keyless real-time feed, so what the app can answer
 * honestly is (a) whether a line is running right now, (b) the headway that
 * applies at this hour, and (c) whether a last train still exists for a
 * journey — all derived from published timings and the device clock.  Anything
 * beyond that would be invented, so it is not shown.
 */
// Vite inlines this JSON at build time. (The Node verification script uses a
// small loader shim so the same module works in both environments.)
import DATA from '../data/metro-delhi.json';

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const STATIONS = DATA.stations;
export const LINES = DATA.lines;
export const BUILT = DATA.built;
export const SOURCE = DATA.source || '';
export const FARES = DATA.fares || {};
export const STATS = DATA.stats || {};
const POS = new Map(STATIONS.map((s) => [s.n, s]));
const BY_NAME = POS;

/* adjacency: station -> [{ to, line, colour, km }] */
const ADJ = new Map();
for (const L of LINES) {
  for (let i = 0; i < L.s.length - 1; i++) {
    const a = L.s[i], b = L.s[i + 1];
    const pa = POS.get(a), pb = POS.get(b);
    if (!pa || !pb) continue;
    const km = haversine(pa, pb);
    if (!ADJ.has(a)) ADJ.set(a, []);
    if (!ADJ.has(b)) ADJ.set(b, []);
    ADJ.get(a).push({ to: b, line: L.l, colour: L.c, km });
    ADJ.get(b).push({ to: a, line: L.l, colour: L.c, km });
  }
}

/* Foot transfers between stations that are not the same platform — the only
   documented one in this network is the walkway between the Blue Line's Noida
   Sector 52 and the Aqua Line's Noida Sector 51. */
export const WALKS = DATA.walks || [];
const NET = new Map(LINES.map((L) => [L.l, L.net || 'DMRC']));
const LINE_COLOUR = new Map(LINES.map((L) => [L.l, L.c]));
for (const w of WALKS) {
  if (!ADJ.has(w.a) || !ADJ.has(w.b)) continue;
  const la = (POS.get(w.a)?.l || [])[0], lb = (POS.get(w.b)?.l || [])[0];
  ADJ.get(w.a).push({ to: w.b, line: 'Foot transfer', colour: null, km: (w.m || 300) / 1000, walk: true });
  ADJ.get(w.b).push({ to: w.a, line: 'Foot transfer', colour: null, km: (w.m || 300) / 1000, walk: true });
}

export const stationNames = [...POS.keys()].sort();
export const isStation = (n) => POS.has(n);
export const stationAt = (n) => POS.get(n) || null;
/** corridors: Red Line, Yellow Line, … (branches folded in) */
export const corridors = [...new Set(LINES.map((L) => L.l))];
export const lineRecords = (base) => LINES.filter((L) => L.l === base);
export const lineRecord = (base) => lineRecords(base)[0] || null;

/* Historic / colloquial names users still type. Maps to the current name. */
const ALIASES = {
  'huda city centre': 'Millennium City Centre Gurugram',
  'huda city center': 'Millennium City Centre Gurugram',
  'gurgaon city centre': 'Millennium City Centre Gurugram',
  'cp': 'Rajiv Chowk',
  'connaught place': 'Rajiv Chowk',
  'igi airport': 'IGI Airport',
  'airport': 'IGI Airport',
  'terminal 1': 'Terminal 1 IGI Airport',
  'terminal 3': 'IGI Airport',
  't3': 'IGI Airport',
  'new delhi railway station': 'New Delhi',
  'nizamuddin': 'Sarai Kale Khan – Nizamuddin',
  'sarai kale khan': 'Sarai Kale Khan – Nizamuddin',
  'hkas': 'Hauz Khas',
  'aiims': 'AIIMS',
  'palam': 'Terminal 1 IGI Airport',
  'majlis park': 'Majlis Park',
  'red fort': 'Lal Qila',
  'indiagate': 'Central Secretariat',
};
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
for (const [k, v] of Object.entries(ALIASES)) if (POS.has(v)) ALIASES[squash(k)] = v;

export function resolveAlias(q) {
  const k = squash(q);
  return ALIASES[k] && POS.has(ALIASES[k]) ? ALIASES[k] : null;
}

export function searchStations(q, limit = 8) {
  const alias = resolveAlias(q);
  if (alias) return [alias];
  if (!q?.trim()) return [];
  const s = q.toLowerCase().trim();
  const starts = [], contains = [];
  for (const n of stationNames) {
    const l = n.toLowerCase();
    if (l.startsWith(s)) starts.push(n);
    else if (l.includes(s)) contains.push(n);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/* ------------------------------------------------------------------- fares */
/** Deltas the user can toggle; all four combinations are supported. */
export function fareFor(km, { holiday = false, smartcard = false, airport = false, offPeak = false } = {}) {
  const table = airport ? FARES.airportExpress : holiday ? FARES.holiday : FARES.weekday;
  const rows = table || [[2, 11], [5, 21], [12, 32], [21, 43], [32, 54], [null, 64]];
  let base = rows[rows.length - 1][1];
  for (const [upto, amt] of rows) { if (upto === null || km <= upto) { base = amt; break; } }
  let out = base;
  if (smartcard) out = out * (1 - (FARES.smartcardDiscount ?? 0.1));
  if (offPeak) out = out * (1 - (FARES.mjqrtOffPeakDiscount ?? 0.2));
  return Math.max(1, Math.round(out));
}
/** Which slab a distance falls in, so the UI can show the boundary. */
export function fareSlabOf(km, holiday = false, airport = false) {
  const rows = (airport ? FARES.airportExpress : holiday ? FARES.holiday : FARES.weekday) || [];
  let lo = 0;
  for (const [hi, amt] of rows) {
    if (hi === null || km <= hi) return { lo, hi: hi ?? Infinity, fare: amt, nextAt: hi ?? null };
    lo = hi;
  }
  return { lo: 0, hi: Infinity, fare: 64, nextAt: null };
}
export const isOffPeak = (d = new Date()) => {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  if (ist.getDay() === 0) return false;                       // Sunday: flat holiday fare
  const h = ist.getHours();
  return h < 8 || (h >= 12 && h < 17) || h >= 21;
};
/** Sunday + the national holidays DMRC lists. */
export function isHoliday(d = new Date()) {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  const key = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
  if (FIXED_HOLIDAYS.has(key)) return true;
  return ist.getDay() === 0;
}
const FIXED_HOLIDAYS = new Set([           // Republic Day, Independence Day, Gandhi Jayanti
  '2026-01-26', '2026-08-15', '2026-10-02', '2027-01-26', '2025-08-15', '2025-10-02', '2025-12-25',
]);

/* ------------------------------------------------------------------ status */
const pad = (n) => String(n).padStart(2, '0');
export function minutesOfDay(d = new Date()) {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  return ist.getHours() * 60 + ist.getMinutes();
}
export const fmtTime = (m) => {
  if (m == null) return '—';
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(x / 60), mi = x % 60, ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(mi)} ${ap}`;
};
export const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m} min`);

/** "every 3-6 min" / "10 min" when the page published a single figure. */
export const headwayText = (h) => (!h ? null : h[0] === h[1] ? `${h[0]} min` : `${h[0]}-${h[1]} min`);

/** Everything the published timetable says about one corridor. */
export function lineInfo(base, at = minutesOfDay()) {
  const L = lineRecord(base);
  if (!L) return null;
  const tt = L.tt || {};
  const win = tt.win || [360, 1380];
  const pw = tt.pw || [[8, 10], [17, 19]];
  const peak = pw.some(([a, b]) => at >= a * 60 && at < b * 60);
  const head = (peak ? tt.peak : tt.off) || tt.peak || tt.off || null;
  const open = at >= win[0] && at <= win[1];
  return {
    name: base, colour: L.c, km: L.km ?? null, stations: L.s.length, opened: L.opened || null,
    ridersLakh: L.riders_lakh ?? null, about: L.about || null, terminals: L.s.length ? [L.s[0], L.s.at(-1)] : [],
    first: win[0], last: win[1], open, headway: head, peak,
    ends: (L.term || []).map(([t, f, l]) => ({ from: t, first: f, last: l })),
    closedIn: open ? win[1] - at : null, nextOpenIn: open ? null : (win[0] - at + 1440) % 1440,
  };
}

/**
 * The last train that can still carry a passenger through `station`.
 *
 * DMRC publishes last-train times per terminal, not per station, so this is
 * the terminal time moved back by the running time from that terminal to the
 * station — derived arithmetic on published numbers, and the UI labels it as
 * an estimate.  Pass `toward` (the next station in the journey) to get the
 * direction that matters; without it the later of the two ends is used.
 */
export function lastTrainAt(base, station, at = minutesOfDay(), toward = null) {
  const L = lineRecords(base).find((x) => x.s.includes(station)) || lineRecord(base);
  if (!L) return null;
  const idx = L.s.indexOf(station);
  if (idx < 0) return null;
  const win = (L.tt && L.tt.win) || [360, 1380];
  const endsOf = (name) => {
    const hit = (L.term || []).find((t) => t[0] && squash(t[0]).includes(squash(name).slice(0, 7)));
    return hit ? hit[2] : win[1];
  };
  const firstOf = (name) => {
    const hit = (L.term || []).find((t) => t[0] && squash(t[0]).includes(squash(name).slice(0, 7)));
    return hit ? hit[1] : win[0];
  };
  const runMin = (from, to) => {                     // stations `from` -> `to` on this line
    const a = L.s.indexOf(from), b = L.s.indexOf(to);
    if (a < 0 || b < 0) return 0;
    let km = 0;
    for (let i = Math.min(a, b); i < Math.max(a, b); i++) {
      const pa = POS.get(L.s[i]), pb = POS.get(L.s[i + 1]);
      if (pa && pb) km += haversine(pa, pb);
    }
    return Math.round((km / 33) * 60);               // 33 km/h average incl. stops
  };
  const fwd = toward ? L.s.indexOf(toward) > idx : true;
  const options = [];
  // trains that start at the far end and reach `station` after `run` minutes
  for (const dir of (toward ? [fwd ? 1 : -1] : [1, -1])) {
    const origin = dir > 0 ? L.s[0] : L.s.at(-1);
    const run = runMin(origin, station);
    options.push({ at: endsOf(origin) - run, from: origin, firstAt: firstOf(origin), run,
                   toward: toward || (dir > 0 ? L.s.at(-1) : L.s[0]) });
  }
  const best = options.reduce((a, b) => (a && a.at >= b.at ? a : b), null);
  if (!best) return null;
  return { ...best, est: true, left: best.at - at, gone: best.at - at < 0 };
}

/** Whether a corridor is running right now, with the headway that applies. */
export function lineStatus(base, at = minutesOfDay()) {
  const info = lineInfo(base, at);
  return info;
}

/** Every line that passes through a station, with its status right now. */
export function stationStatus(station, at = minutesOfDay()) {
  const s = POS.get(station);
  if (!s) return null;
  return (s.l || []).map((base) => {
    const info = lineInfo(base, at);
    if (!info) return null;
    return { ...info, lastFromHere: lastTrainAt(base, station, at) };
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ search */
/** Dijkstra where each interchange costs `changePenalty` extra minutes. */
function dijkstra(src, dst, { changePenalty = 7, banEdges = new Set() } = {}) {
  const MIN_PER_KM = 1 / 0.55;           // ~33 km/h average incl. dwell time
  const best = new Map();                // "station|line" -> cost
  const pq = [{ cost: 0, at: src, line: null, path: [{ n: src, line: null }] }];

  while (pq.length) {
    pq.sort((a, b) => a.cost - b.cost);
    const cur = pq.shift();
    const key = cur.at + '|' + cur.line;
    if (best.has(key) && best.get(key) <= cur.cost) continue;
    best.set(key, cur.cost);
    if (cur.at === dst) return cur;

    for (const e of ADJ.get(cur.at) || []) {
      const edgeId = [cur.at, e.to, e.line].sort().join('~');
      if (banEdges.has(edgeId)) continue;
      const change = cur.line !== null && e.line !== cur.line;
      const pen = e.walk ? Math.max(changePenalty, 6) : (change ? changePenalty : 0);
      const cost = cur.cost + e.km * MIN_PER_KM + pen;
      pq.push({
        cost, at: e.to, line: e.line,
        path: [...cur.path, { n: e.to, line: e.line, colour: e.colour, km: e.km, walk: !!e.walk }],
      });
    }
    if (pq.length > 9000) pq.length = 6000;   // safety valve
  }
  return null;
}

function summarise(res) {
  const path = res.path;
  const legs = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    const last = legs[legs.length - 1];
    if (last && last.line === p.line && !p.walk) {
      last.stops.push(p.n); last.km += p.km;
    } else {
      legs.push({ line: p.line, colour: p.colour, from: path[i - 1].n, stops: [p.n],
                  km: p.km, walk: !!p.walk });
    }
  }
  const km = legs.reduce((s, l) => s + l.km, 0);
  const hops = path.length - 1;
  const walkMin = legs.filter((l) => l.walk).reduce((s, l) => s + Math.round(l.km * 12), 0);
  return {
    from: path[0].n,
    to: path[path.length - 1].n,
    stations: hops,
    changes: Math.max(0, legs.length - 1),
    km: +km.toFixed(2),
    minutes: Math.round(km / 0.55 + (legs.length - 1) * 7 + walkMin + 2),
    legs: legs.map((l) => ({ ...l, km: +l.km.toFixed(2), count: l.stops.length,
      to: l.stops[l.stops.length - 1], note: l.walk ? `Foot transfer of ${(l.km * 1000).toFixed(0)} m` : null })),
    interchanges: legs.slice(1).filter((l) => l.line !== 'Foot transfer').map((l) => l.from),
    walkM: legs.filter((l) => l.walk).reduce((s, l) => s + Math.round(l.km * 1000), 0),
    path: path.map((p) => p.n),
  };
}

/**
 * Return up to `k` genuinely different routes, sorted best-first, each with a
 * fare, the headway that applies right now and a last-train check.
 */
export function planRoutes(from, to, opts = {}) {
  if (!POS.has(from) || !POS.has(to)) throw new Error('Unknown station');
  if (from === to) throw new Error('Origin and destination are the same');

  const found = [];
  const seen = new Set();
  const variants = [{ changePenalty: 7 }, { changePenalty: 25 }, { changePenalty: 2 }];
  for (const v of variants) {
    const r = dijkstra(from, to, v);
    if (!r) continue;
    const s = summarise(r);
    const sig = s.path.join('>');
    if (!seen.has(sig)) { seen.add(sig); found.push(s); }
  }
  if (found.length && found.length < (opts.k || 4)) {
    const base = found[0].path;
    for (let i = 0; i < base.length - 1 && found.length < (opts.k || 4); i++) {
      const ban = new Set([[base[i], base[i + 1]].concat('').sort().join('~')]);
      for (const e of ADJ.get(base[i]) || []) {
        if (e.to === base[i + 1]) ban.add([base[i], e.to, e.line].sort().join('~'));
      }
      const r = dijkstra(from, to, { changePenalty: 7, banEdges: ban });
      if (!r) continue;
      const s = summarise(r);
      const sig = s.path.join('>');
      if (!seen.has(sig)) { seen.add(sig); found.push(s); }
    }
  }

  const now = opts.at instanceof Date ? minutesOfDay(opts.at) : minutesOfDay();
  const at = opts.atMin ?? now;
  const holiday = opts.holiday ?? isHoliday();
  for (const f of found) {
    const rides = f.legs.filter((l) => l.line !== 'Foot transfer');
    const airport = rides.some((l) => /airport express/i.test(l.line));
    const other = rides.filter((l) => (NET.get(l.line) || 'DMRC') !== 'DMRC');
    const dmrcKm = rides.filter((l) => !other.includes(l)).reduce((s, l) => s + l.km, 0) || f.km;
    const common = { ...opts, holiday, airport };
    f.fare = fareFor(dmrcKm, common);
    f.fareSmart = fareFor(dmrcKm, { ...common, smartcard: true });
    f.fareOffPeak = fareFor(dmrcKm, { ...common, smartcard: true, offPeak: true });
    f.slab = fareSlabOf(dmrcKm, holiday, airport);
    f.kmDmrc = +dmrcKm.toFixed(2);
    if (other.length) {
      f.separateTicket = [...new Set(other.map((l) => l.line))];
      f.fareNote = `${f.separateTicket.join(' + ')} run${f.separateTicket.length > 1 ? '' : 's'} their own ticketing — `
        + `the DMRC slab shown covers the ${(dmrcKm).toFixed(1)} km on DMRC lines only.`;
    }
    f.wait = rides.map((l) => {
      const info = lineInfo(l.line, at);
      const h = info?.headway;
      return h ? { line: l.line, lo: h[0], hi: h[1], peak: info.peak, mid: Math.round((h[0] + h[1]) / 2) } : null;
    }).filter(Boolean);
    f.nextIn = f.wait.length ? Math.max(2, f.wait[0].mid) : 5;
    f.arriveMin = at + f.minutes;
    const ride0 = rides[0];
    const boardAt = ride0 ? (ride0.walk ? ride0.stops[0] : from) : from;
    const lt = ride0 && lastTrainAt(ride0.line, boardAt, at, ride0.stops[0]);
    if (lt) { f.lastTrain = lt.at; f.lastTrainFrom = lt.from; f.lastTrainEst = true;
              f.lastTrainAt = boardAt; f.lastTrainToward = lt.toward; f.lastRunMin = lt.run;
              f.canMakeIt = lt.at >= at; f.lastTrainLeftIn = lt.at - at; }
    else { f.canMakeIt = true; }
    const endLt = lineInfo(rides.at(-1)?.line, at);
    f.lineOpen = (lineInfo(ride0?.line, at)?.open ?? true) && (endLt?.open ?? true);
    f.minutesWithWait = f.minutes + f.nextIn;
  }
  found.sort((a, b) => a.minutesWithWait - b.minutesWithWait || a.changes - b.changes);
  return found.slice(0, opts.k || 4);
}

/** Nearest metro stations to a coordinate — used for "from my location". */
export function nearestStations(lat, lon, n = 5) {
  return STATIONS
    .map((s) => ({ ...s, km: haversine({ lat, lon }, s) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Interchange partners of a station: which lines meet here. */
export const linesAt = (station) => POS.get(station)?.l ?? [];
/** Bus stops published as being within a walk of this station. */
export const busStopsNear = (station) => POS.get(station)?.b ?? [];
