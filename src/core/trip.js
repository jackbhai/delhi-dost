/**
 * trip.js — the model behind "get me off at …"
 *
 * A plan (a bus option, a metro journey, or a combined metro+bus option) is
 * turned into a TRACK: an ordered list of real coordinates with a role
 * (walk / board / ride / change / alight) and, where the published timetable
 * allows it, an expected minute.  `judge()` then takes one GPS fix (or just the
 * clock) plus that track and answers the only three questions that matter while
 * you are on a bus: which stop is next, how far it is, and whether to tell you
 * now.
 *
 * Deliberately no DOM and no timers here: everything is a pure function of
 * (track, position, time), so scripts/verify_trip.mjs can drive it with
 * synthesized fixes along the real polyline and assert the alerts it produces.
 *
 * Nothing in here invents a position.  With no usable fix the state machine
 * falls back to the published timetable against the device clock, and says so
 * through `clockBased`, which the UI is required to surface.
 */
import * as B from './bus-route.js';
import * as M from './metro-route.js';

/* Proximity thresholds, in metres.  Phone GPS in a pocket is rarely better
   than ~15 m; a laptop is ~50-100 m.  Anything worse than ACCURACY_MAX is not
   trusted for "get off now" — the clock takes over instead. */
export const ARRIVE_M = 130;      // at/near this stop: tell the user
export const NEAR_M = 420;        // approaching: pre-alert ("get ready")
export const MISSED_M = 900;      // moved this far past it: say you missed it
export const ACCURACY_MAX = 150;  // worse fix than this => don't trust proximity
export const WALK_PACE = 1.35;    // m/s, used only for "about N min on foot"

