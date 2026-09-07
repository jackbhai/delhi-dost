/**
 * User settings that live only in this browser.
 *
 * The one that matters is the custom proxy. Audio resolution has to pass
 * through a CORS hop, and the free public ones have become unreliable —
 * measured across 25 of them: one permanent 401, four rate-limited, three
 * 403, several timeouts, and a single slow survivor. Pointing the app at a
 * removes that whole class of problem.
 */

const KEY = 'dost:settings';

/**
 * The relay that ships with the app.
 *
 * Audio resolution and the Deezer catalogue both need a CORS hop. The free
 * public relays turned out to be unusable — measured across 25 of them: one
 * permanent 401, four rate-limited, three 403, several timeouts, and a single
 * survivor at 7-19 s. This Worker is deployed for the app: measured 0.06-0.1 s
 * warm versus 6.9 s on the best public relay, with a host allow-list so it
 * cannot be repurposed as an open proxy.
 *
 * A user can still point `proxyUrl` at their own Worker; that takes priority.
 */
export const BUILTIN_PROXY = 'https://omni-proxy.omni-jackbhai.workers.dev';

const DEFAULTS = {
  proxyUrl: '',          // user's own relay; blank means use BUILTIN_PROXY
  useBuiltin: true,      // fall back to the bundled relay
  autoRadio: true,       // keep the queue topped up so playback never ends
  sfx: true,             // travel-panel sounds, synthesised locally (core/sfx.js)
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

const subs = new Set();
export function onSettings(fn) { subs.add(fn); return () => subs.delete(fn); }

export function setSetting(k, v) {
  const s = { ...getSettings(), [k]: v };
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  for (const f of subs) { try { f(s); } catch {} }
  return s;
}

/**
 * The relay to use: the user's own if they set one, otherwise the bundled
 * Worker. Returns '' only if the user has explicitly turned the built-in off
 * and not supplied their own — in which case callers fall back to the public
 * proxy pool.
 */
export function proxyBase() {
  const s = getSettings();
  const own = (s.proxyUrl || '').trim();
  if (own) return own.replace(/\/+$/, '');
  return s.useBuiltin === false ? '' : BUILTIN_PROXY;
}

/** True when the relay in use is the one that ships with the app. */
export const usingBuiltin = () => !(getSettings().proxyUrl || '').trim() &&
  getSettings().useBuiltin !== false;

/** Wrap a target URL for the user's own proxy. */
export const viaOwnProxy = (target) => {
  const b = proxyBase();
  return b ? `${b}/?url=${encodeURIComponent(target)}` : '';
};

/**
 * Check that a pasted Worker URL actually works before we rely on it.
 * Returns { ok, ms, error }.
 */
export async function testProxy(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return { ok: false, error: 'Enter a URL first' };
  const probe = 'https://itunes.apple.com/search?term=test&limit=1';
  const t0 = Date.now();
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 15000);
    const r = await fetch(`${b}/?url=${encodeURIComponent(probe)}`, { signal: c.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, error: `Proxy answered HTTP ${r.status}` };
    const j = await r.json();
    if (typeof j.resultCount !== 'number') return { ok: false, error: 'Unexpected response' };
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out' : e.message };
  }
}
