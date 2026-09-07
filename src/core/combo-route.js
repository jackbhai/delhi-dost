/**
 * combo-route.js — one graph, two modes, and an answer that is a *journey*.
 *
 * The combined planner used to bolt a feeder bus onto a metro plan when one
 * happened to exist, and otherwise print "Metro: 26 min" next to "Bus: 58 min"
 * and leave the choice to the reader. That is not a combined planner: it never
 * looked for the bus that beats the metro by ₹28, or the one that drops you at a
 * station two stops earlier.
 *
 * So this builds one graph out of the two published datasets and searches it.
 *
 *   node  b#<stop index>     one of the physical bus stops in bus-delhi.json
 *   node  m#<station name>   one of the metro stations in metro-delhi.json — a station
 *                            served by three lines is ONE node, so a change of line is
 *                            a costed event at that node and not a mystery detour
 *   edge  bus hop            consecutive stops of a published direction. km comes from that
 *                            route's own shape via journeyKm(), minutes from its own average
 *                            speed (published km ÷ published minutes) — the same two calls
 *                            the bus planner makes, so a leg measured here IS the leg the
 *                            bus tool prints, not an estimate of it
 *   edge  metro hop          consecutive stations of a line, haversine km at 0.55 km/min
 *   edge  walk               a station's published `b` list (the bus stops near it with
 *                            No invented corridors: where the data does not say two places
 *                            can be walked, this graph has no edge between them
 *
 * Costs, and their sources: a metro chain costs Σkm/0.55 + (runs−1)×CHANGE_MIN + ACCESS_MIN,
 * which is the metro planner's own headline formula, so the two tools cannot drift. A bus
 * ride costs its km ÷ its route's speed. A change of vehicle costs BOARD_MIN (getting off,
 * walking, getting on) and — importantly — that penalty is charged even when the rider walks
 * between the two platforms, because walking around a transfer does not make it free.
 * Fares are the slabs: DMRC once per continuous metro chain, DTC per bus ride (no free
 * transfer is modelled because DTC publishes none in this dataset), and a chain that includes
 * a line outside DMRC is flagged `separateTicket` instead of being quietly priced.
 *
 * "Best" is a person's business, so the same graph is searched by minutes and by rupees, and
 * the panel ranks the union by `value` = minutes + ₹/VOT_RPM (VOT_RPM is stated in the UI,
 * not hidden in the code). Journeys that walk more than MAX_WALK_MIN, or that are slower AND
 * dearer than another journey found, are dropped — and `dropped` says how many, so the panel
 * can say it out loud instead of pretending there was nothing to choose from.
 */

import {
  ROUTES, STOPS, nameOf, journeyKm, routeSpeed, busFare, haversine, nearestStops, minutesOfDay,
  serviceWindow,
} from './bus-route.js';
import * as M from './metro-route.js';

export const WALK_KMH = 5;
export const METRO_KMPM = 0.55;
export const CHANGE_MIN = 7;          // metro line change: the planner's own figure
export const BOARD_MIN = 8;           // changing vehicle: alight + walk + board
export const ACCESS_MIN = 2;          // down to the platform, inside the metro headline
export const VOT_RPM = 2;            // `value` treats one saved minute as worth ₹2
export const BUS_KMPM = 0.28;         // the bus planner's fallback speed
export const MAX_WALK_KM = 2.0;       // how far either end is worth walking to a vehicle
export const MAX_LINK_WALK_M = 1200;  // the furthest station↔stop link the data measured
export const MAX_WALK_MIN = 20;       // and no journey is offered that walks more in total
export const MAX_LEGS = 7;            // than this many legs of any kind
export const MAX_MINUTES = 6 * 60;    // a search that only finds a 6-hour journey found nothing

export const walkMin = (km) => Math.max(1, Math.round((km / WALK_KMH) * 60));
const BID = (i) => `b#${i}`;
const MID = (n) => `m#${n}`;

/* ------------------------------------------------------------------ the graph */

let G = null;
export function graphInfo() { return G ? { ...G.size, nodes: G.count } : null; }

/**
 * Build once: ~5.6k nodes, ~90k directed edges, all of it from JSON that is
 * already in memory. Measured at ~100 ms in node and 200-400 ms on a mid-range
 * phone, so it happens on the first search and is kept afterwards.
 */
