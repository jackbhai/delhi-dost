/**
 * Indian Railways data.
 *
 * SOURCES (all CORS-verified from a github.io Origin):
 *                                          position, run days, avg/max speed
 *                                          location, next halt, delay minutes,
 *                                          per-station actual vs scheduled
 *
 * REJECTED AFTER TESTING (documented so nobody re-adds them):
 *                       number (asking for 12013 returned Karjat/Neral, a
 *                       Mumbai local). Unusable, would have shown fake data.
 *   indianrailapi     — "Authentication Required"
 *   railyatri / trainman / confirmtkt — 404 / dead / no CORS
 *   NTES              — no public JSON
 */
import { jget } from './engine';

const RR = 'https://railradar.in/api/v1';

/* ------------------------------------------------------------- schedule */
export const trainInfo = [
  {
    id: 'live1', label: 'Live',
    async run({ no }) {
      const d = await jget(`${RR}/trains/${encodeURIComponent(no)}`, { ms: 20000 });
      if (!d?.success || !d?.data?.train) throw new Error('Train not found');
      const t = d.data.train;
      return {
        no: t.number, name: t.name, type: t.type, category: t.category,
        from: t.source, to: t.destination, runDays: t.runDays || [],
        km: t.distance, mins: t.duration, avgSpeed: t.avgSpeed, maxSpeed: t.maxSpeed,
        halts: t.totalHalts, returnTrain: t.returnTrain, coaches: t.coachPosition,
        // NOTE: the schedule endpoint nests {station:{code,name}} and uses
        // plain arrival/departure ("16:30"); the live endpoint flattens them.
        route: (d.data.route || []).map((r) => ({
          seq: r.sequence,
          code: r.station?.code ?? r.stationCode,
          name: r.station?.name ?? r.stationName,
          lat: r.station?.lat, lon: r.station?.lng,
          halt: r.isHalt,
          arr: r.arrival ?? r.scheduledArrival,
          dep: r.departure ?? r.scheduledDeparture,
          day: r.departureDay ?? r.arrivalDay,
          platform: r.platform, km: r.distance, speed: r.speedToNextStationKmph,
        })),
      };
    },
  },
];

/* ------------------------------------------------------------- live status */
export const trainLive = [
  {
    id: 'live2', label: 'Live status',
    async run({ no }) {
      const d = await jget(`${RR}/trains/${encodeURIComponent(no)}/live`, { ms: 22000 });
      if (!d?.success || !d?.data) throw new Error('No live data for this train');
      const L = d.data;
      return {
        no: L.trainNumber, name: L.trainName, startDate: L.startDate,
        updated: L.lastUpdatedAt, status: L.status, isLive: L.isLive,
        mode: L.trackingMode, delay: L.delayMinutes,
        current: L.currentLocation, next: L.nextHalt,
        route: (L.route || []).map((r) => ({
          seq: r.sequence, code: r.stationCode, name: r.stationName,
          halt: r.isHalt, status: r.status, platform: r.platform, km: r.distance,
          schArr: r.scheduledArrival, schDep: r.scheduledDeparture,
          actArr: r.actualArrival, actDep: r.actualDeparture,
          delay: r.delayMinutes ?? r.arrivalDelay ?? null,
        })),
      };
    },
  },
];

/* ------------------------------------------------------------- between stations */
export const trainsBetween = [
  {
    id: 'between', label: 'Between stations',
    async run({ from, to }) {
      const txt = await jget(
        `https://erail.in/rail/getTrains.aspx?Station_From=${from}&Station_To=${to}` +
        `&DataSource=0&Language=0&Cache=true`, { text: true, ms: 22000 });
      const rows = txt.split('^').slice(1).filter(Boolean);
      const out = [];
      for (const r of rows) {
        const f = r.split('~').filter((x) => x !== '');
        if (f.length < 14) continue;
        out.push({
          no: f[0], name: f[1], fromName: f[2], from: f[3], toName: f[4], to: f[5],
          dep: f[10], arr: f[11], dur: f[12], days: f[13],
        });
      }
      if (!out.length) throw new Error('No direct trains on this route');
      return out;
    },
  },
];

/**
 * nodes carrying an IR `ref` code (see scripts/build_stations.mjs).
 * Replaces a hardcoded 60-station list that could not cover the country.
 * NOTE: Mumbai CST is CSMT here - that has been its official code since 2017.
 */
import STN from '../data/stations-india.json';

export const ALL_STATIONS = STN.stations;
export const STATIONS_BUILT = STN.built;
const BY_CODE = new Map(ALL_STATIONS.map((s) => [s.c, s]));
export const stationByCode = (c) => BY_CODE.get(String(c || '').toUpperCase());

/** Popular stations shown before the user types anything. */
const POPULAR = ['NDLS','DLI','NZM','ANVT','CSMT','BCT','LTT','HWH','SDAH','MAS','SBC',
  'ASR','LKO','CNB','PNBE','ADI','JP','BPL','NGP','PUNE','SC','BZA','TVC','ERS','GHY','JAT'];
export const POPULAR_STATIONS = POPULAR.map((c) => BY_CODE.get(c)).filter(Boolean);

/** Fuzzy search across 8k stations: code prefix first, then name. */
const MAJOR = /junction|jn\b|central|terminus|terminal|cantt|city\b/i;
const POP_SET = new Set(POPULAR);

/** Bigger stations should outrank tiny suburban halts with the same prefix. */
const weight = (st) => (POP_SET.has(st.c) ? 3 : 0) + (MAJOR.test(st.n) ? 2 : 0)
  + (st.c.length <= 4 ? 1 : 0);

export function searchStations(q, limit = 10) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return POPULAR_STATIONS.slice(0, limit);
  const code = [], starts = [], has = [];
  for (const st of ALL_STATIONS) {
    const c = st.c.toLowerCase(), n = st.n.toLowerCase();
    if (c === s) code.unshift(st);
    else if (c.startsWith(s)) code.push(st);
    else if (n.startsWith(s)) starts.push(st);
    else if (n.includes(s)) has.push(st);
  }
  const rank = (arr) => arr.sort((a, b) => weight(b) - weight(a) || a.n.length - b.n.length);
  return [...code, ...rank(starts), ...rank(has)].slice(0, limit);
}

export const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN',
      { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  } catch { return '—'; }
};

export const delayLabel = (m) => {
  if (m == null) return { text: '—', tone: 'var(--fg3)' };
  if (m <= 0) return { text: 'On time', tone: 'var(--green)' };
  if (m < 15) return { text: `${m} min late`, tone: 'var(--warn)' };
  return { text: `${Math.floor(m / 60)}h ${m % 60}m late`, tone: 'var(--bad)' };
};
