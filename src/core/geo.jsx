/**
 * Global location context.
 *
 * Goal: the user should never have to type a city. On first load we try, in
 * order of accuracy:
 *   1. cached location   (instant, from a previous visit)
 *   2. GPS               (navigator.geolocation — needs permission)
 *   3. IP geolocation    (no permission needed, city-level, pooled providers)
 *   4. New Delhi         (last-resort default so tools always render)
 *
 * Reverse geocoding turns coordinates into a human name, and the resolved
 * place is shared by Weather, AQI, Metro, Transit, Prayer times, Sun times etc.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { jget, resolve } from './engine';
import * as P from './providers';
import { Icon } from '../ui/icons';

const KEY = 'dost:loc';
const FALLBACK = { lat: 28.6139, lon: 77.209, name: 'New Delhi', region: 'Delhi', country: 'India', src: 'default' };

const Ctx = createContext(null);
export const useLoc = () => useContext(Ctx);

const reverse = [
  { id: 'om-rev', label: 'Open-Meteo', async run({ lat, lon }) {
      // Open-Meteo has no reverse endpoint; use BigDataCloud (keyless, CORS *)
      const d = await jget(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const name = d.city || d.locality || d.principalSubdivision;
      if (!name) throw new Error('no name');
      return { name, region: d.principalSubdivision || '', country: d.countryName || '' }; } },
  { id: 'nominatim-rev', label: 'Nominatim', async run({ lat, lon }) {
      const d = await jget(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=12`,
        { headers: { 'User-Agent': 'DelhiDost/1.0' } });
      const a = d.address || {};
      const name = a.city || a.town || a.village || a.county || a.state_district;
      if (!name) throw new Error('no name');
      return { name, region: a.state || '', country: a.country || '' }; } },
];

export function LocProvider({ children }) {
  const [loc, setLoc] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem(KEY)); if (c?.lat) return { ...c, cached: true }; } catch {}
    return FALLBACK;
  });
  const [status, setStatus] = useState('idle');   // idle | locating | gps | ip | denied | default

  const save = useCallback((l) => {
    setLoc(l);
    try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {}
  }, []);

  const nameFor = useCallback(async (lat, lon, src) => {
    try {
      const r = await resolve('revgeo', reverse, { lat, lon }, { ttl: 864e5 });
      save({ lat, lon, ...r.data, src });
    } catch { save({ lat, lon, name: 'Your location', region: '', country: '', src }); }
  }, [save]);

  /** Ask the browser for GPS. Must be triggered by a user gesture on iOS. */
  const requestGps = useCallback(() => {
    if (!navigator.geolocation) { setStatus('denied'); return; }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        setStatus('gps');
        await nameFor(+p.coords.latitude.toFixed(4), +p.coords.longitude.toFixed(4), 'gps');
      },
      () => { setStatus('denied'); ipLocate(); },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 3e5 });
  }, [nameFor]);   // eslint-disable-line

  /** Silent, permission-free fallback. */
  const ipLocate = useCallback(async () => {
    try {
      const r = await resolve('ip', P.ipinfo, {}, { ttl: 6e5 });
      const d = r.data;
      if (d.lat && d.lon) {
        save({ lat: +d.lat, lon: +d.lon, name: d.city || 'Your area',
               region: d.region || '', country: d.country || '', src: 'ip' });
        setStatus('ip');
      }
    } catch { setStatus('default'); }
  }, [save]);

  /* On first load: if permission was already granted, use GPS silently.
     Otherwise fall back to IP so tools still auto-populate. */
  useEffect(() => {
    let done = false;
    (async () => {
      try {
        if (navigator.permissions?.query) {
          const st = await navigator.permissions.query({ name: 'geolocation' });
          if (st.state === 'granted') { done = true; requestGps(); return; }
        }
      } catch {}
      if (!done) ipLocate();
    })();
  }, []);   // eslint-disable-line

  return <Ctx.Provider value={{ loc, status, requestGps, setLoc: save }}>{children}</Ctx.Provider>;
}

/** Small reusable banner: shows the detected place + a button to sharpen it. */
export function LocBar({ compact }) {
  const { loc, status, requestGps } = useLoc();
  const label = status === 'locating' ? 'Locating…'
    : loc.src === 'gps' ? 'GPS'
    : loc.src === 'ip' ? 'Approx (IP)'
    : loc.src === 'default' ? 'Default' : 'Saved';
  return (
    <div className="locbar">
      <span className={`dot ${loc.src === 'gps' ? '' : 'warn'}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13 }}>{loc.name}</b>
        {!compact && <span className="dim sm">
          {[loc.region, loc.country].filter(Boolean).join(', ')} · {label}
        </span>}
      </div>
      {loc.src !== 'gps' && (
        <button className="btn sm" onClick={requestGps} disabled={status === 'locating'}>
          {status === 'locating' ? '…' : <><Icon n="pin" size={17} /> Use GPS</>}
        </button>)}
    </div>
  );
}