export function graph() {
  if (G) return G;
  const t0 = Date.now();
  const nid = new Map();          // 'm#AIIMS' → integer
  const label = [];               // integer → 'm#AIIMS'
  const pos = [];                 // integer → {lat, lon}
  const edges = [];               // flat edge list, adjacency holds indices
  const adj = [];                 // integer → [edge index…]
  const vehIds = new Map();       // 'b22A' / 'mYellow Line' → integer (0 = on foot)
  const size = { bus: 0, metro: 0, walk: 0 };

  const idOf = (s) => {
    let i = nid.get(s);
    if (i == null) { i = label.length; nid.set(s, i); label.push(s); adj.push([]); pos.push(null); }
    return i;
  };
  const vehKind = [0];               // 0 on foot · 1 bus · 2 metro, indexed by vehicle id
  const vehOf = (k, kind = 0) => {
    if (!k) return 0;
    let v = vehIds.get(k);
    if (v == null) { vehIds.set(k, v = vehIds.size + 1); vehKind[kind] = kind; vehKind[v] = kind; }
    return v;
  };

  const byName = new Map();
  STOPS.forEach((s, i) => {
    const n = s && s.n != null ? String(s.n) : null;
    if (!n) return;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(i);
  });
  const idxOf = (v) => (typeof v === 'number' ? v : (byName.get(String(v)) || [])[0] ?? null);
  const push = (from, e) => { adj[from].push(edges.push(e) - 1); };

  for (let ri = 0; ri < ROUTES.length; ri++) {
    const r = ROUTES[ri];
    const seq = r && r.s;
    if (!Array.isArray(seq) || seq.length < 2) continue;
    const speed = routeSpeed(r);
    const ids = seq.map(idxOf);
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ids[k], b = ids[k + 1];
      if (a == null || b == null || a === b) continue;
      const { km } = journeyKm(r, k, k + 1);
      if (!(km > 0)) continue;
      const min = speed ? Math.max(1, Math.round((km / speed) * 60)) : Math.max(1, Math.round(km / BUS_KMPM));
      const from = idOf(BID(a)), to = idOf(BID(b));
      pos[from] = pos[from] || STOPS[a]; pos[to] = pos[to] || STOPS[b];
      /* A vehicle id per ROUTES record, not per route number: the DTC data lists a
         number once per direction, and sharing an id across those two records let a
         journey be stitched from the first half of one and the last half of the
         other - a leg that printed stop names from two different rides. Staying on
         a bus is free inside a record; hopping to its return direction is a new
         ticket, which is the only honest reading of this data. Metro keeps its id
         per line name (Blue Line's branches are the same line, and the metro
         planner prices a line change, not a branch change). */
      push(from, { to, from, mode: 'bus', veh: vehOf(`#${ri}`, 1), ri, i0: k, i1: k + 1, km, min, ref: r.r });
      size.bus++;
    }
  }

  const POS = new Map(M.STATIONS.map((s) => [s.n, s]));
  for (const L of M.LINES) {
    for (let i = 0; i + 1 < (L.s || []).length; i++) {
      const a = L.s[i], b = L.s[i + 1];
      const pa = POS.get(a), pb = POS.get(b);
      if (!pa || !pb) continue;
      const km = haversine(pa, pb);
      if (!(km > 0)) continue;
      const min = Math.max(1, Math.round(km / METRO_KMPM));
      const veh = vehOf(`m${L.l}`, 2);
      const ia = idOf(MID(a)), ib = idOf(MID(b));
      pos[ia] = pos[ia] || pa; pos[ib] = pos[ib] || pb;
      push(ia, { to: ib, from: ia, mode: 'metro', veh, line: L.l, colour: L.c, net: L.net || 'DMRC', km, min,
        toName: b, fromName: a });
      push(ib, { to: ia, from: ib, mode: 'metro', veh, line: L.l, colour: L.c, net: L.net || 'DMRC', km, min,
        toName: a, fromName: b });
      size.metro += 2;
    }
  }
  for (const w of M.WALKS || []) {
    if (!POS.has(w.a) || !POS.has(w.b)) continue;
    const km = (w.m || 300) / 1000, min = walkMin(km);
    const ia = idOf(MID(w.a)), ib = idOf(MID(w.b));
    push(ia, { to: ib, from: ia, mode: 'walk', veh: 0, km, min, transfer: true, note: w.note || null, toName: w.b });
    push(ib, { to: ia, from: ib, mode: 'walk', veh: 0, km, min, transfer: true, note: w.note || null, toName: w.a });
    size.walk += 2;
  }
  for (const s of M.STATIONS) {
    for (const b of s.b || []) {
      if (!(b.m > 0) || b.m > MAX_LINK_WALK_M) continue;
      const ids = byName.get(b.n);
      if (!ids || !ids.length) continue;
      const km = +(b.m / 1000).toFixed(3), min = walkMin(km);
      const im = idOf(MID(s.n));
      pos[im] = pos[im] || s;
      for (const i of ids) {
        const ib = idOf(BID(i));
        pos[ib] = pos[ib] || STOPS[i];
        push(im, { to: ib, from: im, mode: 'walk', veh: 0, km, min, stopName: b.n, toName: b.n });
        push(ib, { to: im, from: ib, mode: 'walk', veh: 0, km, min, stopName: s.n, toName: s.n });
        size.walk += 2;
      }
    }
  }

  G = { nid, label, pos, edges, adj, byName, idxOf, idOf, vehKind, vehCount: vehIds.size + 1,
    count: label.length, size, ms: Date.now() - t0 };
  return G;
}

/* --------------------------------------------------------------------- search */

function heap() {
  const a = [];
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; } };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && a[l][0] < a[m][0]) m = l;
      if (r < a.length && a[r][0] < a[m][0]) m = r;
      if (m === i) break;
      const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
    }
  };
  return {
    get size() { return a.length; },
    peek() { return a[0]; },
    push(x) { a.push(x); up(a.length - 1); },
    pop() { const top = a[0], last = a.pop(); if (a.length) { a[0] = last; down(0); } return top; },
  };
}

/** ₹-cost of boarding a bus: the slab the rider actually pays for that hop. */
const busFareOf = (e) => (e.mode === 'bus' ? busFare(e.km) : 0);

/**
 * What an edge costs each search. Minutes and rupees are never mixed inside one
 * search except through `value`, where the rate is the stated VOT_RPM. A walk is
 * 1/1000 of a rupee per minute in the money search: enough to break ties, not
 * enough to make a 9 km wander look free.
 */
function edgeCost(obj, e) {
  /* Money. The fare that gets printed comes from price(), on the published slabs;
     this is what the search ranks by, and it has to behave like a slab does.
     Charging busFare(edge.km) per hop - which is what this used to do - charges a
     30-stop ride thirty times, so the search concluded that walking was the cheap
     option and spent 260,000 states proving it (up to a second per pair, and the
     answer was a wander with a ₹10 ticket at the end of it). Per-kilometre rates
     keep the ranking monotone in distance: ₹0.90/km on a bus and ₹2.20/km on the
     metro are the slope of the real tables (bus ₹5 to 3 km, ₹10 to 8 km, ₹15 to
     12+; metro ₹10 to 2 km rising to ₹54 at 25), ₹0.25 a minute on foot means a
     20-minute walk costs what a ticket costs, which is exactly the trade a rider
     is being asked to make, and the fixed ₹5 for starting another vehicle is the
     floor of the DTC table. */
  if (obj === 'fare') {
    if (e.mode === 'walk') return 0.25 * e.min;
    return e.mode === 'bus' ? 0.9 * e.km : 2.2 * e.km;
  }
  if (obj === 'value') return e.min + (e.mode === 'bus' ? busFareOf(e) : 0) / VOT_RPM
    + (e.mode === 'metro' ? 0.02 : 0);
  return e.min;
}
/* Starting another vehicle costs another ticket on the bus network (₹5 is the
   floor of the DTC table) and a gate on the metro (₹0.50 in the money ranking -
   the metro's distance slab already prices the ride, and the 7-minute figure the
   time ranking uses is the same gate seen in minutes). */
