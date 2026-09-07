/**
 * alerts.js — the browser plumbing for "get me off at …".
 *
 * Three capabilities, each with a real fallback and an honest reason when it is
 * missing, because a get-off alert that silently does nothing is worse than one
 * that admits it cannot run:
 *
 *   position   navigator.geolocation.watchPosition with high accuracy.
 *              Denied or unsupported => the caller keeps the trip alive on the
 *              published timetable against the device clock (see trip.js).
 *   notification  serviceWorker registration .showNotification() first (the
 *              only path that survives a hidden tab on Android), then the
 *              Notification constructor, then nothing but the in-app banner.
 *              Each path is reported back as `via` so the UI can name it.
 *   wake lock  navigator.wakeLock, requested while a trip is armed and
 *              re-acquired when the tab becomes visible. Browsers release it on
 *              their own; we never pretend it is guaranteed.
 *
 * Nothing here throws, and nothing here knows anything about routes.
 */

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
/* Vite injects import.meta.env; the Node verify scripts do not have it, and this
   module is imported by both, so read it defensively. */
const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
export const ICON = BASE + 'icon.svg';

/* ----------------------------------------------------------------- notifs */
export function notifSupported() {
  return isBrowser && 'Notification' in window;
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export function notifPermission() {
  if (!notifSupported()) return 'unsupported';
  return Notification.permission || 'prompt';
}

/** Call from a click handler — Chrome requires a gesture on some platforms. */
/**
 * Ask once, and never block a caller on it: a prompt that is auto-ignored
 * (headless, or a user who walks away) resolves to nothing at all, and a
 * get-off alert must already be on screen by then.  4 s, then we move on with
 * the in-app bar and pick the answer up next time the panel reads permission.
 */
export async function askNotifications({ ms = 4000 } = {}) {
  if (!notifSupported()) return { ok: false, via: 'unsupported', why: 'This browser has no Notification API.' };
  try {
    if (Notification.permission === 'granted') return { ok: true, via: 'granted' };
    if (Notification.permission === 'denied') {
      return { ok: false, via: 'denied', why: 'Notifications are blocked in this browser\'s settings.' };
    }
    const raced = await Promise.race([
      Notification.requestPermission().then((r) => ({ via: r, timedOut: false })),
      new Promise((res) => setTimeout(() => res({ via: 'timeout', timedOut: true }), ms)),
    ]);
    if (raced.timedOut) {
      return { ok: false, via: 'timeout',
               why: 'No answer on the notification prompt, so alerts stay in the on-screen bar.' };
    }
    const ok = raced.via === 'granted';
    return { ok, via: raced.via, why: ok ? null : `Permission ${raced.via}.` };
  } catch (e) {
    return { ok: false, via: 'error', why: e.message };
  }
}

async function swRegistration() {
  try {
    if (!isBrowser || !('serviceWorker' in navigator)) return null;
    return await navigator.serviceWorker.getRegistration();
  } catch { return null; }
}

/**
 * Show one notification.  Returns how it was delivered so the caller can say so:
 *   'sw' | 'constructor' | 'none'
 */
export async function pushNotification({ title, body = '', tag, url }) {
  if (!isBrowser || !notifSupported() || notifPermission() !== 'granted') return 'none';
  const opt = { body, tag, icon: ICON, badge: ICON, data: { url: url || '.' }, vibrate: [180, 90, 180] };
  const reg = await swRegistration();
  if (reg && reg.showNotification) {
    try { await reg.showNotification(title, opt); return 'sw'; } catch { /* fall through */ }
  }
  try { new Notification(title, opt); return 'constructor'; } catch { return 'none'; }
}

export async function clearNotifications(tag) {
  try {
    const reg = await swRegistration();
    const list = reg && reg.getNotifications ? await reg.getNotifications({ tag }) : [];
    list.forEach((n) => { try { n.close(); } catch {} });
  } catch {}
}

/* ------------------------------------------------------------------ fixes */
/**
 * watchPosition that never throws.  `stop` is always returned, even when the
 * capability is missing (call it anyway).  `onError` gets a short reason.
 */
export function watchFix({ onFix, onError, highAccuracy = true } = {}) {
  if (!isBrowser || !navigator.geolocation) {
    const why = 'This browser cannot share a location.';
    if (onError) onError(why);
    return () => {};
  }
  let id = null;
  try {
    id = navigator.geolocation.watchPosition(
      (p) => {
        if (!onFix) return;
        const c = p.coords;
        onFix({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy == null ? null : Math.round(c.accuracy),
                speed: c.speed == null ? null : c.speed, at: p.timestamp || Date.now() });
      },
      (e) => { if (onError) onError(e && e.code === 1 ? 'Location permission denied.' : (e && e.message) || 'No position fix.'); },
      { enableHighAccuracy: highAccuracy, maximumAge: 1500, timeout: 20000 });
  } catch (e) {
    if (onError) onError(e.message || 'watchPosition failed.');
  }
  return () => { try { if (id != null) navigator.geolocation.clearWatch(id); } catch {} };
}

/** One-shot fix, for "am I even near a stop" checks before arming a trip. */
export function onceFix({ ms = 9000 } = {}) {
  return new Promise((resolve) => {
    if (!isBrowser || !navigator.geolocation) return resolve({ ok: false, why: 'No geolocation in this browser.' });
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish({ ok: false, why: 'No fix within 9 s.' }), ms + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(t); finish({ ok: true, lat: p.coords.latitude, lon: p.coords.longitude,
                                            accuracy: p.coords.accuracy == null ? null : Math.round(p.coords.accuracy) }); },
        (e) => { clearTimeout(t); finish({ ok: false, why: e && e.code === 1 ? 'Location permission denied.' : 'No position fix.' }); },
        { enableHighAccuracy: true, timeout: ms, maximumAge: 0 });
    } catch (e) { clearTimeout(t); finish({ ok: false, why: e.message }); }
  });
}

/* ------------------------------------------------------------------ haptics */
export function vibrate(pattern = [120, 60, 120]) {
  try { if (isBrowser && navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

/* ---------------------------------------------------------------- wake lock */
let wakeLock = null;
/** Ask the screen to stay on while a trip is armed. Safe to call repeatedly. */
export async function keepAwake(on) {
  if (!isBrowser) return { ok: false, why: 'no window' };
  if (on) {
    if (!('wakeLock' in navigator)) return { ok: false, why: 'This browser cannot keep the screen awake.' };
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return { ok: true };
    } catch (e) { return { ok: false, why: e.message }; }
  }
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  return { ok: true, released: true };
}

/** Re-acquire the lock when the tab comes back; wake locks are dropped on hide. */
export function onVisible(cb) {
  if (!isBrowser) return () => {};
  const h = () => { if (document.visibilityState === 'visible') cb(); };
  document.addEventListener('visibilitychange', h);
  window.addEventListener('focus', h);
  return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('focus', h); };
}

export function isOnline() {
  return isBrowser ? navigator.onLine !== false : true;
}