/* ------------------------------------------------------------------ geometry */
export const metresBetween = (a, b) => {
  if (!a || !b || !isFinite(a.lat) || !isFinite(a.lon) || !isFinite(b.lat) || !isFinite(b.lon)) return null;
  const r = 6371e3, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.min(1, Math.sqrt(h))));
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 0-359 from a to b, and the 16-point compass label. */
export function bearing(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return null;
  const toRad = (x) => (x * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
          - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}
export const compass = (deg) => (deg == null ? null : COMPASS[Math.round(((deg % 360) / 22.5)) % 16]);

export function walkMins(metres) {
  return metres == null ? null : Math.max(1, Math.round(metres / 60 / WALK_PACE));
}

/* ------------------------------------------------------------------- tracks */
const pos = (name) => {
  const s = B.stopAt(name);
  if (s) return { lat: s.lat, lon: s.lon };
  const st = M.stationAt(name);
  return st ? { lat: st.lat, lon: st.lon } : null;
};

/**
 * Which end of the published line this train is heading for, decided by where
 * the two stations sit in the line's own order.  Returns null when they cannot
 * be placed on one record (a branch quirk), and callers then omit the direction
 * instead of guessing it.
 */
export function lineDirection(base, fromName, toName) {
  for (const L of M.lineRecords(base)) {
    const a = L.s.indexOf(fromName), b = L.s.indexOf(toName);
    if (a < 0 || b < 0) continue;
    return b >= a ? L.s.at(-1) : L.s[0];
  }
  return null;
}

/**
 * Bus option from B.planBus() -> track.  `boardMin` is the minutes-midnight of
 * the bus you are actually waiting for, so every later stop gets an expected
 * minute derived from the published full-run time (never measured traffic).
 */
export function trackOfBus(opt, { boardMin = null, label = '' } = {}) {
  const pts = [];
  opt.legs.forEach((leg, li) => {
    const rec = B.ROUTES[leg.ri];
    if (!rec) return;
    const step = leg.i1 >= leg.i0 ? 1 : -1;
    for (let k = leg.i0; step > 0 ? k <= leg.i1 : k >= leg.i1; k += step) {
      const p = B.STOPS[rec.s[k]];
      if (!p) continue;
      const eta = k === leg.i0 ? 0 : B.busEta(rec, leg.i0, k);
      pts.push({
        name: p.n, lat: p.lat, lon: p.lon, leg: li, kind: 'ride',
        stopIdx: k, isBoard: k === leg.i0, isAlight: k === leg.i1,
        km: +(((rec.m?.[k] ?? 0) - (rec.m?.[leg.i0] ?? 0)) / 1000).toFixed(2),
        runMin: eta == null ? null : eta,
        whenMin: boardMin != null && eta != null ? (boardMin + eta) % 1440 : null,
        ref: leg.ref, dir: leg.dir, timed: leg.timed,
      });
    }
  });
  return {
    mode: 'bus', label: label || opt.legs.map((l) => l.ref).join(' + '),
    points: pts, legs: opt.legs.map((l) => ({
      kind: 'bus', ref: l.ref, from: l.from, to: l.to, dir: l.dir, op: l.op,
      stops: l.stops, km: l.km, minutes: l.minutes, fare: l.fare, timed: l.timed,
      first: l.first, last: l.last, boardFrom: l.boardFrom,
    })),
    from: opt.legs[0].from, to: opt.legs.at(-1).to,
    totalMin: opt.minutes ?? null, totalKm: opt.km ?? null,
    /* what we can honestly promise: the departure is published, the intermediate
       times are derived from it */
    timing: boardMin != null ? (opt.exact ? 'published departure + measured route length' : 'published departure + straight-line share') : 'no departure time known',
  };
}

/** Metro journey from M.planRoutes() -> track. */
export function trackOfMetro(opt, { boardMin = null, label = '' } = {}) {
  const pts = [];
  let acc = 0;
  opt.legs.forEach((leg, li) => {
    // a leg's `from` is the boarding station and `stops` are the ones after it,
    // so a walk leg starts exactly where the next ride starts
    const list = [leg.from, ...(leg.stops || [])];
    const kmShare = leg.km / Math.max(1, list.length - 1);
    list.forEach((n, k) => {
      const p = M.stationAt(n);
      if (!p) return;
      const runMin = Math.round((kmShare / 0.55) * k + (leg.walk ? walkMins(kmShare * 1000) || 1 : 0) * k);
      pts.push({
        name: n, lat: p.lat, lon: p.lon, leg: li,
        kind: leg.walk ? 'walk' : 'ride',
        isBoard: k === 0, isAlight: k === list.length - 1,
        km: +(kmShare * k).toFixed(2), runMin,
        whenMin: boardMin != null ? (boardMin + runMin + acc) % 1440 : null,
        line: leg.line, colour: leg.colour, toward: lineDirection(leg.line, leg.from, leg.to),
      });
    });
    acc += Math.round(leg.km / 0.55) + (leg.walk ? walkMins(leg.km * 1000) || 1 : 0);
  });
  return {
    mode: 'metro', label: label || opt.legs.filter((l) => !l.walk).map((l) => l.line).join(' + '),
    points: pts,
    legs: opt.legs.map((l) => ({
      kind: l.walk ? 'walk' : 'metro', line: l.line, colour: l.colour,
      from: l.from, to: l.to, stops: l.count ?? l.stops?.length ?? 0,
      km: l.km, note: l.note || null,
    })),
    from: opt.from, to: opt.to,
    totalMin: opt.minutes ?? null, totalKm: opt.km ?? null,
    timing: 'station order from the published network; minutes are km/33 km/h, not a train position',
  };
}

/** Combined metro+bus option from the multi-modal planner -> track. */
/** Stations a metro leg passes through, from whichever branch covers both ends. */
function lineSlice(lineName, from, to) {
  if (!lineName) return null;
  const base = String(lineName).replace(/\s*\(.*\)\s*$/, '');
  const rec = (M.lineRecords(base) || []).find((L) => L.s && L.s.includes(from) && L.s.includes(to));
  if (!rec) return null;
  const a = rec.s.indexOf(from), b = rec.s.indexOf(to);
  return a <= b ? rec.s.slice(a, b + 1) : rec.s.slice(b, a + 1).slice().reverse();
}

export function trackOfCombo(opt, { boardMin = null } = {}) {
  const pts = [];
  const legs = [];
  opt.legs.forEach((l, li) => {
    if (l.kind === 'walk') {
      legs.push({ kind: 'walk', from: l.from ?? opt.from, to: l.to, text: l.text, km: l.km,
                  measured: l.measured || null });
      /* a place picked off the map is not in the stop table by name - its own exact
         position is the truth, and it belongs at the end of the line, not at the
         nearest namesake stop */
      const a = (li === 0 && opt.fromPos) ? { lat: opt.fromPos.lat, lon: opt.fromPos.lon } : pos(l.from ?? opt.from);
      const b = (li === opt.legs.length - 1 && opt.toPos) ? { lat: opt.toPos.lat, lon: opt.toPos.lon } : pos(l.to);
      if (a) pts.push({ name: l.from ?? opt.from, ...a, leg: li, kind: 'walk', isBoard: !pts.length, isAlight: false });
      if (b) pts.push({ name: l.to, ...b, leg: li, kind: 'walk', isBoard: false, isAlight: false });
      return;
    }
    if (l.kind === 'bus' && l.bus) {
      const t = trackOfBus(l.bus, { boardMin });
      t.points.forEach((p) => pts.push({ ...p, leg: li, line: null, ref: l.ref }));
      legs.push({ kind: 'bus', ref: l.ref, from: l.from, to: l.to, stops: l.count, km: l.km });
      return;
    }
    if (l.kind === 'metro') {
      const mid = l.stops?.length ? [l.from, ...l.stops] : (lineSlice(l.line, l.from, l.to) || [l.from, l.to]);
      const names = mid.filter((v, i, a) => v && a.indexOf(v) === i);
      names.forEach((n, k) => {
        const p = M.stationAt(n);
        if (!p) return;
        pts.push({ name: n, lat: p.lat, lon: p.lon, leg: li, kind: 'ride', line: l.line, colour: l.colour,
                   isBoard: k === 0, isAlight: k === names.length - 1, km: null,
                   runMin: null, whenMin: null, toward: l.from });
      });
      legs.push({ kind: 'metro', line: l.line, colour: l.colour, from: l.from, to: l.to, stops: l.count, km: l.km });
    }
  });
  /* A walk that ends exactly where the ride begins is one place, not two events:
     the alert would otherwise say "walk to Rajiv Chowk" and "board" as if they were
     separate stops. And the journey's end is only flagged as an alighting when no
     ride already flagged one — the get-off cue belongs on the platform, not on the
     pavement after it. */
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].isBoard && pts[i - 1].name === pts[i].name) pts[i].isBoard = false;
  }
  const end = pts.at(-1) || null;
  if (end && !pts.some((p) => p.isAlight)) end.isAlight = true;
  /* footpath geometry for measured walks - the map draws these as its dotted
     cyan threads, one per end; a plan without measurements simply has none */
  const wpath = [];
  (opt.legs || []).forEach((l) => {
    if (l.kind === 'walk' && Array.isArray(l.path) && l.path.length > 1)
      wpath.push(l.path.map((c) => ({ lat: c[0], lon: c[1] })));
  });
  return {
    wpath,
    mode: 'combo', label: opt.legs.map((l) => (l.kind === 'bus' ? l.ref : l.kind === 'metro' ? l.line : 'walk')).join(' + '),
    points: pts, legs,
    from: opt.from ?? pts[0]?.name, to: opt.to ?? end?.name,
    totalMin: opt.minutes ?? null, totalKm: opt.km ?? null,
    timing: 'metro legs from the published network, bus legs from the published timetable',
  };
}