const changeCost = (obj) => (obj === 'fare' ? 5 : obj === 'few' ? 8 : BOARD_MIN);
const vehName = (e) => (e.mode === 'bus' ? `b${e.ri}` : e.mode === 'metro' ? `m${e.line}` : '');

/**
 * Dijkstra over (node, vehicle) states: staying on the same bus or the same
 * line is free, boarding anything else costs a change. A walk keeps the rider
 * "on" the vehicle they came off — otherwise walking off a platform and back on
 * would dodge the transfer penalty, and the search happily found that route.
 *
 * @param sources Map<int, {min}>  where the rider can start, with its walk cost
 * @param targets Set<int>        where they can get out; the search stops once
 *                                every one is settled and the heap can no longer
 *                                beat the best of them by more than a 15% slack
 */
/**
 * A* over the same graph. The heuristic is the straight-line distance to the goal
 * divided by the fastest thing on the network (the metro's 0.55 km/min), which no
 * real path can beat — so it prunes the map without ever cutting the answer. For
 * the money search the heuristic is 0, because rupees do not care about distance.
 */
export function search(sources, { mask = 'all', obj = 'min', targets = null, exits = null, goal = null,
  slack = 0, cap = 260000 } = {}) {
  const g = graph();
  /* The heuristic is the straight line to the goal priced at the cheapest thing
     that could ever carry you: 0.55 km/min on the metro for a search in minutes,
     and ₹0.90/km - the slope of the DTC slab, the lowest fare per kilometre on
     the network - for the search in rupees. Both are lower bounds, so neither can
     cut an answer; before the second one existed, the money search was plain
     uniform-cost and answered "is there a ₹12 way?" by walking the entire city
     within ₹12 of here (260,000 states, ~1.9 s on a cross-city pair). */
  const HRATE = obj === 'fare' ? 0.9 : 1 / METRO_KMPM;
  const H = goal && goal.lat != null
    ? (node) => { const p = g.pos[node]; return p ? haversine(p, goal) * HRATE : 0; }
    : () => 0;
  const NV = g.vehCount;
  const dist = new Map();
  const par = new Map();
  /* `arrived` marks nodes whose cheapest state has been taken off the queue. A node
     is reached on foot and by train, and those are different states that lead to
     different places, so nothing is settled per node any more - `settled` used to be,
     and a footpath arriving first is how a direct metro ride came back as "nothing
     found". `rideAt` is written while edges are relaxed instead: the cheapest state
     that reached this node *on a vehicle*, which is the only chain a rider can be
     shown, and it has to be recorded before the queue runs out, not afterwards. */
  const arrived = new Set();
  const rideAt = new Map();
  const q = heap();
  const want = targets && targets.size ? new Set(targets) : null;
  const CC = changeCost(obj);
  const KIND = g.vehKind;
  const VX = -7;                       // the virtual node every finished journey ends at
  let bestTarget = Infinity, done = null;
  const atKey = new Map();          // node → the state key that settled it
  for (const [node, s] of sources) {
    const key = node * NV;
    dist.set(key, s.min);
    par.set(key, { start: s });
    q.push([s.min + H(node), s.min, key]);
  }
  let pops = 0;
  const CAP = cap;                           // a search that needs more than this found nothing good
  while (q.size && pops++ < CAP) {
    const [f, d, key] = q.pop();
    if (dist.get(key) !== d) continue;
    const node = Math.floor(key / NV);
    if (!arrived.has(node) || node === VX) {
      arrived.add(node);
      atKey.set(node, key);
      if (node === VX) {
        done = d;                                   // a whole journey, walks included
        /* `slack` is how much worse than the best a rival may be and still be
           worth returning. A pure-mode champion needs none — it exists to be the
           best of its mode. The mixed search takes a few minutes, because a rider
           comparing two ways through the city wants the second choice too. */
        const next = q.peek();
        if (!next || slack <= 0 || next[0] > done + slack) break;
      }
      if (want && want.has(node)) {
        want.delete(node);
        if (d < bestTarget) bestTarget = d;
        /* an unsettled heap front that cannot beat the best settled exit means the
           answer is complete for minutes; money keeps a stated slack so the second
           and third cheapest exits can still be seen */

      }
    }
    if (node === VX) continue;                  // the journey ended; nothing to relax
    const prevVeh = (par.get(key) || {}).veh || 0;
    for (const ei of g.adj[node] || []) {
      const e = g.edges[ei];
      if (mask !== 'all' && e.mode !== 'walk' && e.mode !== mask) continue;
      const nv = e.veh;
      let add = edgeCost(obj, e);
      /* station-to-station on the metro costs what the metro planner charges for it
         (CHANGE_MIN); anything else is a real boarding (BOARD_MIN). Pricing the two
         the same is what made a two-change ride look worse than it is, and the
         search then never offered the route the metro tool itself would find. */
      if (nv && prevVeh && nv !== prevVeh) {
        add += (KIND[nv] === 2 && KIND[prevVeh] === 2) ? (obj === 'fare' ? 0.5 : CHANGE_MIN) : CC;
      } else if (nv && !prevVeh && KIND[nv] === 2 && obj !== 'fare' && par.get(key)?.start) {
        /* the first metro boarding of a journey: the walk to the station is priced,
           what it costs to get through the gate and onto the platform is not, and
           `price` charges ACCESS_MIN for exactly that - so the search does too,
           rather than ranking journeys on a cheaper number than the one printed */
        add += ACCESS_MIN;
      }
      const nk = e.to * NV + (nv || prevVeh);          // a walk keeps the vehicle on record
      const nd = d + add;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        par.set(nk, { prev: key, ei, d: nd, veh: nv || prevVeh });
        q.push([nd + H(e.to), nd, nk]);
      }
      /* the cheapest arrival at this node that was made on something that moves.
         Its cost is read back from `dist` when the chain is taken apart, so it does
         not have to be final here - only the predecessor chain does. */
      if (nv || prevVeh) {
        const seen = rideAt.get(e.to);
        if (!seen || nd < (dist.get(seen) ?? Infinity)) rideAt.set(e.to, nk);
      }
      /* Getting off is not free: the walk from the stop to the place you asked for
         belongs to the journey, so it is priced here and not hoped for afterwards.
         Without this the search happily stopped one station early. */
      /* A journey has to contain a ride. Without that rule the very first thing
         the search can finish is "walk to a station, walk to a stop near your
         destination" — free, so it settles the sink, and the search stops there
         without ever looking at the metro. */
      if (exits && exits.has(e.to) && (nv || prevVeh)) {
        const ex = exits.get(e.to);
        const vk = VX * NV;
        const vd = nd + (obj === 'fare' ? 0.25 * ex.min : ex.min);   // the same ₹/min as any other walk
        if (vd < (dist.get(vk) ?? Infinity)) {
          dist.set(vk, vd);
          par.set(vk, { prev: nk, ei: null, d: vd, veh: 0, exit: e.to });
          q.push([vd, vd, vk]);
        }
      }
    }
  }
  return { arrived, rideAt, atKey, par, dist, pops, g, states: dist.size,
    capped: pops >= CAP };
}

