/**
 * trip-state.js — one armed trip, shared by every travel screen.
 *
 * A tiny external store (module state + subscribers) rather than a context, so
 * the bus tab, the metro tab, the combined planner and the floating bar all read
 * the same trip without any of them owning it.  React attaches through
 * useSyncExternalStore in src/tools/trip-ui.jsx.
 *
 * Responsibilities, and nothing else:
 *   hold the track + the alert log, tick it on a timer and on every GPS fix,
 *   hand alerts to alerts.js for notification / vibration, keep the last
 *   handful of alerts for the UI, persist an armed trip across a reload
 *   (localStorage), and re-arm the watch on resume.
 *
 * Honesty rules baked in here:
 *   - `via` says which channel delivered the alert ('sw' | 'page' | 'inapp'),
 *     because "you got a notification" is a claim we can only make when true;
 *   - `clockBased` from trip.js is surfaced as `timing` and the UI must print it;
 *   - a trip older than its own duration + 45 min is dropped, not resuscitated.
 */
import { judge } from './trip.js';
import { watchFix, pushNotification, vibrate, keepAwake, onVisible, notifPermission } from './alerts.js';
import { play as sound } from './sfx.js';

const KEY = 'dost:trip-v1';
const TICK_MS = 4000;
const STALE_MIN = 45;

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

let state = {
  armed: false, trip: null, fix: null, fixError: null, watching: false,
  j: null, log: [], via: 'inapp', perm: notifPermission(), wake: false, startedAt: null,
};
const subs = new Set();
let timer = null, stopWatch = null, fired = new Set(), visibilityOff = null;

function emit() { for (const fn of subs) { try { fn(state); } catch {} } }
function snapshot() { return state; }
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export const getTripState = () => snapshot();

const nowMin = () => {
  const d = new Date();
  // device clock in IST minutes-midnight, matching minutesOfDay() in the cores
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  return ist.getHours() * 60 + ist.getMinutes() + ist.getSeconds() / 60;
};

function save() {
  if (!isBrowser) return;
  try {
    if (state.armed && state.trip) {
      localStorage.setItem(KEY, JSON.stringify({
        trip: { ...state.trip, points: state.trip.points.slice(0, 400) },
        startedAt: state.startedAt, fired: [...fired].slice(-120),
      }));
    } else localStorage.removeItem(KEY);
  } catch {}
}

export function pushAlert(a) {
  if (!a) return;
  state = { ...state, log: [{ ...a, at: Date.now() }, ...state.log].slice(0, 10) };
}

/** Run the state machine once (called by the timer and by every GPS fix). */
export function tick() {
  if (!state.armed || !state.trip) return state;
  const j = judge(state.trip, state.fix, nowMin(), fired);
  if (j.alert) {
    const urgent = /get off|arrived|missed|passed/i.test(j.alert.title);
    pushAlert({ ...j.alert, urgent });
    vibrate(urgent ? [220, 80, 220, 80, 320] : [120, 60, 120]);
    // a phone in a pocket shows nothing but it does make a noise: the urgent
    // bells are the alert for people who are not looking at the screen
    sound(urgent ? 'alight' : 'ding');
    pushNotification({ title: j.alert.title, body: j.alert.body, tag: 'dost-trip' })
      .then((via) => { state = { ...state, via: via === 'none' ? 'inapp' : via }; emit(); });
  }
  state = { ...state, j, timing: j.timing, clockBased: !!j.clockBased, trust: !!j.trusting };
  if (j.state === 'done') finish('Arrived');
  save();
  emit();
  return state;
}

function startTicker() {
  stopTicker();
  timer = setInterval(tick, TICK_MS);
}
function stopTicker() { if (timer) clearInterval(timer); timer = null; }

function startWatch() {
  if (!isBrowser) return;
  if (stopWatch) return;
  stopWatch = watchFix({
    onFix: (f) => { state = { ...state, fix: f, fixError: null }; tick(); },
    onError: (why) => { state = { ...state, fixError: why, watching: false }; emit(); },
  });
  state = { ...state, watching: true };
}
function stopWatchOnly() { if (stopWatch) stopWatch(); stopWatch = null; }

/**
 * Arm a trip.  `trip` is a track from trip.js (trackOfBus / trackOfMetro /
 * trackOfCombo / trackOfRoute).  Returns {ok, why} so the caller can explain a
 * refusal instead of showing a dead button.
 */
export function armTrip(trip, { alightName = null, boardMin = null, source = '' } = {}) {
  if (!isBrowser) return { ok: false, why: 'no window' };
  if (!trip || !trip.points?.length) return { ok: false, why: 'This journey has no stops with coordinates to watch.' };
  fired = new Set();
  const t = boardMin != null ? { ...trip, boardMin } : trip;
  state = {
    ...state, armed: true, trip: t, alightName, source, startedAt: Date.now(),
    j: null, log: [], fix: state.fix, fixError: null, perm: notifPermission(), via: 'inapp',
  };
  startTicker();
  startWatch();
  visibilityOff = onVisible(() => { keepAwake(true); tick(); });
  keepAwake(true).then((r) => { state = { ...state, wake: !!r.ok, wakeWhy: r.ok ? null : r.why }; emit(); });
  save();
  tick();
  return { ok: true, points: t.points.length };
}

function finish(how) {
  stopTicker();
  stopWatchOnly();
  if (visibilityOff) visibilityOff();
  visibilityOff = null;
  keepAwake(false);
  state = { ...state, armed: false, watch: false, ended: how };
  try { localStorage.removeItem(KEY); } catch {}
  emit();
}

export function stopTrip() { finish('Stopped'); }
export function clearTrip() { fired = new Set(); state = { ...state, armed: false, trip: null, j: null, log: [] }; save(); emit(); }

/** Read a stored trip back after a reload.  Returns true when one was resumed. */
export function resumeTrip() {
  if (!isBrowser) return false;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (!raw?.trip?.points?.length) return false;
  const mins = (Date.now() - (raw.startedAt || 0)) / 60000;
  const budget = (raw.trip.totalMin || 60) + STALE_MIN;
  if (mins > budget) { try { localStorage.removeItem(KEY); } catch {} return false; }
  fired = new Set(raw.fired || []);
  state = { ...state, armed: true, trip: raw.trip, startedAt: raw.startedAt, log: [], j: null };
  startTicker();
  startWatch();
  visibilityOff = onVisible(() => { keepAwake(true); tick(); });
  tick();
  return true;
}

/** Ask for notification permission from a click; reports the outcome honestly. */
export async function enableNotifications() {
  const { askNotifications } = await import('./alerts.js');
  const r = await askNotifications();
  state = { ...state, perm: r.ok ? 'granted' : r.via };
  emit();
  return r;
}

/** Distance from the user to the boarding stop, for the pre-arm sanity check. */
export function gateCheck(trip, fix) {
  if (!trip?.points?.length) return { ok: false, why: 'no stops' };
  if (!fix) return { ok: true, clockOnly: true, why: 'No location — alerts will run off the published timetable and the device clock.' };
  const a = trip.points[0];
  const d = Math.hypot((a.lat - fix.lat) * 111320, (a.lon - fix.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
  return { ok: true, metres: Math.round(d), far: d > 3000,
           why: d > 3000 ? `You are ${(d / 1000).toFixed(1)} km from ${a.name}. Alerts will still work, but they assume you are at that stop.` : null };
}
