/**
 * sfx.js — the small sounds the travel panels make.
 *
 * Every one of them is synthesised here with Web Audio. There is no audio file,
 * no fetch, no cache entry and no permission: a "train passing" is one band
 * swept up to 1.6 kHz and back down over 1.15 s, plus a 52 → 34 Hz sine for the
 * rails, panned hard left to hard right. The whole layer costs more comment
 * than code and cannot break offline use, because it never touches the network.
 *
 * Why it exists: two of the answers these tools give are things a person should
 * hear without looking at the screen — a place has been picked (so the list can
 * be read from the corner of an eye), and a get-off alert has fired (a phone in
 * a pocket does not show a notification, but it does make a noise).
 *
 * Rules this module keeps:
 *   · `play()` never throws and never lies. It returns `{ ok, why }`, and the
 *     last dozen decisions are kept in a ring buffer the UI prints under
 *     `how it knows` — so "silent" is always explained (off, hidden tab, no Web
 *     Audio, or the same sound 40 ms ago).
 *   · Autoplay policy is respected by construction: the context is created on
 *     the first call, which is always inside a tap handler, and `resume()` is
 *     attempted when the state is not `running`.
 *   · Nothing plays twice within a sound's own `minMs`, so a fast thumb on the
 *     departure chips does not machine-gun.
 *   · Two graphs share one code path with the tests: `build(ctx, dest, t)` is
 *     given an AudioContext and a destination, and the browser suite renders
 *     the very same function through an OfflineAudioContext to measure the
 *     samples (peak, length, where the energy sits). A sound that is only
 *     "scheduled" but silent fails the gate.
 */

import { getSettings, setSetting, onSettings } from './settings.js';

/** Headroom: six voices at once still cannot clip, and the limiter is a belt. */
export const MASTER = 0.5;

const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5,
  E6: 1318.5, G6: 1568, C7: 2093 };

/* ---------------------------------------------------------------- builders */

const NOISE_S = 2.4;
let noiseCache = null;

/** One shared pink-ish noise buffer per sample rate — generated once, ~0.6 ms. */
function noise(ctx) {
  if (noiseCache && noiseCache.rate === ctx.sampleRate) return noiseCache.buf;
  const n = Math.max(1, Math.floor(NOISE_S * ctx.sampleRate));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.06 * w) / 1.06;          // a leaky integrator: no fizz, no hum
    d[i] = Math.max(-1, Math.min(1, last * 3.2));
  }
  noiseCache = { rate: ctx.sampleRate, buf };
  return buf;
}

/**
 * One enveloped oscillator. Every ramp is exponential and never touches zero,
 * which is what Web Audio asks for and also what a bell does.
 */
function tone(ctx, dest, o) {
  const { type = 'sine', f, to = null, t = 0, dur = 0.3, peak = 0.2,
    attack = 0.008, detune = 0 } = o;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(10, f), t);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(10, to), t + dur);
  if (detune) osc.detune.setValueAtTime(detune, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

/** The noise engine behind a passing train, a door hiss and a brake. */
function swept(ctx, dest, o) {
  const { t = 0, dur = 1, peak = 0.3, type = 'bandpass', f = 240, f1 = 1600, f2 = 210,
    q = 1.15, pan = null, src = null } = o;
  const node = src || (() => {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    s.start(t);
    s.stop(t + dur + 0.02);
    return s;
  })();
  const bp = ctx.createBiquadFilter();
  bp.type = type;
  bp.Q.setValueAtTime(q, t);
  bp.frequency.setValueAtTime(Math.max(20, f), t);
  bp.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur * 0.34);
  bp.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + dur * 0.26);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  node.connect(bp).connect(g);
  let tail = g;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + dur);
    g.connect(p);
    tail = p;
  }
  tail.connect(dest);
  return node;
}

/* ------------------------------------------------------------------ sounds */

/**
 * Six sounds, each with what it means on screen. `dur` is the length the graph
 * occupies, `minMs` the anti-repeat window, `whileHidden` whether the tab being
 * in the background may silence it — an alert never may, a button press should.
 */