/** Hop indices that reached `node`, oldest first. */
/** The edge chain behind one state key, oldest edge first. */
function chainToKey(run, key) {
  if (key == null) return null;
  const out = [];
  let cur = key;
  while (cur != null) {
    const l = run.par.get(cur);
    if (!l) break;
    if (l.ei != null) out.push(l.ei);
    cur = l.prev;
  }
  return out.length ? out.reverse() : null;
}


/**
 * Turn hop indices into legs: consecutive hops of one vehicle become one leg,
 * and that leg is then priced over its whole span the way the planners price it
 * (journeyKm for the full i0→i1, the route's own speed), so a leg shown here
 * reads the same as the same leg in the bus or metro tool.
 */
export function legsFromChain(run, chain) {
  const g = run ? run.g : graph();
  const legs = [];
  const E = (i) => g.edges[i];
  /* a node id → the name a rider reads. m# labels hold the station name, b# labels
     hold an index into STOPS; nameOf() wants that index raw, so resolving the stop
     first and handing it over produced "[object Object]" on every walk leg. */
  const nameOfNode = (id) => {
    const lab = g.label[id] ?? '';
    if (!lab) return null;
    return lab.startsWith('m#') ? lab.slice(2) : (STOPS[+lab.slice(2)]?.n ?? nameOf(+lab.slice(2)));
  };
  let i = 0;
  while (i < chain.length) {
    const e = E(chain[i]);
    if (e.mode === 'walk') {
      let j = i;
      while (j + 1 < chain.length && E(chain[j + 1]).mode === 'walk') j++;
      const span = chain.slice(i, j + 1).map(E);
      const km = +span.reduce((s, x) => s + x.km, 0).toFixed(2);
      const min = span.reduce((s, x) => s + x.min, 0);
      const to = nameOfNode(span[span.length - 1].to);
      const from = nameOfNode(span[0].from);
      legs.push({ kind: 'walk', text: `Walk to ${to || 'the next stop'}`, km, min, from, to,
        note: span.find((x) => x.note)?.note || (span.find((x) => x.stopName) || {}).stopName || null,
        metres: Math.round(km * 1000) });
      i = j + 1;
      continue;
    }
    /* Merge only a genuinely continuous run: same vehicle id, and for a bus each
       next hop starts where the previous one ended. */
    let j = i;
    while (j + 1 < chain.length) {
      const nx = E(chain[j + 1]);
      if (nx.veh !== e.veh || nx.mode !== e.mode) break;
      if (e.mode === 'bus' && nx.i0 !== E(chain[j]).i1) break;
      if (e.mode === 'metro' && (nx.net !== e.net || nx.line !== e.line)) break;
      j++;
    }
    const span = chain.slice(i, j + 1).map(E);
    if (e.mode === 'bus') {
      const r = ROUTES[e.ri];
      const i0 = e.i0, i1 = span[span.length - 1].i1;
      const { km, shape } = journeyKm(r, i0, i1);
      const speed = routeSpeed(r);
      const minutes = Math.max(3, speed ? Math.round((km / speed) * 60) : Math.round(km / BUS_KMPM));
      const fwd = i1 >= i0;
      const path = fwd ? r.s.slice(i0, i1 + 1) : r.s.slice(i1, i0 + 1).reverse();
      const nm = (v) => (typeof v === 'number' ? STOPS[v]?.n : v?.n ?? v) ?? '';
      const names = path.map(nm);
      const win = serviceWindow(r);
      const leg = {
        kind: 'bus', ref: r.r, from: names[0], to: names[names.length - 1], count: Math.abs(i1 - i0),
        km: +km.toFixed(2), minutes, ri: e.ri, i0: Math.min(i0, i1), i1: Math.max(i0, i1),
        boardFrom: fwd ? 'start' : 'end', dir: `${r.f} → ${r.t}`, path, names, exact: !!shape,
        fare: busFare(km), fareAc: busFare(km, true), trips: r.tt?.k ?? (r.tt?.d?.length || null),
        first: win ? win[0] : null, last: win ? win[1] : null, timed: !!(r.tt?.d?.length),
      };
      /* the shape the bus planner returns for one ride, so the journey clock and
         the trip track can be handed a combo leg unchanged — they read
         leg.bus.legs[0] and nothing else about the old planBus result.
         It is a copy on purpose: pointing back at `leg` would make the option a
         circular object, and anything that stringifies it — saving it, diffing it,
         printing it — would throw. */
      const { bus: _busless, ...once } = leg;
      leg.bus = { legs: [once], changes: 0, minutes, km: leg.km, fare: leg.fare, fareAc: leg.fareAc,
        stops: leg.count, shape: leg.exact };
      legs.push(leg);
    } else {
      const km = +span.reduce((s, x) => s + x.km, 0).toFixed(2);
      legs.push({
        kind: 'metro', line: e.line, colour: e.colour, net: e.net, km,
        from: nameOfNode(span[0].from), to: nameOfNode(span[span.length - 1].to),
        count: span.length, minutes: Math.max(1, Math.round(km / METRO_KMPM)),
        stops: [nameOfNode(span[0].from), ...span.map((x) => nameOfNode(x.to))],
      });
    }
    i = j + 1;
  }
  return legs;
}

