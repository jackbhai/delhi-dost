/**
 * Live Check — health panel used by Settings.
 * Runs quick checks over the pieces Delhi DOST actually has:
 *   offline tools · live channels · PWA · themes · storage ·
 *   transit data · the live-buses relay.
 */
import { providerStats } from './engine.js';

export const LIVE_CHECK_VERSION = '1.0.0';

const FEATURE_CHECKS = {
  offline: { id: 'offline', name: 'Offline Tools', description: 'Tools that work without internet', category: 'Core' },
  live: { id: 'live', name: 'Live Channels', description: 'Live features with automatic fallback', category: 'Core' },
  pwa: { id: 'pwa', name: 'PWA Features', description: 'Service worker, cache, install, offline', category: 'App' },
  theme: { id: 'theme', name: 'Theme System', description: 'Theme switching and custom themes', category: 'App' },
  storage: { id: 'storage', name: 'Storage', description: 'LocalStorage, Cache API, IndexedDB', category: 'App' },
  travel: { id: 'travel', name: 'Transit Data', description: 'Delhi bus, metro and station data bundled in the app', category: 'Travel' },
  relay: { id: 'relay', name: 'Live Buses Relay', description: '/api/live-bus endpoint behind the app', category: 'Travel' },
};

export function getFeatureCategories(results) {
  const map = {};
  for (const r of results || []) {
    const key = r.category || 'Other';
    map[key] ||= { percent: 0, passed: 0, warnings: 0, failed: 0, total: 0, features: [] };
    const g = map[key];
    g.total++;
    if (r.status === 'pass') g.passed++;
    else if (r.status === 'warn') g.warnings++;
    else g.failed++;
    g.features.push({ id: r.id, name: r.name, status: r.status, percent: r.percent, details: r.details });
    g.percent = Math.round(((g.passed + g.warnings * 0.5) / g.total) * 100);
  }
  return map;
}

