/**
 * Saved stops / stations — tiny shared store on top of localStorage.
 * Keys are names (bus stops and metro stations have unique names in their own
 * world; the `t` field keeps the two apart). A window event lets any tool that
 * is open stay in sync when another one saves or removes an entry.
 */
const KEY = 'dost:stops';
const MAX = 24;

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((s) => s && (s.t === 'bus' || s.t === 'metro') && s.n) : [];
  } catch { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full */ }
  try { window.dispatchEvent(new CustomEvent('dost:saved')); } catch { /* noop */ }
}

export function getSaved() { return read(); }

export function savedByType(t) {
  return read().filter((s) => s.t === t);
}

export function isSaved(t, n) {
  return read().some((s) => s.t === t && s.n === n);
}

/** Returns true when it was added (false if it was already there). */
export function saveStop(t, n) {
  const list = read();
  if (list.some((s) => s.t === t && s.n === n)) return false;
  list.push({ t, n });
  write(list.slice(-MAX));
  return true;
}

export function unsaveStop(t, n) {
  write(read().filter((s) => !(s.t === t && s.n === n)));
}

/** Subscribe to changes. Returns an unsubscribe fn. */
export function onSaved(fn) {
  const h = () => fn(getSaved());
  try { window.addEventListener('dost:saved', h); } catch { /* noop */ }
  return () => { try { window.removeEventListener('dost:saved', h); } catch { /* noop */ } };
}