/** Minutes and rupees for a leg list, on the planners' own terms. */
export function price(legs, { ac = false, holiday = false, smartcard = false } = {}) {
  let minutes = 0, fare = 0, walk = 0, walkKm = 0, km = 0, metroKm = 0, changes = 0, extra = 0;
  let prevVeh = null, prevKind = null, chainKm = 0, chainRuns = 0, chainFare = 0;
  const vehOfLeg = (l) => (l.kind === 'bus' ? `B${l.ref}` : `M${l.line}`);
  const closeChain = () => {
    if (chainRuns > 0) {
      minutes += Math.round(chainKm / METRO_KMPM) + (chainRuns - 1) * CHANGE_MIN + ACCESS_MIN;
      fare += chainFare;
      metroKm += chainKm;
      chainKm = 0; chainRuns = 0; chainFare = 0;
    }
  };
  for (const l of legs) {
    if (l.kind === 'walk') { minutes += l.min || 0; walk += l.min || 0; walkKm += l.km || 0; continue; }
    const v = vehOfLeg(l);
    if (prevVeh && prevVeh !== v) {
      changes++;
      /* a change of metro line is not a new boarding: the chain formula below
         already charges CHANGE_MIN for it, and charging twice would bury the very
         routes with interchanges that this planner exists to find */
      if (!(prevKind === 'metro' && l.kind === 'metro')) extra += BOARD_MIN;
    }
    if (l.kind === 'metro') {
      chainRuns++; chainKm += l.km || 0;
      chainFare = M.fareFor(Math.max(chainKm, 0), { holiday, smartcard });
      km += l.km || 0;
      prevVeh = v; prevKind = l.kind;
      continue;
    }
    closeChain();
    minutes += l.minutes || 0;
    /* a second bus is a second ticket: this dataset publishes no free transfer,
       so it is charged per ride and the fine print says so */
    fare += ac ? l.fareAc : l.fare;
    km += l.km || 0;
    prevVeh = v; prevKind = l.kind;
  }
  closeChain();
  minutes += extra;
  return {
    minutes: Math.round(minutes), fare, changes, km: +km.toFixed(2), metroKm: +metroKm.toFixed(2),
    walkMin: walk, walkKm: +walkKm.toFixed(2),
    rides: legs.filter((l) => l.kind !== 'walk').length,
  };
}

/* ------------------------------------------------------------ the two ends */

const ENTRIES = 6;

/**
 * The nodes a rider can start or finish at, each with the walk that reaches it.
 * Metro stations come from metro-route's own nearestStations and bus stops from
 * bus-route's nearestStops, so "8 min walk" means the same distance everywhere
 * in this app. A place that IS a station or a stop is free to enter at.
 */
function endsAt(place, wantPos = false) {
  const g = graph();
  const out = new Map();
  const put = (idStr, km) => {
    if (!(km >= 0) || km > MAX_WALK_KM) return;
    const node = g.nid.get(idStr);
    if (node == null) return;
    const min = walkMin(km);
    const cur = out.get(node);
    if (!cur || min < cur.min) out.set(node, { node, min, km: +km.toFixed(2), id: idStr });
  };
  /* A place named after a station or a stop is treated as standing *at* it - but
     only when nothing says otherwise. When the caller also handed over coordinates
     that are 4 km from that station, calling the gap a 0 km walk invented a journey
     (and the geometric check further down rightly threw it away, leaving the rider
     with no answer at all). So the name shortcut measures the real gap and lets
     `put` reject it if it is more than someone will walk. */
  const named = (idStr) => {
    const node = g.nid.get(idStr);
    if (node == null) return;
    const p = g.pos[node];
    const km = p && place.lat != null && place.lon != null ? +haversine(p, place).toFixed(2) : 0;
    put(idStr, km);
  };
  const isMetroName = place.kind === 'metro' || (place.kind == null && nameIndex().get(place.n)?.kind === 'metro');
  if (place.lat == null || place.lon == null) {
    if (isMetroName) named(MID(place.n));
    else for (const i of (g.byName.get(place.n) || []).slice(0, 4)) named(BID(i));
    return out;
  }
  for (const s of M.nearestStations(place.lat, place.lon, ENTRIES) || []) put(MID(s.n), s.km);
  for (const s of nearestStops(place.lat, place.lon, ENTRIES * 2 + 4) || []) {
    const i = s.i != null ? s.i : (g.byName.get(s.n) || [])[0];
    if (i != null) put(BID(i), s.km);
  }
  if (isMetroName) named(MID(place.n));
  if (place.kind === 'bus') for (const i of (g.byName.get(place.n) || []).slice(0, 4)) named(BID(i));
  return out;
}

export const KIND_OF = (legs) => {
  const metro = legs.some((l) => l.kind === 'metro'), bus = legs.some((l) => l.kind === 'bus');
  return metro && bus ? 'Metro + Bus' : metro ? 'Metro' : 'Bus';
};
/* Two searches reaching the same station and then walking the same last stretch are
   the same journey, so the signature is the rides. Keeping the walk out of it is
   what stops "Metro, 23 min" being offered three times over. */