/** A whole route (no destination chosen yet): right-now panel's map + alight picker. */
export function trackOfRoute(rec, { boardMin = null, upTo = null } = {}) {
  const last = upTo == null ? rec.s.length - 1 : upTo;
  const points = [];
  for (let k = 0; k <= last; k++) {
    const p = B.STOPS[rec.s[k]];
    if (!p) continue;
    const eta = k === 0 ? 0 : B.busEta(rec, 0, k);
    points.push({
      name: p.n, lat: p.lat, lon: p.lon, leg: 0, kind: 'ride', stopIdx: k,
      isBoard: k === 0, isAlight: k === last,
      km: +(((rec.m?.[k] ?? 0) - (rec.m?.[0] ?? 0)) / 1000).toFixed(2),
      runMin: eta, whenMin: boardMin != null && eta != null ? (boardMin + eta) % 1440 : null,
      ref: rec.r, dir: `${rec.f} → ${rec.t}`,
    });
  }
  return {
    mode: 'route', label: rec.r,
    points,
    legs: [{ kind: 'bus', ref: rec.r, from: rec.f, to: rec.t, dir: `${rec.f} → ${rec.t}`,
             stops: last, km: rec.km, minutes: rec.mins, timed: !!(rec.tt?.d?.length) }],
    from: rec.f, to: rec.t, totalMin: rec.mins ?? null, totalKm: rec.km ?? null,
    timing: boardMin == null ? 'no departure time known'
      : rec.sm === 0 || !rec.m
        ? 'published departure + straight-line share (no polyline was published for this direction)'
        : 'published departure + measured route length',
  };
}