export const SOUNDS = {
  whoosh: {
    label: 'A train going past', when: 'you pick a place in a search box',
    dur: 1.25, minMs: 220,
    build(ctx, dest, t) {
      swept(ctx, dest, { t, dur: 1.15, peak: 0.34, f: 240, f1: 1600, f2: 205,
        q: 1.15, pan: [-0.95, 0.95] });
      tone(ctx, dest, { f: 52, to: 34, t: t + 0.02, dur: 1.0, peak: 0.26 });
      tone(ctx, dest, { type: 'triangle', f: 180, to: 92, t: t + 0.1, dur: 0.5, peak: 0.05 });
    },
  },
  back: {
    label: 'Air going the other way', when: 'you leave a tool',
    dur: 0.8, minMs: 260,
    build(ctx, dest, t) {
      swept(ctx, dest, { t, dur: 0.7, peak: 0.28, f: 1500, f1: 265, f2: 175, q: 1.3, pan: [0.9, -0.7] });
      tone(ctx, dest, { f: 40, to: 58, t: t + 0.04, dur: 0.5, peak: 0.18 });
    },
  },
  ding: {
    label: 'One station bell', when: 'an alert you asked for has been armed',
    dur: 0.55, minMs: 140,
    build(ctx, dest, t) {
      tone(ctx, dest, { f: NOTE.C6, t, dur: 0.42, peak: 0.19 });
      tone(ctx, dest, { f: NOTE.G6, t: t + 0.006, dur: 0.3, peak: 0.09, detune: 4 });
    },
  },
  alight: {
    label: 'Get off now — three bells', when: 'a get-off alert fires',
    dur: 1.15, minMs: 60, whileHidden: true,
    build(ctx, dest, t) {
      for (let i = 0; i < 3; i++) {
        const at = t + i * 0.26;
        tone(ctx, dest, { f: NOTE.C6, t: at, dur: 0.24, peak: 0.24 });
        tone(ctx, dest, { f: NOTE.E6, t: at + 0.004, dur: 0.2, peak: 0.13 });
      }
      tone(ctx, dest, { f: 66, to: 48, t: t + 0.02, dur: 0.9, peak: 0.16 });
    },
  },
  brake: {
    label: 'Air brake — that will not work', when: 'a plan the timetable cannot support',
    dur: 0.95, minMs: 260,
    build(ctx, dest, t) {
      swept(ctx, dest, { t, dur: 0.8, peak: 0.3, type: 'highpass', f: 2400, f1: 2600,
        f2: 620, q: 0.7 });
      tone(ctx, dest, { type: 'sawtooth', f: 240, to: 70, t: t + 0.02, dur: 0.55, peak: 0.09 });
      tone(ctx, dest, { f: 90, to: 55, t: t + 0.3, dur: 0.45, peak: 0.12 });
    },
  },
  tick: {
    label: 'A key press', when: 'an option, a sort, a departure chip',
    dur: 0.1, minMs: 45,
    build(ctx, dest, t) {
      tone(ctx, dest, { type: 'square', f: 1180, to: 900, t, dur: 0.045, peak: 0.075 });
    },
  },
  chime: {
    label: 'Four ascending bells — here it is', when: 'a journey has been worked out',
    dur: 0.85, minMs: 300,
    build(ctx, dest, t) {
      [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7].forEach((f, i) =>
        tone(ctx, dest, { f, t: t + i * 0.09, dur: 0.34, peak: i === 3 ? 0.2 : 0.15 }));
    },
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS);

/* --------------------------------------------------------------- plumbing */

let ctx = null;
let master = null;
let limiter = null;
let failed = '';
const lastAt = new Map();
const RING = [];

function context() {
  const AC = typeof AudioContext !== 'undefined' ? AudioContext
    : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
  if (!AC) { failed = 'this browser has no Web Audio'; return null; }
  if (!ctx) {
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 6;
        limiter.ratio.value = 9;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.12;
        master.connect(limiter).connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
    } catch (e) {
      failed = 'audio graph refused: ' + (e && e.message ? e.message : e);
      ctx = null;
      return null;
    }
  }
  // A tap is what unlocks the context; a suspended one still schedules, so the
  // only thing resume() can buy is the sound actually starting.
  if (typeof ctx.resume === 'function' && ctx.state !== 'running') {
    try { ctx.resume().catch(() => {}); } catch {}
  }
  return ctx;
}

export function supported() {
  return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
}

export function enabled() {
  try { return getSettings().sfx !== false; } catch { return true; }
}

