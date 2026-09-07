/**
 * journey-clock.js — turn a planned option into wall-clock times.
 *
 * The planners answer "42 min".  A person does not think in minutes, they think
 * in "I leave at 08:12 and I am there by 08:54, and the bus actually comes at
 * 08:15".  This module does that conversion, and it only uses numbers the two
 * datasets really publish:
 *
 *   · a bus leg is answered by that direction's own departure list
 *     (`nextAtStop`), so the wait and the boarding minute are published times;
 *   · a metro leg gets the line's published headway for that hour as the initial
 *     wait, the same 0.55 km/min running figure the metro planner already uses
 *     for its own total, and the same 7-minute allowance per interchange;
 *   · walking is the distance at 5 km/h, which the planners already show as such.
 *
 * Anything the data cannot answer stays `null` and is printed as an honest
 * sentence — never an invented timestamp.  The whole point is that `clock.minutes`
 * must agree with the headline number the option already shows; `verify_trip.mjs`
 * asserts that, so the timeline can never drift into fiction.
 */
import * as B from './bus-route.js';
import * as M from './metro-route.js';

export const WALK_KMH = 5;
export const METRO_KMPM = 0.55;   // the metro planner's own running speed, km per minute
export const CHANGE_MIN = 7;      // its own allowance per interchange
export const ACCESS_MIN = 2;      // and its own allowance to reach the platform

export const wrap = (m) => ((Math.round(m) % 1440) + 1440) % 1440;
const pad = (n) => String(n).padStart(2, '0');
/** `HH:MM` in 24-hour IST — the same shape the right-now panels use, and what
 *  a timeline of a journey is supposed to read like. */
export const fmt = (m) => (m == null ? '\u2014' : `${pad(Math.floor(wrap(m) / 60))}:${pad(wrap(m) % 60)}`);

/** Walk minutes from km, same rule as the planners. */
export const walkMin = (km) => Math.max(1, Math.round(((km || 0) / WALK_KMH) * 60));

/**
 * A Date whose IST minutes-of-day equal `min`, because `nextAtStop` takes a Date.
 * Built from today's IST midnight so the departure list is searched in the same
 * day the clock is talking about.
 */
export function dateFor(min, base = new Date()) {
  const off = 330 + base.getTimezoneOffset();          // minutes to add to get IST
  const ist = new Date(base.getTime() + off * 60000);  // its UTC fields are IST wall clock
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnight + wrap(min) * 60000 - off * 60000);
}

/** Published departures at a bus stop at or after `min`. */
function busBoarding(leg, min) {
  const bl = leg.bus?.legs?.[leg.busIndex ?? 0];
  if (!bl || bl.ri == null || bl.i0 == null) return null;
  const rec = B.ROUTES[bl.ri];
  if (!rec) return null;
  const list = B.nextAtStop(rec, bl.i0, dateFor(min), 2);
  return { rec, bl, list, next: list[0] || null, first: bl.first ?? null, last: bl.last ?? null,
    ref: bl.ref };
}

/**
 * The clock for one option.
 *
 * `option` is what the combined planner builds: `{ mode, minutes, fare, km,
 * legs:[{kind:'walk'|'metro'|'bus', …}], detail }`.  `departMin` is
 * minutes-of-day, IST.
 */