/**
 * Line shape for the network tab: stations with coordinates, in published order.
 * `upToName` cuts the line at a chosen station, which turns a whole corridor
 * into "the ride from the first station to the one you are getting off at" —
 * the same question a get-off alert answers on a bus.
 */
export function trackOfLine(base, { upToName = null } = {}) {
  const rec = M.lineRecord(base) || M.lineRecords(base)[0];
  const seen = new Set();
  const points = [];
  for (const L of M.LINES.filter((x) => x.l === base)) {
    for (const n of L.s) {
      if (seen.has(n)) continue;
      seen.add(n);
      const p = M.stationAt(n);
      if (!p) continue;
      points.push({ name: n, lat: p.lat, lon: p.lon, leg: 0, kind: 'ride',
                    isBoard: points.length === 0, isAlight: false, line: L.n, colour: L.c });
    }
  }
  if (upToName) {
    const cut = points.findIndex((p) => p.name === upToName);
    if (cut > 0) points.length = cut + 1;
  }
  if (points.length) points.at(-1).isAlight = true;
  return { mode: 'line', label: base, points, legs: [{ kind: 'metro', line: base }],
           from: points[0]?.name || rec?.s?.[0]?.n, to: points.at(-1)?.name || null,
           totalMin: null, totalKm: null,
           timing: upToName
             ? `cut at ${upToName}; station order as published, no train position exists publicly`
             : 'station order as published; this is a network map, not a journey' };
}

/* -------------------------------------------------------------- judgement */
/**
 * One tick of the state machine.
 *
 *   track   from trackOf*()
 *   fix     {lat,lon,accuracy} or null   (null => clock only)
 *   nowMin  minutes-midnight, IST clock
 *   fired   Set of alert keys already announced (the caller persists it)
 *
 * Returns state + the alert to announce, if any.  Alert keys are stable, so a
 * caller that re-renders never double-notifies.
 */
