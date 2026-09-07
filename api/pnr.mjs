/**
 * PNR status relay with a fallback chain of independent sources.
 *
 * SECURITY MODEL
 * --------------
 * Keys are server-side environment variables only (RAILKIT_API_KEY,
 * RAPIDAPI_KEY / RAPIDAPI_PNR_HOST). They never appear in the web app or in
 * built files. Visitors only call THIS endpoint on the same origin; the
 * function asks each source in turn and returns one canonical JSON payload.
 * There is no CORS hole: the browser never talks to an upstream service.
 *
 * FALLBACK CHAIN (first success wins, in this order)
 *   1. RailKit     — needs RAILKIT_API_KEY        (documented, current)
 *   2. RapidAPI    — needs RAPIDAPI_KEY (+host)   (irctc1-style listing)
 *   3. eRail       — keyless legacy feed          (best-effort; may be down)
 * A source with no key is skipped automatically. No PNR is ever logged or
 * stored beyond a 75 s in-memory cache so repeated refreshes stay cheap.
 *
 * ENDPOINT
 *   GET /api/pnr?pnr=1234567890
 *   -> 200 { ok:true, at, via, data:{ pnr, train, journey, chart,
 *                                     fare, passengers:[{s,b,c}] } }
 *   -> 503 { ok:false, error:'setup' }       no source configured at all
 *   -> 502 { ok:false, error:'upstream' }    every source failed
 *   -> 404 { ok:false, error:'notfound' }    PNR not found upstream
 *   -> 400 { ok:false, error:'invalid' }     bad input
 */

const CACHE_TTL = 75_000;
const cache = new Map();          // pnr -> { at, data, via }
const inflight = new Map();       // pnr -> Promise  (single flight)
const SRV_TIMEOUT = 7_500;

function env(k, dflt) { const v = process.env[k]; return v == null || v === '' ? dflt : v; }
function json(res, code, body, extra = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', env('ALLOW_ORIGIN', '*'));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  return res.end(JSON.stringify(body));
}
const withTimeout = (p, ms = SRV_TIMEOUT) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
]);
const pick = (o, k) => (o == null ? undefined : o[k]);
const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : null; };

/* ============================================================= normalizers */
const cleanStatus = (s) => {
  const t = str(s).toUpperCase();
  return t.replace(/[^A-Z0-9]/g, '') || null;
};
export const statusTone = (st) => {
  const s = cleanStatus(st) || '';
  if (s === 'CNF' || s === 'CONFIRMED' || s === 'CONFIRM') return 'ok';
  if (s.startsWith('RAC') || s === 'RAC') return 'wait';
  if (s === 'CAN' || s.startsWith('CAN') || s === 'CANCELLED') return 'bad';
  if (s.includes('WL') || s.startsWith('PQ') || s.startsWith('RL') || s.startsWith('RE')) return 'muted';
  return 'idle';
};
const berthObj = (src) => ({
  st: cleanStatus(pick(src, 'status')) || null,
  coach: str(pick(src, 'coach')) || null,
  berthNo: num(pick(src, 'berthNo')) ?? num(pick(src, 'berth_no')) ?? null,
  type: str(pick(src, 'berthCode') ?? pick(src, 'berth_type') ?? pick(src, 'berthType')) || null,
  det: str(pick(src, 'details')) || null,
});
const station = (s, codeKey = 'code', nameKey = 'name') => ({
  code: str(pick(s, codeKey)) || null,
  name: str(pick(s, nameKey)) || null,
});

export function fromRailKit(r) {
  const d = r && r.data ? r.data : r;
  if (!d || !d.pnr) throw new Error('bad payload');
  const train = d.train || {};
  const j = d.journey || {};
  const ch = str((d.chart || {}).status).toLowerCase();
  const fare = num((d.booking || {}).fare) ?? num(pick(d.booking, 'ticketFare'));
  const passengers = Array.isArray(d.passengers)
    ? d.passengers.map((p, i) => ({
        s: num(p.serialNumber) ?? num(p.serial_number) ?? i + 1,
        b: berthObj(p.booking || {}),
        c: berthObj(p.current || {}),
      })) : [];
  return {
    train: { no: str(train.number), name: str(train.name) },
    journey: {
      doj: str(j.dateOfJourney), cls: str(j.class), quota: str(j.quota),
      distKm: num(j.distance), from: station(j.source), to: station(j.destination),
      boarding: station(j.boardingPoint), arrive: str(j.arrivalDate),
    },
    chart: ch.includes('not') ? 'not' : ch.includes('cancel') ? 'cancelled' : ch.includes('prep') ? 'prepared' : 'unknown',
    fare,
    bookingAt: str((d.booking || {}).bookingDate),
    passengers,
  };
}

