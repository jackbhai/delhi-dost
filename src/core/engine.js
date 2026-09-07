/**
 * Resilience engine — the reason "koi feature band na ho".
 *
 * Every network capability declares a POOL of independent providers.
 * The engine:
 *   1. Load-spreads across healthy providers (round-robin) so no single free
 *      API absorbs all traffic and hits its quota.
 *   2. Scores provider health; failures demote, successes recover.
 *   3. Circuit-breaks dead providers for a cooldown window.
 *   4. Falls through the pool until something returns usable data.
 *   5. Serves stale cache when everything is down (better than an error).
 *   6. Rotates public CORS proxies for APIs that send no CORS headers.
 *
 * No API keys, no auth, no ToS bypass. Public endpoints only.
 */

const MEM = new Map();
const LS_PREFIX = 'dost:c:';
const BREAKER = new Map();          // providerId -> { until, fails }
const RR = new Map();               // capability -> round-robin cursor
const STATS = new Map();            // providerId -> { ok, fail, ms }

const COOLDOWN_MS = 60_000;
const MAX_FAILS = 2;

/* Public CORS proxies, tried in order, for no-CORS upstreams. */
/* Public relays, tried in order. This app's own Worker goes FIRST: it is the
 * only one of these that is not somebody else's free tier, and measured it is
 * an order of magnitude faster. thingproxy was removed after it stopped
 * resolving in DNS entirely — a dead entry costs a full timeout on every call
 * that reaches it. */
const CORS_PROXIES = [
  (u) => `https://omni-proxy.omni-jackbhai.workers.dev/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

/* ------------------------------------------------------------------ cache */
function lsGet(k) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + k);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
  } catch {
    try {                                   // quota full -> drop oldest
      const keys = Object.keys(localStorage).filter((x) => x.startsWith(LS_PREFIX));
      keys.slice(0, Math.ceil(keys.length / 3)).forEach((x) => localStorage.removeItem(x));
      localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
    } catch { /* give up silently */ }
  }
}

export function cacheRead(key, maxAgeMs) {
  const hit = MEM.get(key) || lsGet(key);
  if (!hit) return null;
  const age = Date.now() - hit.t;
  return { ...hit, age, fresh: age < maxAgeMs };
}
export function cacheWrite(key, data) {
  const rec = { data, t: Date.now() };
  MEM.set(key, rec);
  if (MEM.size > 300) MEM.delete(MEM.keys().next().value);
  lsSet(key, rec);
}

/* ---------------------------------------------------------------- health */
function healthy(id) {
  const b = BREAKER.get(id);
  return !b || Date.now() > b.until;
}
function noteOk(id, ms) {
  BREAKER.delete(id);
  const s = STATS.get(id) || { ok: 0, fail: 0, ms: 0 };
  s.ok++; s.ms = ms; STATS.set(id, s);
}
function noteFail(id, err) {
  const b = BREAKER.get(id) || { fails: 0, until: 0 };
  b.fails++;
  if (b.fails >= MAX_FAILS) { b.until = Date.now() + COOLDOWN_MS; b.fails = 0; }
  BREAKER.set(id, b);
  const s = STATS.get(id) || { ok: 0, fail: 0, ms: 0 };
  s.fail++; s.lastErr = String(err).slice(0, 90); STATS.set(id, s);
}
export const providerStats = () =>
  [...STATS.entries()].map(([id, s]) => ({
    id, ...s,
    rate: s.ok + s.fail ? Math.round((100 * s.ok) / (s.ok + s.fail)) : null,
    open: !healthy(id),
  }));

/* ----------------------------------------------------------------- fetch */
const timeout = (ms) => {
  const c = new AbortController();
  return { signal: c.signal, cancel: setTimeout(() => c.abort(), ms), ctrl: c };
};

export async function jget(url, { ms = 12000, headers, text = false, proxy = false,
                                  forceProxy = false } = {}) {
  const attempt = async (target) => {
    const t = timeout(ms);
    try {
      const r = await fetch(target, { signal: t.signal, headers, mode: 'cors' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return text ? await r.text() : await r.json();
    } finally { clearTimeout(t.cancel); }
  };
  /* An http-only origin can never be reached from an https page — the browser
     blocks it before a request is made, and the failure is silent. Those
     providers set forceProxy so the direct attempt is skipped entirely rather
     than burning a timeout on something that cannot work. */
  const mixed = forceProxy || (location.protocol === 'https:' && url.startsWith('http://'));
  if (!mixed) {
    try {
      return await attempt(url);
    } catch (e) {
      if (!proxy) throw e;
      for (const wrap of CORS_PROXIES) {
        try { return await attempt(wrap(url)); } catch { /* next */ }
      }
      throw e;
    }
  }
  {
    let last = new Error('mixed content: this source is http-only');
    for (const wrap of CORS_PROXIES) {
      try { return await attempt(wrap(url)); } catch (e) { last = e; }
    }
    throw last;
  }
}

/* --------------------------------------------------------------- resolve */
/**
 * @param {string} cap        capability id (used for cache + round-robin)
 * @param {Array}  pool       [{ id, label, run(params) }]
 * @param {object} params
 * @param {object} opts       { ttl, spread }
 */
export async function resolve(cap, pool, params = {}, opts = {}) {
  const { ttl = 10 * 60_000, spread = true } = opts;
  const key = cap + ':' + JSON.stringify(params);

  const cached = cacheRead(key, ttl);
  if (cached?.fresh) {
    return { data: cached.data, provider: 'cache', label: 'Cache', cached: true, attempts: [] };
  }

  const live = pool.filter((p) => healthy(p.id));
  const dead = pool.filter((p) => !healthy(p.id));
  let order = live.length ? live : pool;          // all broken -> try anyway

  if (spread && order.length > 1) {               // rotate the entry point
    const n = (RR.get(cap) || 0) % order.length;
    RR.set(cap, n + 1);
    order = [...order.slice(n), ...order.slice(0, n)];
  }
  order = [...order, ...dead.filter((d) => !order.includes(d))];

  const attempts = [];
  for (const p of order) {
    const t0 = performance.now();
    try {
      const data = await p.run(params);
      const empty = data == null ||
        (Array.isArray(data) && data.length === 0) ||
        (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
      if (empty) throw new Error('empty');
      const ms = Math.round(performance.now() - t0);
      noteOk(p.id, ms);
      attempts.push({ id: p.id, label: p.label, ok: true, ms });
      cacheWrite(key, data);
      return { data, provider: p.id, label: p.label, cached: false, attempts };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      noteFail(p.id, e.message);
      attempts.push({ id: p.id, label: p.label, ok: false, ms, error: e.message });
    }
  }

  if (cached) {                                    // stale beats nothing
    return {
      data: cached.data, provider: 'stale', label: 'Cached (offline)',
      cached: true, stale: true, ageMin: Math.round(cached.age / 60000), attempts,
    };
  }
  throw Object.assign(new Error('All providers unavailable'), { attempts });
}
