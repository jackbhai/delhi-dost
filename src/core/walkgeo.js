/**
 * walkgeo.js — the app's own feet-on-the-ground layer: real footpath distance
 * for the two walks every journey begins and ends with, a real address for a
 * spot the rider picked on the map, and the projection maths both of them and
 * the offline sketch share.
 *
 * Why it exists at all: the planner searches tens of thousands of edges per
 * query, and the only distance that is computable that often is the straight
 * line between coordinates - which the app has always said ("estimated at
 * 5 km/h"). A rider, though, asked for *exactly* how far they will walk. So
 * after the search has ranked the handful of journeys worth showing, each one's
 * entry and exit walk is measured once along the actual pedestrian way network,
 * and the number on screen becomes a measurement instead of a guess. The
 * search itself never waits on a network - a stalled routing server can only
 * ever leave the estimates in place, never break a plan.
 *
 * Two independent operators, both keyless, both measured browser-CORS-open
 * (they send access-control-allow-origin: * to requests carrying an Origin
 * header - re-measured here 2026-09, same day as the mapsearch providers):
 *      pedestrian graph: footways only, 4-5 km/h realistic durations.
 *   2. router.project-osrm.org - the OSRM demo box, a different machine but
 *      really the road graph: its metres are a street route, so they arrive
 *      labelled by network, never passed off as a footpath.
 * If both refuse, the leg keeps its straight-line number and the panel says so.
 * Durations are never taken from either server - walking minutes stay the
 * app's own 5 km/h, so the number on screen means the same thing however it
 * was obtained.
 *
 * The reverse lookup (pin -> address) rides with it: Nominatim, same CORS
 * measurement as its forward cousin in mapsearch.js. It only ever names a spot
 * the app already has exact coordinates for - a failure to name is a missing
 * label, never a missing position.
 */

const R = 6371000, D2R = Math.PI / 180;
const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Both directions of the same walk must share one answer. */
export const pairKey = (a, b) =>
  [`${a.lat.toFixed(4)},${a.lon.toFixed(4)}`, `${b.lat.toFixed(4)},${b.lon.toFixed(4)}`].sort().join(';');