export function fromRapid(r) {
  const d = r && r.data ? r.data : r;
  if (!d) throw new Error('bad payload');
  const chartRaw = str(d.chart_prepared ?? d.chartPrepared ?? '').toLowerCase();
  const getSt = (o) => (o && typeof o === 'object'
    ? { code: str(o.station_code ?? o.code), name: str(o.station_name ?? o.name) }
    : { code: str(o), name: '' });
  const passengers = Array.isArray(d.passengers) ? d.passengers.map((p, i) => ({
    s: num(p.passenger_serial_number ?? p.serial) ?? i + 1,
    b: {
      st: cleanStatus(p.booking_status ?? p.bookingStatus), coach: str(p.booking_coach_id ?? p.bookingCoach),
      berthNo: num(p.booking_berth_no) ?? num(p.bookingBerthNo),
      type: str(p.booking_berth_code ?? p.bookingBerthType) || null,
      det: str(p.booking_status) || null,
    },
    c: {
      st: cleanStatus(p.current_status ?? p.currentStatus), coach: str(p.current_coach_id ?? p.currentCoach),
      berthNo: num(p.current_berth_no) ?? num(p.currentBerthNo),
      type: str(p.current_berth_code ?? p.currentBerthType) || null,
      det: str(p.current_status) || null,
    },
  })) : [];
  return {
    train: { no: str(d.train_number ?? d.trainNumber), name: str(d.train_name ?? d.trainName) },
    journey: {
      doj: str(d.doj ?? d.dateOfJourney), cls: str(d.class ?? d.journeyClass), quota: str(d.quota),
      distKm: num(d.distance) ?? num(d.total_distance),
      from: getSt(d.from_station ?? d.from), to: getSt(d.to_station ?? d.to),
      boarding: getSt(d.boarding_point ?? d.boardingPoint), arrive: str(d.arrival_date ?? d.arrivalDate),
    },
    chart: chartRaw.includes('y') || chartRaw === 'prepared' || chartRaw === '1' ? 'prepared'
      : chartRaw.includes('cancel') ? 'cancelled' : chartRaw.includes('n') ? 'not' : 'unknown',
    fare: num(d.total_fare ?? d.fare) ?? null,
    bookingAt: str(d.booking_date ?? d.bookingDate),
    passengers,
  };
}

function fromERail(txt) {
  const d = JSON.parse(txt); // throws when the feed served HTML
  if (!d || !d.TrainNumber) throw new Error('bad payload');
  const ps = Array.isArray(d.ReservationStatus) ? d.ReservationStatus : [];
  const passengers = ps.map((p, i) => ({
    s: i + 1,
    b: {
      st: cleanStatus(p.BookingStatus), coach: str(p.BookingCoach),
      berthNo: num(p.BookingBerthNo), type: str(p.BookingBerthCode),
      det: str(p.BookingStatus), 
    },
    c: {
      st: cleanStatus(p.CurrentStatus), coach: str(p.CurrentCoach),
      berthNo: num(p.CurrentBerthNo), type: str(p.CurrentBerthCode),
      det: str(p.CurrentStatus),
    },
  }));
  return {
    train: { no: str(d.TrainNumber), name: str(d.TrainName) },
    journey: {
      doj: str(d.DateOfJourney), cls: str(d.Class), quota: str(d.Quota),
      distKm: num(d.Distance),
      from: { code: str(d.FromStationCode), name: str(d.FromStationName) },
      to: { code: str(d.ToStationCode), name: str(d.ToStationName) },
      boarding: { code: str(d.BoardingPointCode), name: str(d.BoardingPointName) },
      arrive: str(d.ArrivalDate),
    },
    chart: str(d.ChartPrepared).toLowerCase().includes('y') || str(d.ChartPrepared) === '1' ? 'prepared'
      : str(d.ChartPrepared).toLowerCase().includes('cancel') ? 'cancelled' : 'not',
    fare: num(d.BookingFare) ?? num(d.TotalFare),
    bookingAt: str(d.BookingDate),
    passengers,
  };
}