const sigOf = (legs) => legs.filter((l) => l.kind !== 'walk')
  .map((l) => (l.kind === 'bus' ? `B${l.ref}:${l.from}>${l.to}` : `M${l.line}:${l.from}>${l.to}`)).join('|');

const MEMO = new Map();
const MEMO_MAX = 16;

/**
 * plan(from, to, opts) → the journeys worth showing, best first.
 *
 * Four goal-directed searches over the same graph: the mixed field by minutes and
 * by money, plus a pure champion of each mode by minutes, so a mixed route has to
 * beat a pure one instead of merely being offered beside it. `value` then ranks
 * what those four found.
 *
 * @param opts.ac        price bus rides as AC
 * @param opts.holiday   opts.smartcard  handed to the DMRC slab
 * @param opts.atMin     minutes of the day for the wait model (default: now)
 * @param opts.only      'all' | 'mixed' | 'metro' | 'bus'
 */
/**
 * A place may be given as a name or as { n, kind, lat, lon }. A name is looked up in
 * the metro stations first and then in the bus stops, the same order the panels use.
 * Resolving here rather than in each caller matters: the cache key is built from the
 * place, and a bare string has no `.n`, so every named pair used to collapse onto the
 * same memo entry - one answer handed out for every origin and destination.
 */
/** Every name either dataset knows, once, in both spellings: exact and squashed.
 *    Squashing (lowercase, no spaces or punctuation) is what lets a rider who typed
 *    'Dwarka Sector-10' land on 'Dwarka Sector 10' instead of getting no answer.
 *   `M.isStation` is not used: its index is built from the line records and does not
 *    know every station in the station table. */
let NAMES = null;
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function nameIndex() {
  if (NAMES) return NAMES;
  const map = new Map();
  const add = (name, rec) => {
    if (!name) return;
    if (!map.has(name)) map.set(name, rec);
    const key = `~${normName(name)}`;
    if (normName(name) && !map.has(key)) map.set(key, rec);
  };
  for (const s of M.STATIONS || []) add(s.n, { n: s.n, kind: 'metro', lat: s.lat, lon: s.lon });
  for (let i = 0; i < STOPS.length; i++) {
    const s = STOPS[i];
    if (s && s.n) add(s.n, { n: s.n, kind: 'bus', lat: s.lat, lon: s.lon, i });
  }
  NAMES = map;
  return map;
}

/**
 * A place, from a string or from an object, with coordinates whenever we have them.
 * An object that gives a name but no position is filled in from the tables too - a
 * rider who picks 'Hauz Khas' out of the list knows the station, and answering as
 * though its position were unknown would be a worse journey, not a safer one.
 */
function resolve(p) {
  if (p == null) return p;
  if (typeof p === 'object') {
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
    const hit = p.n ? (nameIndex().get(p.n) || nameIndex().get(`~${normName(p.n)}`)) : null;
    if (hit && (!p.kind || p.kind === hit.kind)) return { ...hit, ...p, lat: hit.lat, lon: hit.lon };
    return p;
  }
  if (typeof p !== 'string') return p;
  const name = p.trim();
  if (!name) return { n: name };
  const hit = nameIndex().get(name) || nameIndex().get(`~${normName(name)}`);
  if (hit) return { ...hit };
  return { n: name };
}

export function plan(rawFrom, rawTo, opts = {}) {
  const fromPlace = resolve(rawFrom), toPlace = resolve(rawTo);
  const unknown = [fromPlace, toPlace].filter((q) => q && typeof q === 'object' && !Number.isFinite(q.lat));
  if (unknown.length) {
    const who = unknown.map((q) => `"${q.n}"`).join(' and ');
    return { options: [], note: `${who} ${unknown.length > 1 ? 'are' : 'is'} not a place in the map `
      + `we ship, so there is nothing to plan ${unknown.length > 1 ? 'between them' : 'from there'}. `
      + `Pick a station or stop from the list instead.` };
  }
  const key = [fromPlace?.n, toPlace?.n, fromPlace?.kind, toPlace?.kind, opts.only, opts.ac,
    opts.holiday, opts.smartcard, opts.atMin == null ? 'now' : Math.round(opts.atMin / 5) * 5].join('\u0001');
  const hit = MEMO.get(key);
  if (hit) return hit;
  const made = planSearch(fromPlace, toPlace, opts);
  MEMO.set(key, made);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
  return made;
}

/* Anomalies are never swallowed: a candidate that fails a geometric check is
   dropped and written down, so `verify:trip` can insist there are none and a
   probe can print what the search actually tried to claim. */
const ANOMALIES = [];
const anomaly = (where, text) => {
  if (ANOMALIES.length < 24) ANOMALIES.push(`${where}: ${text}`);
};