export function judge(track, fix = null, nowMin = null, fired = new Set()) {
  const pts = (track.points || []).filter(Boolean);
  if (!pts.length) return { state: 'empty', stopsLeft: 0, fired };
  const trust = !!(fix && isFinite(fix.lat) && isFinite(fix.lon)
                   && (fix.accuracy == null || fix.accuracy <= ACCURACY_MAX));
  const clock = nowMin != null && pts.some((p) => p.whenMin != null);
  if (!trust && !clock) {
    return { state: 'no-signal', stopsLeft: remaining(pts, 0), fired,
             hint: 'No usable position and no published departure to time from.' };
  }

  /* Where are we?  A stop counts as reached only when it is within ARRIVE_M and
     no earlier stop was closer — that keeps a route with stops 100 m apart from
     "arriving" at its second stop while you stand at its first, and still lets a
     route that doubles back near its start advance to the later stop. */
  let reached = -1, best = Infinity;
  pts.forEach((p, i) => {
    const d = trust ? metresBetween(fix, p) : null;
    if (d != null) {
      if (d <= ARRIVE_M && d <= best + 1) { best = Math.min(best, d); reached = i; }
      return;
    }
    // a usable fix outranks the timetable: standing 2 km from the stop at the
    // minute your bus is due does not mean you are at the stop
    const byClock = !trust && clock && p.whenMin != null
                 && nowMin >= p.whenMin - 1 && nowMin <= p.whenMin + 6;
    if (byClock) reached = i;
  });
  if (!trust && clock) {
    /* before the first stop, or long after the last published minute: fall back
       to "furthest point whose minute has passed", so a late bus never looks done */
    let last = -1;
    pts.forEach((p, i) => { if (p.whenMin != null && nowMin >= p.whenMin - 1) last = i; });
    if (reached < 0) reached = Math.max(reached, last);
  }

  const end = pts.find((p) => p.isAlight) || pts.at(-1);
  const endIdx = pts.indexOf(end);
  if (reached > endIdx) reached = endIdx;          // the destination is the frontier
  const next = pts[Math.min(reached + 1, pts.length - 1)];
  const dNext = trust && next ? metresBetween(fix, next) : null;
  const dEnd = trust ? metresBetween(fix, end) : null;
  const key = (i, what) => `${track.mode}:${pts[i]?.ref || ''}:${pts[i]?.name}:${what}`;
  const say = (i, what, title, body, urgent = false) => {
    const k = key(i, what);
    if (fired.has(k)) return null;
    fired.add(k);
    return { key: k, title, body, urgent };
  };

  let alert = null, state = 'waiting';
  if (reached < 0) {
    state = 'to-stop';
    const d0 = trust ? metresBetween(fix, pts[0]) : null;
    if (d0 != null && d0 <= ARRIVE_M) {
      state = 'at-board';
      alert = say(0, 'board', `Board here — ${pts[0].name}`,
        pts[0].ref ? `${pts[0].ref} towards ${pts[0].dir || ''}`.trim() : pts[0].name);
    } else if (d0 != null && d0 <= NEAR_M) {
      alert = say(0, 'near', `Almost at ${pts[0].name}`, `About ${Math.round(d0)} m to go — be ready to board.`);
    }
  } else if (pts[reached]?.isBoard) {
    /* at the stop you board from: that is its own moment, not "riding" yet */
    state = 'at-board';
    alert = say(reached, 'board',
      `Board ${pts[reached].ref || pts[reached].line || 'here'} at ${pts[reached].name}`,
      pts[reached].dir ? `${pts[reached].dir} — check the number on the front` : 'This is your boarding stop.');
  } else {
    const boarded = reached >= 0;
    const left = Math.max(0, endIdx - Math.max(reached, 0));
    state = boarded ? (left <= 0 ? 'alight' : 'riding') : 'to-stop';
    if (boarded && left > 0) {
      const ahead = pts[Math.min(reached + 1, pts.length - 1)];
      const da = metresBetween(fix, ahead);
      if (da != null && da <= ARRIVE_M) {
        alert = say(reached + 1, 'approach', `Get off at ${ahead.name}`,
          left === 1 ? `Last stop — take your bags and exit on the ${side(ahead, pts[reached])} side.`
                     : `${left} stops left on ${ahead.ref || ahead.line || ''}`.trim());
      } else if (da != null && da <= NEAR_M) {
        alert = say(reached + 1, 'soon', `${left === 1 ? 'Next stop' : `${left} stops left`}: ${ahead.name}`,
          `About ${Math.round(da)} m away.`);
      }
    }
    if (dEnd != null && dEnd <= ARRIVE_M) {
      state = 'alight';
      alert = say(endIdx, 'off', `This is your stop — ${end.name}`,
        track.legs.at(-1)?.ref ? `${track.legs.at(-1).ref} · then you are at ${track.to}` : `You are at ${track.to}`);
    }
    if (!alert && trust && dNext != null && dNext > MISSED_M && reached + 1 < endIdx) {
      alert = say(reached + 1, 'passed', `You may have passed ${next.name}`,
        `The next stop is ${Math.round(dNext)} m further along. Ride on and get off at ${end.name}.`);
    }
  }
  if (state === 'alight' && reached >= endIdx) state = 'done';
  if (state === 'done') alert = alert || say(endIdx, 'done', `Arrived: ${track.to || end.name}`,
    'Trip alert finished.');

  return {
    state, alert, fired,
    reached, next, stopsLeft: Math.max(0, endIdx - Math.max(reached, 0)),
    distanceM: dNext, endDistanceM: dEnd,
    bearingDeg: next && trust ? bearing(fix, next) : null,
    bearingTo: next && trust ? compass(bearing(fix, next)) : null,
    minsToNext: next?.runMin != null && pts[Math.max(reached, 0)]?.runMin != null
      ? Math.max(1, next.runMin - pts[Math.max(reached, 0)].runMin) : null,
    clockBased: !trust && clock, trusting: trust, accuracy: fix?.accuracy ?? null,
    timing: track.timing,
  };
}