export function setEnabled(on) {
  setSetting('sfx', !!on);
  return !!on;
}

/** Last dozen decisions, so a silent panel can say which of six reasons it was. */
export function soundLog() { return RING.slice(); }

function note(name, res) {
  RING.push({ name, ok: !!res.ok, why: res.why || '', at: Math.round(
    typeof performance !== 'undefined' ? performance.now() : 0) });
  if (RING.length > 12) RING.shift();
  return res;
}

/**
 * Play `name`. Safe from anywhere, including a render pass: it answers why it
 * did nothing rather than throwing at a component that only wanted a click.
 */
export function play(name, { delay = 0 } = {}) {
  const rec = SOUNDS[name];
  const res = { name: String(name || ''), ok: false, why: '' };
  if (!rec) return note(name, { ...res, why: 'no such sound' });
  if (!enabled()) return note(name, { ...res, why: 'sounds are off' });
  if (typeof document !== 'undefined' && document.hidden && !rec.whileHidden) {
    return note(name, { ...res, why: 'this tab is in the background' });
  }
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const prev = lastAt.get(name);
  if (prev != null && now - prev < rec.minMs) return note(name, { ...res, why: 'too soon' });
  const c = context();
  if (!c) return note(name, { ...res, why: failed || 'no audio context yet' });
  try {
    rec.build(c, master, c.currentTime + Math.max(0, delay));
    lastAt.set(name, now);
    return note(name, { ...res, ok: true, dur: rec.dur });
  } catch (e) {
    return note(name, { ...res, why: 'graph failed: ' + (e && e.message ? e.message : e) });
  }
}

/* ------------------------------------------------- the interaction layer */

/**
 * What a press sounds like, app-wide. Read top to bottom, first match wins, and
 * `null` means "stay quiet" — an element can opt out with data-sfx="none".
 *
 * One listener on the document instead of a call in every tool: 40+ tools cannot
 * be remembered one by one, and a delegated rule covers the buttons that get
 * written next month. The panel-level calls stay useful — they fire on the same
 * gesture and the anti-repeat window in play() turns the second one away, so a
 * deliberate sound (a chime for an answer, a bell for an alert) still wins.
 */
const PRESS_SOUNDS = [
  ['[data-sfx="none"]', null],
  ['.sndrow', null],
  ['.tile', 'whoosh'],
  ['button[aria-label="Back"]', 'back'],
  ['.btn', 'tick'],
  ['.cat', 'tick'],
  ['.chip', 'tick'],
  ['.tabs button', 'tick'],
  ['.iconbtn', 'tick'],
  ['.row', 'tick'],
  ['input[type="checkbox"]', 'tick'],
  ['input[type="radio"]', 'tick'],
];

let ATTACHED = null;

/** Start the app-wide layer. Returns the function that stops it again. */
export function attach(root) {
  if (typeof window === 'undefined') return () => {};
  if (ATTACHED) return ATTACHED.off;
  const host = (root && root.addEventListener ? root : document);
  const soundFor = (el) => {
    for (const [sel, name] of PRESS_SOUNDS) {
      if (el.closest(sel)) return name;
    }
    return undefined;
  };
  const fire = (ev, key) => {
    if (!enabled()) return;
    const el = ev.target && ev.target.closest ? ev.target : null;
    if (!el) return;
    if (!key) {
      if (ev.button != null && ev.button !== 0) return;     // a right-click is not a press
      if (ev.pointerType === 'pen' && ev.isPrimary === false) return;
    }
    const name = soundFor(el);
    if (name === undefined) return;
    if (name) play(name);
  };
  const onDown = (ev) => fire(ev, false);
  const onKey = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') fire(ev, true); };
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('keydown', onKey, true);
  const off = () => {
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('keydown', onKey, true);
    ATTACHED = null;
  };
  ATTACHED = { off, host };
  return off;
}

/** Is the layer listening? The start shell says yes from its first paint. */
export function attached() { return !!ATTACHED; }

/** The setting can be changed from the Settings page; honour it live. */
if (typeof window !== 'undefined') {
  try {
    onSettings((s) => {
      if (s && s.sfx === false && master) {
        lastAt.clear();          // turning sound off clears the anti-repeat
      }
    });
  } catch {}
}