/* ====================================================== source adapters */
async function viaRailKit(pnr) {
  if (!env('RAILKIT_API_KEY')) return null;
  const rk = await import('railkit');
  try { rk.configure(env('RAILKIT_API_KEY')); } catch { /* already set */ }
  const r = await rk.checkPNRStatus(pnr);
  return fromRailKit(r);
}
async function viaRapid(pnr) {
  const key = env('RAPIDAPI_KEY');
  if (!key) return null;
  const host = env('RAPIDAPI_PNR_HOST', 'irctc1.p.rapidapi.com');
  const u = `https://${host}/api/v1/getPNRStatus?pnrNumber=${encodeURIComponent(pnr)}`;
  const res = await fetch(u, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const body = await res.json();
  if (body && body.response_code === 221) { const e = new Error('notfound'); e.notFound = true; throw e; }
  return fromRapid(body);
}
async function viaERail(pnr) {
  if (env('PNR_DISABLE_ERALL') === '1') return null;
  const res = await fetch(`https://erail.in/rail/getPnrStatus.aspx?PnrNo=${encodeURIComponent(pnr)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DelhiDost/1.0)', Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  const txt = await res.text();
  if (!txt.trim().startsWith('{') || ct.includes('html')) throw new Error('bad payload');
  return fromERail(txt);
}

const SOURCES = [
  { id: 'railkit', label: 'railkit', run: (p) => withTimeout(viaRailKit(p)) },
  { id: 'rapidapi', label: 'rapidapi', run: (p) => withTimeout(viaRapid(p)) },
  { id: 'erail', label: 'erail', run: (p) => withTimeout(viaERail(p)) },
];

export function enabledSources() {
  return SOURCES.filter((s) => s.id === 'erail'
    ? env('PNR_DISABLE_ERALL') !== '1'
    : !!env(s.id === 'railkit' ? 'RAILKIT_API_KEY' : 'RAPIDAPI_KEY'));
}

export async function resolvePnr(pnr, opts = {}) {
  const now = opts.now ?? Date.now();
  const list = opts.sources ?? enabledSources();
  const hit = cache.get(pnr);
  if (hit && now - hit.at < CACHE_TTL) return { data: hit.data, via: hit.via, cached: true };
  if (inflight.has(pnr)) return inflight.get(pnr);

  const attempt = (async () => {
    if (list.length === 0) {
      const e = new Error('setup'); e.setup = true; throw e;
    }
    let lastErr = null;
    for (const s of list) {
      try {
        const data = await s.run(pnr);
        if (!data) continue;
        const out = { data, via: s.label };
        cache.set(pnr, { at: Date.now(), data, via: s.label });
        return out;
      } catch (e) {
        lastErr = e;
        if (e && e.notFound) { const f = new Error('notfound'); f.notFound = true; throw f; }
        if (e && e.setup) { const f = new Error('setup'); f.setup = true; throw f; }
      }
    }
    const f = new Error(lastErr ? 'upstream' : 'upstream');
    if (lastErr && lastErr.notFound) { f.notFound = true; }
    throw f;
  })();
  inflight.set(pnr, attempt);
  try { return await attempt; }
  finally { inflight.delete(pnr); }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, '');
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method' });
  const pnr = str((req.url || '').split('?')[1] ? new URL(req.url, 'http://x').searchParams.get('pnr') : '');
  if (!/^\d{10}$/.test(pnr)) return json(res, 400, { ok: false, error: 'invalid' });
  try {
    const { data, via, cached } = await resolvePnr(pnr);
    return json(res, 200, { ok: true, at: new Date().toISOString(), via, cached: !!cached, data });
  } catch (e) {
    if (e && e.setup) return json(res, 503, { ok: false, error: 'setup' });
    if (e && e.notFound) return json(res, 404, { ok: false, error: 'notfound' });
    return json(res, 502, { ok: false, error: 'upstream' });
  }
}