const remaining = (pts, from) => Math.max(0, pts.length - from - 1);
const side = (a, b) => {
  if (!a || !b) return 'left';
  const to = bearing(b, a);
  if (to == null) return 'left';
  const turn = ((to % 180) + 180) % 180;
  return turn > 90 ? 'right' : 'left';
};

/** Plain-English turn-by-turn for a track: one line per thing you do. */
export function stepsOf(track) {
  const out = [];
  const pts = track.points || [];
  /* Which point on the line each step stands at, so the list and the map speak
     the same index-space; and for a ride, the stops in between, so "4 stops to
     ESI Hospital" can open into the four names it summarises. */
  const legAt = (li, first) => {
    let f = -1, l = -1;
    pts.forEach((p, k) => { if (p.leg === li) { if (f < 0) f = k; l = k; } });
    return first ? f : l;
  };
  const viaOf = (li) => {
    const idx = [];
    pts.forEach((p, k) => { if (p.leg === li) idx.push(k); });
    return idx.slice(1, -1).map((k) => ({ n: pts[k].name || '', at: k, when: pts[k].whenMin != null ? pts[k].whenMin : null }));
  };
  const alightOf = (li) => pts.filter((p) => p.leg === li && p.isAlight).at(-1);
  const boardOf = (li) => pts.find((p) => p.leg === li && p.isBoard);
  track.legs.forEach((leg, li) => {
    const b = boardOf(li), a = alightOf(li);
    const hops = Math.max(0, pts.filter((p) => p.leg === li).length - 1);
    if (leg.kind === 'walk') {
      out.push({ kind: 'walk', text: leg.text || `Walk to ${leg.to}`, km: leg.km,
                 metres: leg.km != null ? Math.round(leg.km * 1000) : null,
                 min: leg.km != null ? walkMins(leg.km * 1000) : null,
                 from: leg.from, to: leg.to, leg: li, measured: leg.measured || null,
                 pi: legAt(li, false),
                 note: leg.note || 'no exit numbers are published for this station' });
      return;
    }
    if (leg.kind === 'bus') {
      out.push({ kind: 'board', text: `Board ${leg.ref} at ${leg.from}`, detail: leg.dir || '',
                 wait: leg.timed ? 'departure times published' : 'no published timetable for this route',
                 window: leg.first != null ? [leg.first, leg.last] : null, leg: li, at: b || null, pi: legAt(li, true) });
      out.push({ kind: 'ride', text: `${hops || leg.stops || '?'} stop${(hops || leg.stops) === 1 ? '' : 's'} to ${leg.to}`,
                 detail: [leg.km != null ? `${leg.km} km` : null, leg.minutes != null ? `about ${leg.minutes} min` : null,
                          leg.fare != null ? `Rs${leg.fare}` : null].filter(Boolean).join(' · '),
                 leg: li, from: b, to: a, stops: hops, pi: legAt(li, false), via: viaOf(li) });
      return;
    }
    const dir = lineDirection(leg.line, leg.from, leg.to);
    out.push({ kind: 'board', text: `Board the ${leg.line} at ${leg.from}`,
               detail: dir ? `towards ${dir}` : '', note: leg.note || '',
               toward: dir, leg: li, at: b || null, pi: legAt(li, true) });
    out.push({ kind: 'ride', text: `${hops || leg.stops || '?'} stop${(hops || leg.stops) === 1 ? '' : 's'} to ${leg.to}`,
               detail: leg.colour ? '' : '', leg: li, from: b, to: a, stops: hops, colour: leg.colour, pi: legAt(li, false), via: viaOf(li) });
  });
  out.push({ kind: 'alight', text: `Get off at ${track.to || pts.at(-1)?.name}`, leg: track.legs.length - 1,
             pi: pts.length - 1, at: alightOf(track.legs.length - 1) || pts.at(-1) || null });
  return out;
}