function planSearch(fromPlace, toPlace, opts) {
  const g = graph();
  const src = endsAt(fromPlace);
  const dst = endsAt(toPlace);
  if (!src.size || !dst.size) {
    /* A pin off the map search can genuinely sit further from every published stop
       than anyone will walk. Saying "nothing is within a walk" is true and useless;
       saying how far the nearest one is, and what the cap is, gives the traveller
       the next move - walk there, or pick that stop as the start. */
    const away = [];
    for (const [place, ends] of [[fromPlace, src], [toPlace, dst]]) {
      if (ends.size || place.lat == null) continue;
      const nb = [
        ...(M.nearestStations(place.lat, place.lon, 1) || []),
        ...(nearestStops(place.lat, place.lon, 1) || []),
      ].sort((x, y) => x.km - y.km)[0];
      away.push(nb
        ? `"${place.n}" is ${(+nb.km).toFixed(1)} km from its nearest published stop or station `
          + `(${nb.n || 'unnamed'}), and this planner never plans more than ${MAX_WALK_KM} km on foot`
        : `"${place.n}" is outside the published network entirely`);
    }
    return { options: [], note: 'nothing is within a walk of one of those places'
      + (away.length ? ` - ${away.join('; ')}. Pick that stop as the end of the journey, or walk to it.` : '') };
  }
  if (fromPlace.n === toPlace.n) return { options: [], note: 'same place at both ends' };
  const targets = new Set(dst.keys());
  /* Exact searches, not a wide net: each is optimal for its own metric and stops
     the moment its answer settles (~1-400 ms each). Diversity of alternatives comes
     from asking the graph different questions - minutes, money, value - never from a
     loose bound, because "within six minutes of the best" in a dense city is the
     whole graph. A bus-network-only champion is left out of the combined view on
     purpose: the bus sub-graph is 82,000 edges wide, that one search costs 0.5-1.9 s
     on its own, and the two searches a rider is looking at in the combined view
     (all/min and all/fare) already return a bus whenever a bus wins. 'Bus only' asks
     the exhaustive question and gets it. */
  const runs = opts.only === 'metro' ? [['metro', 'min'], ['metro', 'fare'], ['metro', 'value']]
    : opts.only === 'bus' ? [['bus', 'min'], ['bus', 'fare'], ['bus', 'value']]
      : opts.only === 'mixed' ? [['all', 'min'], ['all', 'fare'], ['all', 'value']]
        : [['all', 'min'], ['all', 'fare'], ['all', 'value'], ['metro', 'min'], ['metro', 'fare']];

  const found = new Map();
  const stats = [];
  let pops = 0;
  for (const [mask, obj] of runs) {
    const slack = 0;
    /* Every rejection is counted and published. A planner that quietly throws away
       its own candidates is how a correct metro ride vanished behind a fast-looking
       bus leg, so each reason a candidate was not shown rides along in `stats`,
       which the panel prints in its fine print and verify:trip asserts on. */
    const rej = { noArrival: 0, noChain: 0, noRide: 0, geometry: 0, budget: 0, legs: 0, walk: 0, kept: 0 };
    const t0 = Date.now();
    const run = search(src, { mask, obj, targets, exits: dst, slack,
      cap: obj === 'fare' && mask !== 'all' ? 120000 : 260000,
      goal: toPlace.lat != null ? toPlace : null });
    pops += run.pops;
    const st = { mask, obj, ms: Date.now() - t0, pops: run.pops, capped: run.capped };
    for (const [node, end] of dst) {
      /* only an arrival on something that moves is a journey; the footpath state at
         this node belongs to the walk from the origin, not to the answer */
      const stateKey = run.rideAt.get(node);
      if (stateKey == null) { rej.noArrival++; continue; }
      /* the run has to have priced this node, or the chain is a rumour */
      if (!run.arrived.has(node) && run.dist.get(stateKey) == null) { rej.noArrival++; continue; }
      const chain = chainToKey(run, stateKey);
      if (!chain) { rej.noChain++; continue; }
      const legs = legsFromChain(run, chain);
      if (!legs.length || !legs.some((l) => l.kind === 'bus' || l.kind === 'metro')) { rej.noRide++; continue; }
      /* the search starts where the rider can walk to, which is not where they
         stand: that first walk is the first leg of the journey, not a freebie */
      /* Both ends of a journey are walks, and the chain carries part of them: the
         edges that get from the entry point to the first vehicle, and from the last
         vehicle to the exit point. They are folded into one leg on each side, so
         the minutes on screen are the minutes the search paid - which is the whole
         reason a rider can trust the number. */
      const s0 = src.get(run.g.edges[chain[0]].from) || { min: 0, km: 0 };
      let headKm = 0, headMin = 0;
      while (legs.length && legs[0].kind === 'walk') { const w = legs.shift(); headKm += w.km || 0; headMin += w.min || 0; }
      const entryMin = Math.round(s0.min) + headMin, entryKm = +((s0.km || 0) + headKm).toFixed(2);
      if (entryMin > 0) {
        const lab = run.g.label[run.g.edges[chain[0]].from] ?? '';
        const boardAt = lab.startsWith('m#') ? lab.slice(2) : (STOPS[+lab.slice(2)]?.n ?? lab);
        legs.unshift({ kind: 'walk', text: `Walk to ${boardAt}`, km: entryKm, min: entryMin,
          from: fromPlace.n, to: boardAt, metres: Math.round(entryKm * 1000) });
      }
      /* The walk from where the rider stepped off to the place they asked for is a
         leg of the journey and always drawn as one. It used to be skipped when the
         chain happened to end in a walk - but a walk between two platforms is not
         the way home, and skipping it made the printed minutes smaller than the cost
         the search ranked by. */
      let tailKm = 0, tailMin = 0;
      while (legs.length && legs[legs.length - 1].kind === 'walk') {
        const w = legs.pop(); tailKm += w.km || 0; tailMin += w.min || 0;
      }
      const exitMin = Math.round(end.min) + tailMin, exitKm = +(end.km + tailKm).toFixed(2);
      if (exitMin > 0) {
        legs.push({ kind: 'walk', text: `Walk to ${toPlace.n}`, km: exitKm, min: exitMin,
          from: legs[legs.length - 1]?.to ?? null, to: toPlace.n, metres: Math.round(exitKm * 1000) });
      }
      /* Geometry, on both ends. The walk legs are drawn from the entry and exit
         points the search used, so if the chain's last stop is not where this
         candidate believes it is, the walk would be a lie - a 0.5 km "walk"
         between places fourteen kilometres apart is exactly what one such bug
         looked like. A candidate whose arithmetic does not match the map is
         dropped and named, never shown. */
      const firstNode = run.g.edges[chain[0]].from;
      if (s0 && fromPlace.lat != null) {
        const true0 = run.g.pos[firstNode] ? haversine(run.g.pos[firstNode], fromPlace) : null;
        if (true0 != null && Math.abs(true0 - s0.km) > 0.35) {
          anomaly('origin walk', `${run.g.label[firstNode]} is ${true0.toFixed(2)} km from ${fromPlace.n}, `
            + `the entry list said ${s0.km}`);
          rej.geometry++;
          continue;
        }
      }
      if (end.min > 0 && toPlace.lat != null) {
        const lastNode = run.g.edges[chain[chain.length - 1]].to;
        const true1 = run.g.pos[lastNode] ? haversine(run.g.pos[lastNode], toPlace) : null;
        if (true1 != null && Math.abs(true1 - end.km) > 0.35) {
          anomaly('exit walk', `${run.g.label[lastNode]} is ${true1.toFixed(2)} km from ${toPlace.n}, `
            + `the exit list said ${end.km}`);
          rej.geometry++;
          continue;
        }
      }
      const p = price(legs, opts);
      if (!(p.minutes > 0) || p.minutes > MAX_MINUTES) { rej.budget++; continue; }
      if (legs.length > MAX_LEGS) { rej.legs++; continue; }
      if (p.walkMin > MAX_WALK_MIN) { rej.walk++; continue; }
      const sig = sigOf(legs);
      /* `stateKey`, never `node * NV`: the price to remember is the price of the
         chain being shown, and the veh-0 state at a node is a different journey.
         The exit walk is added because the state is priced up to the stop, while the
         rider's journey ends at the place they asked for - the same thing the sink
         transition charges. Only minute-denominated runs can be compared with the
         minutes on screen, so a fare run keeps `searchCost` null. */
      const ride = run.dist.get(stateKey);
      const paid = ride == null || obj === 'fare' || obj === 'value'
        ? null : Math.round(ride + end.min);
      const rec = { sig, legs, mask, obj, ...p, mix: KIND_OF(legs), d: ride ?? 0, searchCost: paid };
      const prev = found.get(sig);
      if (!prev || rec.minutes < prev.minutes || (rec.minutes === prev.minutes && rec.fare < prev.fare)) {
        found.set(sig, rec);
      }
      rej.kept++;
    }
    st.ms = Date.now() - t0;            // timed over the whole run, extraction included
    stats.push({ ...st, ...rej });
  }

  let list = [...found.values()];
  if (opts.only === 'mixed') list = list.filter((x) => x.mix === 'Metro + Bus');
  for (const x of list) {
    const other = [...new Set(x.legs.filter((l) => l.kind === 'metro' && l.net && l.net !== 'DMRC')
      .map((l) => l.line))];
    if (other.length) {
      x.separateTicket = other;
      x.fareNote = `${other.join(' + ')} sell their own ticket — the ₹${x.fare} shown prices the DMRC `
        + 'part with the DMRC slab and the bus rides with the DTC slabs, which is all this data can say.';
    }
  }

  /* Pareto: anything slower AND dearer than a journey already found is dropped */
  list.sort((a, b) => a.minutes - b.minutes || a.fare - b.fare);
  const kept = [], dropped = [];
  for (const x of list) {
    const beaten = kept.some((k) => k.minutes <= x.minutes && k.fare <= x.fare
      && (k.minutes < x.minutes || k.fare < x.fare));
    if (beaten) dropped.push(x); else kept.push(x);
  }
  for (const x of kept) {
    x.value = +(x.minutes + x.fare / VOT_RPM).toFixed(1);
    x.detail = metroDetail(x.legs, opts.atMin);
    x.icon = null;
    x.mode = x.mix;
  }
  kept.sort((a, b) => a.value - b.value);
  /* A search that ran out of room is said so: the list is then "the best it saw",
     which is a different claim from "the best there is", and the fine print on the
     panel prints whichever of the two it is. */
  const capped = stats.filter((s) => s.capped).map((s) => `${s.mask} ${s.obj}`);
  return {
    options: kept, dropped: dropped.length, tried: found.size, pops, stats, capped,
    anomalies: ANOMALIES.slice(),
    graphSize: g.size, graphMs: g.ms, ends: { from: src.size, to: dst.size },
    note: capped.length ? `The ${capped.join(' and ')} search ran out of room, so this is the best it saw.` : null,
  };
}