const HOSTS = [
  { base: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot', via: 'footpaths' },
  { base: 'https://router.project-osrm.org/route/v1/foot', via: 'streets' },
];
const TTL_OK = 30 * 60e3, TTL_NO = 5 * 60e3, CACHE_MAX = 240;
const cache = new Map();
const health = { fails: 0, restUntil: 0 };   // shared by every leg of every rider here
const PATH_MAX = 160;                        // shape points kept for the drawn line

const getPath = (url) =>
  fetch(url, { signal: AbortSignal.timeout(6500) })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

/**
 * Measure one walk along a real network. Resolves { km, min, metres, via, path }
 * or null; never throws. `fetchImpl` exists so the offline test can hand it a
 * canned server - the shipped path is the global fetch.
 */
export async function osrmWalk(a, b, fetchImpl = globalThis.fetch) {
  if (!ok(a) || !ok(b)) return null;
  const k = pairKey(a, b);
  const c = cache.get(k);
  if (c && Date.now() - c.t < (c.fix ? TTL_OK : TTL_NO)) return c.fix;
  if (Date.now() < health.restUntil) return null;
  for (const h of HOSTS) {
    try {
      const d = await fetchImpl(`${h.base}/${a.lon},${a.lat};${b.lon},${b.lat}`
        + `?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(6500) });
      if (!d.ok) throw new Error(`HTTP ${d.status}`);
      const j = await d.json();
      const rt = j.code === 'Ok' && j.routes && j.routes[0];
      if (!rt || !(rt.distance > 1)) throw new Error('no route back');
      const km = Math.round(rt.distance) / 1000;
      let path = (rt.geometry && rt.geometry.coordinates || []).map((c2) => [c2[1], c2[0]]);
      if (path.length > PATH_MAX) {                     // long blocks: thin the line, keep its ends
        const step = Math.ceil(path.length / PATH_MAX);
        path = path.filter((_, i) => i % step === 0);
        if (path[path.length - 1] !== undefined && (rt.geometry.coordinates[rt.geometry.coordinates.length - 1][1] !== path[path.length - 1][0]
            || rt.geometry.coordinates[rt.geometry.coordinates.length - 1][0] !== path[path.length - 1][1]))
          path = path.concat([[rt.geometry.coordinates[rt.geometry.coordinates.length - 1][1],
                               rt.geometry.coordinates[rt.geometry.coordinates.length - 1][0]]]);
      }
      const fix = { km, metres: Math.round(rt.distance),
        min: Math.max(1, Math.round(km / 5 * 60)),   // the app's own 5 km/h, never the server's pace
        via: h.via, path };
      health.fails = 0;
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(k, { t: Date.now(), fix });
      return fix;
    } catch { health.fails++; }
  }
  if (health.fails >= 6) health.restUntil = Date.now() + 10 * 60e3;   // a box that has said
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // no six times gets ten
  cache.set(k, { t: Date.now(), fix: null });                          // minutes of quiet, ours
  return null;
}

/**
 * Put the measurements onto the journeys the search already ranked. Pure:
 * options in, new options out, nothing touched when there is nothing to apply.
 * A measured leg replaces the estimate's km/min/metres; the journey's minutes
 * and total walk shift by the same delta, so a chip and its steps can never
 * disagree, and the fare is untouched because tickets never priced a footpath.
 */
export function applyWalk(options, fixes) {
  if (!options || !options.length || !fixes || !fixes.size) return options;
  return options.map((o) => {
    let dMin = 0, dWalk = 0, dKm = 0, touched = false, path = false;
    const legs = o.legs.map((l) => {
      if (!l.wpos || !l.wpos[0] || !l.wpos[1]) return l;
      const f = fixes.get(pairKey(l.wpos[0], l.wpos[1]));
      if (!f) return l;
      touched = true;
      dMin += f.min - (l.min || 0);
      dKm += f.km - (l.km || 0);
      if (l.kind === 'walk') dWalk += f.min - (l.min || 0);
      if (f.path && f.path.length > 1) path = true;
      return { ...l, km: f.km, min: f.min, metres: f.metres, measured: f.via,
        ...(f.path && f.path.length > 1 ? { path: f.path } : null) };
    });
    if (!touched) return o;
    return { ...o, legs, measuredWalk: path ? true : o.measuredWalk,
      minutes: Math.max(1, (o.minutes || 0) + dMin),
      walkMin: Math.max(0, (o.walkMin || 0) + dWalk),
      /* and the printed totals move with the legs - a card whose "km total"
         disagreed with its own walk line would be a worse lie than the estimate */
      km: Number.isFinite(o.km) ? +(o.km + dKm).toFixed(2) : o.km };
  });
}

/* ---------------------------------------------------------------- naming -- */

const revCache = new Map();

/**
 * What is at this exact spot? Nominatim's reverse says a street and a locality,
 * which is a label a person recognises; if it cannot, the coordinates are still
 * the truth and are said plainly. Never invented, never blank.
 */
export async function nearPin(lat, lon, fetchImpl = globalThis.fetch) {
  const spot = { n: `Dropped pin · ${(+lat).toFixed(4)}, ${(+lon).toFixed(4)}`, kind: 'geo', lat, lon };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const k = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const c = revCache.get(k);
  if (c) return { ...spot, n: c };
  try {
    const r = await fetchImpl(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}`
      + `&format=jsonv2&zoom=17&accept-language=en`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const a = j.address || {};
    const label = [a.road, a.suburb || a.neighbourhood || a.quarter || a.city_district, a.city || a.town || a.village]
      .filter(Boolean).join(', ').slice(0, 60)
      || (j.display_name || '').split(',').slice(0, 2).join(',').slice(0, 60);
    if (!label) throw new Error('no parts back');
    if (revCache.size > 60) revCache.delete(revCache.keys().next().value);
    revCache.set(k, label);
    return { ...spot, n: label };
  } catch { return spot; }         // unnamed, not unhittable - the pin is still exact
}

/* ------------------------------------------------------------ anchoring -- */

/**
 * Where a picker should look before the rider says otherwise: the other end of
 * the journey first, then the rider's own position - but only when that
 * position is somewhere the published network actually covers. A phone
 * guessing its owner into Oregon by IP must not fly the map 11,000 km away
 * from the Delhi trip being planned; the home city of the network is the
 * honest default in that case, and it is stated in the same open sentence.
 */
export const NETWORK_HOME = { lat: 28.61, lon: 77.21 };   // centre of Delhi NCR's transit map
export function anchorFor(other, loc, home = NETWORK_HOME, radiusKm = 220) {
  const near = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    && Math.hypot((p.lat - home.lat) * 111.32,
                  (p.lon - home.lon) * 111.32 * Math.cos((home.lat * Math.PI) / 180)) <= radiusKm;
  if (near(other)) return { lat: +other.lat, lon: +other.lon };
  if (near(loc)) return { lat: +loc.lat, lon: +loc.lon };
  return { ...home };
}

/* ----------------------------------------------------------- projection -- */

/**
 * A frame for picking: the tap must land where the eye aimed, and the only way
 * to guarantee that is one arithmetic shared by the drawer and its inverse.
 * Fixed size on purpose - about 900 m across, centred on wherever the rider
 * started looking - because a fit-bounds window you cannot reproduce on the
 * way back is how a map lie gets drawn. The route drawers keep their own
 * older project(); this frame serves the picker, and nothing else.
 */
export function pickFrame(center, w = 340, h = 190, kmHalf = 0.45) {
  const lat = Number.isFinite(center.lat) ? center.lat : 28.61;
  const lon = Number.isFinite(center.lon) ? center.lon : 77.21;
  const kx = Math.cos(lat * D2R) || 1;
  const halfLat = kmHalf / 111.32;                      // km per degree of latitude
  const halfLon = kmHalf / (111.32 * kx);
  const s = Math.min((w - 16) / (2 * halfLon * kx), (h - 16) / (2 * halfLat));
  return { lat, lon, kx, s, w, h,
    project: (p) => ({ x: w / 2 + (p.lon - lon) * kx * s, y: h / 2 + (lat - p.lat) * s }),
    unproject: (x, y) => ({ lat: lat - (y - h / 2) / s, lon: lon + (x - w / 2) / (kx * s) }) };
}

/** The frame's metre-per-pixel, for a scale note under a picker. */
export const frameMetresPerPx = (f) => 111320 / f.s;