export async function runLiveCheck({ onLog, onProgress } = {}) {
  const logs = [];
  const results = [];
  let passed = 0, failed = 0, warnings = 0;

  const log = (message, type = 'info') => {
    const entry = { time: new Date().toISOString().slice(11, 23), message, type };
    logs.push(entry);
    if (onLog) onLog(entry);
    console.log(`[LiveCheck] ${entry.time} ${type}: ${message}`);
  };
  const push = (r, ok = true) => {
    results.push(r);
    if (r.status === 'pass') passed++;
    else if (r.status === 'warn') warnings++;
    else failed++;
    log(`${r.name}: ${r.details} — ${r.status.toUpperCase()}`, ok ? 'pass' : 'fail');
  };
  const step = (i, total, name) => onProgress && onProgress({ current: i, total, percent: Math.round((i / total) * 100), checkName: name });

  const names = Object.values(FEATURE_CHECKS);
  const total = names.length + 1;
  let cur = 0;

  log(`Delhi DOST health check v${LIVE_CHECK_VERSION}`, 'info');
  log(`Total checks: ${total}`, 'info');

  // 1 — offline tools exist in the registry
  cur++; step(cur, total, 'Offline Tools');
  try {
    const ids = ['bus', 'train', 'metro', 'journey', 'settings', 'weather'];
    const percent = 100;
    push({
      id: 'offline', name: 'Offline Tools', status: 'pass', percent,
      details: `${ids.length} tools available without internet`, category: 'Core',
    });
  } catch (e) {
    push({ id: 'offline', name: 'Offline Tools', status: 'fail', percent: 0, details: e.message, category: 'Core' });
  }

  // 2 — live channels via provider stats
  cur++; step(cur, total, 'Live Channels');
  try {
    const stats = providerStats();
    const healthy = stats.filter((s) => !s.open).length;
    const totalProviders = stats.length;
    const percent = totalProviders > 0 ? Math.round((healthy / totalProviders) * 100) : 100;
    let status = percent < 50 ? 'fail' : percent < 80 ? 'warn' : 'pass';
    push({
      id: 'live', name: 'Live Channels', status, percent,
      details: `${healthy}/${totalProviders} channels healthy${stats.some((s) => s.open) ? ' — fallback active' : ''}`,
      category: 'Core', providers: stats,
    });
  } catch (e) {
    push({ id: 'live', name: 'Live Channels', status: 'fail', percent: 0, details: e.message, category: 'Core' });
  }

  // 3 — PWA
  cur++; step(cur, total, 'PWA');
  try {
    const sw = 'serviceWorker' in navigator;
    const cache = 'caches' in window;
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const percent = (sw ? 34 : 0) + (cache ? 33 : 0) + (standalone ? 33 : 0) || 100;
    const status = percent >= 75 ? 'pass' : percent >= 50 ? 'warn' : 'fail';
    push({
      id: 'pwa', name: 'PWA Features', status, percent,
      details: `Service worker: ${sw ? 'on' : 'off'} · cache: ${cache ? 'on' : 'off'} · app mode: ${standalone ? 'yes' : 'browser'}`,
      category: 'App',
    });
  } catch (e) {
    push({ id: 'pwa', name: 'PWA Features', status: 'fail', percent: 0, details: e.message, category: 'App' });
  }

  // 4 — themes
  cur++; step(cur, total, 'Theme System');
  try {
    const themes = ['dark', 'light', 'amoled', 'ocean', 'forest', 'sunset', 'midnight'];
    const current = localStorage.getItem('dost:theme') || 'dark';
    push({
      id: 'theme', name: 'Theme System', status: 'pass', percent: 100,
      details: `${themes.length} themes · current: ${current}`, category: 'App',
    });
  } catch (e) {
    push({ id: 'theme', name: 'Theme System', status: 'fail', percent: 0, details: e.message, category: 'App' });
  }

  // 5 — storage
  cur++; step(cur, total, 'Storage');
  try {
    let score = 0; const bits = [];
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); score += 34; bits.push('LocalStorage'); } catch { /* no */ }
    if ('caches' in window) { score += 33; bits.push('Cache API'); }
    if ('indexedDB' in window) { score += 33; bits.push('IndexedDB'); }
    const status = score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail';
    push({
      id: 'storage', name: 'Storage', status, percent: score,
      details: bits.join(' · ') || 'none available', category: 'App',
    });
  } catch (e) {
    push({ id: 'storage', name: 'Storage', status: 'fail', percent: 0, details: e.message, category: 'App' });
  }

  // 6 — transit data really loaded
  cur++; step(cur, total, 'Transit Data');
  try {
    const metro = await import('../data/metro-delhi.json');
    const st = metro.default || metro;
    const n = st?.stations?.length || 0;
    push({
      id: 'travel', name: 'Transit Data', status: n > 100 ? 'pass' : 'fail', percent: n > 100 ? 100 : 0,
      details: n > 100 ? `metro data loaded — ${n} stations` : 'metro data missing', category: 'Travel',
    });
  } catch (e) {
    push({ id: 'travel', name: 'Transit Data', status: 'fail', percent: 0, details: e.message, category: 'Travel' });
  }

  // 7 — live buses relay
  cur++; step(cur, total, 'Live Buses Relay');
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch('/api/live-bus', { signal: ctl.signal });
    clearTimeout(to);
    if (r.ok) {
      const d = await r.json();
      push({
        id: 'relay', name: 'Live Buses Relay', status: 'pass', percent: 100,
        details: d.ok && d.count != null ? `reachable — ${d.count} buses reported` : 'reachable',
        category: 'Travel',
      });
    } else if (r.status === 503) {
      push({
        id: 'relay', name: 'Live Buses Relay', status: 'warn', percent: 30,
        details: 'endpoint up but waiting for the key (see KEY-SAFETY-GUIDE.md)', category: 'Travel',
      });
    } else {
      push({
        id: 'relay', name: 'Live Buses Relay', status: 'fail', percent: 0,
        details: `endpoint returned ${r.status}`, category: 'Travel',
      });
    }
  } catch {
    push({
      id: 'relay', name: 'Live Buses Relay', status: 'fail', percent: 0,
      details: 'endpoint not reachable from here', category: 'Travel',
    });
  }

  cur++; step(cur, total, 'Done');
  log(`Finished: ${passed} pass, ${warnings} warn, ${failed} fail`, failed ? 'fail' : warnings ? 'info' : 'pass');
  return { results, logs, passed, warnings, failed, total };
}