/** The published waits and the last-train guard, in the shape the journey clock reads. */
export function metroDetail(legs, atMin) {
  const rides = legs.filter((l) => l.kind === 'metro');
  if (!rides.length) return null;
  const at = (atMin != null ? atMin : minutesOfDay()) % 1440;
  const first = rides[0];
  const info = M.lineInfo(first.line, at);
  const wait = rides.map((l) => {
    const i2 = M.lineInfo(l.line, at);
    const h = i2 && i2.headway;
    return h ? { line: l.line, lo: h[0], hi: h[1], peak: i2.peak, mid: Math.round((h[0] + h[1]) / 2) } : null;
  }).filter(Boolean);
  const km = +rides.reduce((s, l) => s + (l.km || 0), 0).toFixed(2);
  const minutes = Math.round(km / METRO_KMPM) + (rides.length - 1) * CHANGE_MIN + ACCESS_MIN;
  const nextIn = wait.length ? Math.max(2, wait[0].mid) : 5;
  const board = first.stops && first.stops[0] ? first.stops[0] : first.from;
  const lt = M.lastTrainAt ? M.lastTrainAt(first.line, board, at, first.to) : null;
  const open = !info || info.open !== false;
  return {
    legs: rides.map((l) => ({ line: l.line, colour: l.colour, from: l.from, to: l.to, km: l.km,
      stops: l.stops || [l.from, l.to] })),
    line: first.line, minutes, minutesWithWait: minutes + nextIn, km,
    fare: M.fareFor(km, {}), slab: M.fareSlabOf ? M.fareSlabOf(km) : null,
    wait, nextIn, arriveMin: at + minutes + nextIn, changes: rides.length - 1,
    canMakeIt: open && (!lt || lt.ok !== false),
    lastTrain: lt ? lt.at : null, lastTrainFrom: lt ? lt.from : null, lastTrainEst: true,
    lastTrainAt: board, lastTrainToward: lt ? lt.toward : null, lastRunMin: lt ? lt.run : null,
    closed: info ? info.open === false : false,
    separateTicket: rides.filter((l) => l.net && l.net !== 'DMRC').map((l) => l.line),
  };
}