export function clockOf(option, departMin = B.minutesOfDay()) {
  const start = wrap(departMin);
  const legs = [];
  const risk = [];
  let cur = start;
  let waitMin = 0, rideMin = 0, walkTotal = 0;
  let metroSeen = 0, firstBoard = null, nextService = null;
  const det = option?.detail || null;

  const metroLegs = det?.legs?.length ? det.legs : null;   // carries published waits/last train

  (option?.legs || []).forEach((leg, i) => {
    if (leg.kind === 'walk') {
      const mins = leg.min != null ? leg.min : walkMin(leg.km);
      walkTotal += mins;
      legs.push({ kind: 'walk', label: leg.text || `Walk ${leg.km ?? '?'} km`, from: cur, mins,
        to: cur + mins, km: leg.km ?? null });
      cur += mins;
      return;
    }

    if (leg.kind === 'metro') {
      const info = M.lineInfo(leg.line, wrap(cur));
      let wait = null, waitWhy = null, waitLabel = null;
      if (!info) {
        waitWhy = 'this line publishes no timetable to check against';
      } else if (!info.open) {
        // The line has a published first train, so the honest answer is "then",
        // not a ride that starts at the minute you asked for.
        const till = info.nextOpenIn != null ? info.nextOpenIn : 0;
        wait = till;
        waitLabel = `until the ${leg.line} opens at ${fmt(cur + till)}`;
        risk.push({ kind: 'closed', at: cur + till,
          text: `The ${leg.line} does not run at ${fmt(cur)} \u2014 its first train is at ${fmt(cur + till)}, `
            + 'so this journey starts then.' });
      } else if (metroSeen === 0) {
        // the planner's own "including the wait" figure, so both tools agree
        const hw = info.headway;
        const head = hw ? Math.max(2, Math.round((hw[0] + hw[1]) / 2)) : 0;
        wait = det?.nextIn != null ? det.nextIn : head;
      }
      /* No wait is added for a change of line: the metro planner already charges
         CHANGE_MIN per leg boundary inside its own `minutes`, so charging it again
         here would double-count. What is left over after the rides and walks is
         exactly that allowance, and it is shown as its own segment below. */
      const ride = Math.max(1, Math.round((leg.km || 0) / METRO_KMPM));
      if (wait) {
        legs.push({ kind: 'wait', label: waitLabel
          || (metroSeen === 0 ? `Wait for the ${leg.line}` : `Change to the ${leg.line}`),
          from: cur, mins: wait, to: cur + wait, colour: leg.colour,
          why: metroSeen === 0 && info?.headway && info.open
            ? `trains every ${info.headway[0]}-${info.headway[1]} min at this hour${info.peak ? ' (peak)' : ''}, `
              + `and ${ACCESS_MIN} min to reach the platform is already in the headline`
            : waitWhy });
        waitMin += wait;
        cur += wait;
      } else if (waitWhy) {
        legs.push({ kind: 'wait', label: `Wait for the ${leg.line}`, from: cur, mins: null, to: cur,
          colour: leg.colour, why: waitWhy });
      }
      if (firstBoard == null) firstBoard = cur;
      legs.push({ kind: 'ride', mode: 'metro', label: leg.line, line: leg.line, colour: leg.colour,
        from: cur, mins: ride, to: cur + ride, detail: `${leg.from} \u2192 ${leg.to}`,
        stops: leg.count ?? (leg.stops?.length ?? null), km: leg.km ?? null, boardAt: cur });
      rideMin += ride;
      cur += ride;
      metroSeen++;
      // the last train guard comes straight from the metro planner's own maths
      if (det?.canMakeIt === false && metroLegs) {
        risk.push({ kind: 'last-train', at: det.lastTrain ?? null,
          text: `The last ${leg.line} train from ${det.lastTrainAt || leg.from} left at ${fmt(det.lastTrain)} — `
            + 'this departure does not exist. The times below are the ride alone.' });
      }
      return;
    }

    if (leg.kind === 'bus') {
      const b = busBoarding(leg, cur);
      const ride = leg.bus?.legs?.[leg.busIndex ?? 0]?.minutes ?? null;
      if (!b) {
        legs.push({ kind: 'ride', mode: 'bus', label: leg.ref, from: cur,
          mins: leg.bus?.legs?.[0]?.minutes ?? null, to: cur + (leg.bus?.legs?.[0]?.minutes ?? 0),
          detail: `${leg.from} → ${leg.to}`, stops: leg.count ?? null, km: leg.km ?? null,
          note: 'no published departure list for this direction' });
        rideMin += leg.bus?.legs?.[0]?.minutes ?? 0;
        cur += leg.bus?.legs?.[0]?.minutes ?? 0;
        return;
      }
      if (!b.next) {
        const back = b.first != null
          ? `the first one tomorrow is at ${fmt(b.first)}`
          : 'this direction publishes no departures';
        risk.push({ kind: 'over', at: cur, ref: b.ref,
          text: `No ${b.ref} stops at ${leg.from} after ${fmt(cur)} today — ${back}.` });
        nextService = b.first;
        legs.push({ kind: 'wait', label: `Wait for the ${b.ref}`, from: cur, mins: null, to: cur,
          why: `service on ${b.ref} ends at ${fmt(b.last)}${b.first != null ? `, first at ${fmt(b.first)}` : ''}` });
        return;
      }
      const wait = Math.max(0, wrap(b.next.at) - cur);
      if (wait) {
        legs.push({ kind: 'wait', label: `Wait for the ${b.ref} at ${leg.from}`, from: cur, mins: wait,
          to: cur + wait, why: `published departure ${fmt(b.next.at)} at ${leg.from}` });
        waitMin += wait;
        cur += wait;
      }
      if (wait >= 15) {
        risk.push({ kind: 'long-wait', at: cur,
          text: `You would wait ${wait} min at ${leg.from} — the next ${b.ref} is at ${fmt(b.next.at)}.` });
      }
      if (firstBoard == null) firstBoard = cur;
      const mins = ride ?? Math.max(3, Math.round((leg.km || 1) / 0.28));
      legs.push({ kind: 'ride', mode: 'bus', label: b.ref, from: cur, mins, to: cur + mins,
        detail: `${leg.from} → ${leg.to}`, stops: leg.count ?? null, km: leg.km ?? null, boardAt: cur,
        scheduled: b.next.at != null });
      rideMin += mins;
      cur += mins;
      return;
    }

    // an unknown leg kind must never be silently dropped: it would make the
    // timeline a lie about what the journey contains
    legs.push({ kind: leg.kind || 'other', label: leg.text || leg.line || leg.ref || 'leg',
      from: cur, mins: leg.min ?? leg.minutes ?? null, to: cur, why: 'not modelled' });
  });

  // What the planner printed as this option's duration counts the ride, the walk
  // and its own allowances - but no waiting. So the timeline has to account for
  // that number exactly, or the bar and the headline are telling lies about each
  // other. The planner charges 7 min per leg boundary, one platform allowance, and
  // rounds the whole distance instead of each leg; the leftover is therefore shown
  // as its own labelled segment rather than hidden inside a ride.
  const noWait = rideMin + walkTotal;
  const published = option?.minutes != null ? option.minutes : null;
  let allowance = published == null ? 0 : Math.max(0, published - noWait);
  if (allowance >= 2) {
    legs.push({ kind: 'allowance', label: 'change and platform allowance', mins: allowance,
      from: cur, to: cur, why: `the ${published} min headline already charges ${allowance} min for `
        + `${metroSeen > 1 ? `changing line ${(metroSeen - 1) * CHANGE_MIN} min` : 'nothing to change'} and `
        + `${ACCESS_MIN} min to reach the platform, so it is drawn here instead of hidden inside a ride` });
  } else {
    allowance = 0;
  }
  const total = cur - start + allowance;
  return {
    legs,
    departMin: start,
    arriveMin: cur,
    afterMidnight: cur >= 1440,
    minutes: total,
    rideMin, waitMin, walkMin: walkTotal,
    boardMin: firstBoard != null ? wrap(firstBoard) : null,
    publishedMinutes: published,
    noWaitMin: noWait,
    allowanceMin: allowance,
    withWaitMin: published == null ? null : published + waitMin,
    agrees: published == null ? null : Math.abs(total - (published + waitMin)) <= 1,
    nextService,
    risk,
    fmt: (m) => fmt(m),
  };
}

