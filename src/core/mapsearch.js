/**
 * geo.js — "search the whole map", not just the stops we ship.
 *
 * Plan Journey's pickers list metro stations and bus stops from the published
 * data, which is exact but coarse: "Kali Ghata" as a bus stop may sit 900 m
 * from the shop you actually mean. This module asks an open geocoder for the
 * real place, and the planner then measures the walk from that exact point to
 * the nearest stop or station - so the answer says what you asked: how far you
 * walk, which bus, where you change, which metro.
 *
 * Two providers, two different companies, both measured from this repo before
 * shipping (browser CORS `access-control-allow-origin: *` present, no key, no
 * signup):
 *                              it answers Delhi-NCR street and shop queries that the
 *                              shared nominatim instance returns empty for).
 *                              rate-limited shared service, so it is the second
 *                              choice, not the first).
 * A third (BigDataCloud's keyless geocoder) was tried from the build sandbox and
 * never resolved DNS - left out rather than shipped as a broken fallback.
 *
 * Nothing is cached in the service worker and nothing is fetched offline: a
 * failed lookup says exactly that, and the local stop list above it still works.
 */

const TIMEOUT_MS = 7000;
const TTL = 10 * 60 * 1000;                       // a city does not move that fast
const CACHE_MAX = 40;

const cache = new Map();                          // norm(query) → { t, hits, providers }

export const norm = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** "name, street, locality, city" - first three non-empty parts, capped short.
 *  Both providers return either a full display string or pieces; the pieces are
 *  assembled here so one code path formats both. */
export function labelOf(p = {}) {
  if (p.display_name) return p.display_name.replace(/\s+/g, ' ').trim();
  const bits = [p.name, p.street, p.locality, p.neighbourhood, p.district, p.city, p.county, p.state]
    .map((x) => (x || '').trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const b of bits) if (!seen.has(b.toLowerCase()) && (seen.add(b.toLowerCase()), true)) out.push(b);
  return out.join(', ');
}

const shortLabel = (label) => (label.length > 72 ? label.slice(0, 69).trimEnd() + '…' : label);

/** Photon: GeoJSON features → hits. Coordinates are [lon, lat] - the swap is the
 *  single most common bug in geocoder code, so it is done once, here, with a test. */
export function parsePhoton(json) {
  const feats = (json && json.features) || [];
  const out = [];
  for (const f of feats) {
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    const lon = +c[0], lat = +c[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = labelOf(f.properties || {});
    if (!label) continue;
    out.push({ n: shortLabel(label), label, lat, lon, kind: 'geo',
      via: 'photon', osm: `${(f.properties || {}).osm_type || 'r'}/${f.properties?.osm_id || ''}` });
  }
  return out;
}

/** Nominatim: a flat array of results → hits (same shape as Photon's). */
export function parseNominatim(json) {
  const rows = Array.isArray(json) ? json : [];
  const out = [];
  for (const h of rows) {
    const lat = +h.lat, lon = +h.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = (h.display_name || '').replace(/\s+/g, ' ').trim() || h.name || '';
    if (!label) continue;
    out.push({ n: shortLabel(label), label, lat, lon, kind: 'geo', via: 'nominatim',
      osm: `${h.osm_type || 'r'}/${h.osm_id || ''}` });
  }
  return out;
}

const fetchJson = async (url, label) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${label} answered ${r.status}`);
  return r.json();
};

const okNear = (n) => n && Number.isFinite(n.lat) && Number.isFinite(n.lon)
  && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180;

/* A rider searching for "Kali Ghata" while standing in Ghaziabad means the Kali
   Ghata near them, not the sweet shop in Dwarka - so both providers get a hint.
   It is a bias, never a filter: results across the city still appear, they just
   rank below nearer ones. Photon takes lat/lon; Nominatim takes a viewbox
   (±0.25°, bounded=0 so it softens rather than excludes). */
const askPhoton = (q, near) =>
  fetchJson(`https://photon.komoot.io/api/?limit=6&lang=en&q=${encodeURIComponent(q)}`
    + (okNear(near) ? `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}` : ''), 'Photon').then(parsePhoton);
const askNominatim = (q, near) =>
  fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in`
    + `&accept-language=en&q=${encodeURIComponent(q)}`
    + (okNear(near) ? `&viewbox=${(near.lon - 0.25).toFixed(4)},${(near.lat + 0.25).toFixed(4)},`
      + `${(near.lon + 0.25).toFixed(4)},${(near.lat - 0.25).toFixed(4)}&bounded=0` : ''), 'Nominatim').then(parseNominatim);

/**
 * Search both, primary first. An empty answer from Photon is still an answer, but
 * the shared Nominatim instance returns empty under load, so an empty primary does
 * get one more opinion before we call it "no such place" - and if both agree, the
 * caller can say that honestly instead of showing a blank list.
 */
export async function searchMap(rawQuery, near = null) {
  const q = norm(rawQuery);
  if (q.length < 4) return { ok: true, hits: [], skipped: 'too short' };
  const key = okNear(near) ? `${q}@${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : q;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return { ok: true, hits: hit.hits, providers: hit.providers };
  const providers = [];
  let primary = null, errors = 0;
  try { primary = await askPhoton(q, near); providers.push('photon'); }
  catch (e) { errors++; providers.push(`photon failed: ${e.message}`); }
  let secondary = null;
  if (!primary || primary.length === 0) {
    try { secondary = await askNominatim(q, near); providers.push('nominatim'); }
    catch (e) { errors++; providers.push(`nominatim failed: ${e.message}`); }
  }
  const hits = (primary && primary.length ? primary : secondary) || [];
  if (errors === 2 && !hits.length) return { ok: false, why: providers.join(' · '), hits: [] };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { t: Date.now(), hits, providers });
  return { ok: true, hits, providers };
}

/** What a picked hit becomes for the planner: a place with exact coordinates. */
export const geoPlace = (hit) => ({ n: hit.n, kind: 'geo', lat: hit.lat, lon: hit.lon });