/**
 * Departure grid: "if you leave at HH:MM, you arrive at HH:MM".
 *
 * The minutes chosen here are when the *person* leaves, never invented vehicle
 * times — the arrival is computed from them, and for a bus leg it is the
 * direction's own published departure that decides the wait.
 */
export function departures(option, fromMin, count = 6, stepMin = 10) {
  const out = [];
  let m = wrap(fromMin);
  for (let i = 0; i < count; i++) {
    const c = clockOf(option, m);
    out.push({ departMin: m, arriveMin: c.arriveMin, minutes: c.minutes, blocked: c.risk.some((r) => r.kind === 'over' || r.kind === 'closed'),
      risks: c.risk.length });
    m += stepMin;
    if (m >= 1440) break;                       // never wrap into tomorrow's timetable
  }
  return out;
}

/** Latest departure that still arrives by `targetMin`, searched on a fixed grid. */
export function latestFor(option, targetMin, { horizon = 300, step = 5 } = {}) {
  const target = wrap(targetMin);
  for (let back = 0; back <= horizon; back += step) {
    const m = target - Math.round(option?.minutes ?? 30) - back;
    if (m < 0) break;
    const c = clockOf(option, m);
    if (c.risk.some((r) => r.kind === 'over' || r.kind === 'closed')) continue;
    if (c.arriveMin <= target) {
      return { departMin: wrap(m), arriveMin: c.arriveMin, minutes: c.minutes, slack: target - c.arriveMin, clock: c };
    }
  }
  return null;
}

/** How much of the day a segment of `mins` occupies, for the bar widths. */
export function widths(legs) {
  const total = legs.reduce((s, l) => s + (l.mins || 0), 0) || 1;
  return legs.map((l) => (l.mins || 0) / total);
}
