/**
 * PWA Manager - App-like experience
 * Handles install prompt, service worker, offline status, etc.
 */

const PWA_KEY = 'dost:pwa';

let deferredPrompt = null;
let installCallback = null;

export function initPWA() {
  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installCallback) installCallback(e);
    console.log('PWA install prompt ready');
  });

  // Track install
  window.addEventListener('appinstalled', () => {
    console.log('PWA installed');
    deferredPrompt = null;
    try {
      localStorage.setItem(PWA_KEY, JSON.stringify({ installed: true, date: new Date().toISOString() }));
    } catch {}
  });
}

export function onInstallPrompt(callback) {
  installCallback = callback;
  if (deferredPrompt) callback(deferredPrompt);
}

export async function triggerInstall() {
  if (!deferredPrompt) {
    return { ok: false, reason: 'No install prompt available. May already be installed or browser does not support.' };
  }

  try {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return { ok: true, outcome: choice.outcome, accepted: choice.outcome === 'accepted' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone === true ||
         document.referrer.includes('android-app://');
}

export function isInstalled() {
  if (isStandalone()) return true;
  try {
    const data = JSON.parse(localStorage.getItem(PWA_KEY) || '{}');
    return !!data.installed;
  } catch {
    return false;
  }
}

export function getServiceWorkerStatus() {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, status: 'Not supported' };
  }

  if (!navigator.serviceWorker.controller) {
    return { supported: true, status: 'Not active - reload to activate', active: false };
  }

  return { supported: true, status: 'Active - Offline ready', active: true, controller: !!navigator.serviceWorker.controller };
}

export async function getCacheStatus() {
  if (!('caches' in window)) {
    return { supported: false, caches: [] };
  }

  try {
    const keys = await caches.keys();
    const details = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      details.push({ name: key, count: requests.length });
    }
    return { supported: true, caches: details, totalCaches: keys.length };
  } catch (e) {
    return { supported: true, error: e.message, caches: [] };
  }
}

export async function clearAllCaches() {
  if (!('caches' in window)) return { ok: false, reason: 'Caches API not supported' };
  
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      await caches.delete(key);
    }
    return { ok: true, deleted: keys.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export function getOfflineStatus() {
  return {
    online: navigator.onLine,
    connection: navigator.connection ? {
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt,
      saveData: navigator.connection.saveData,
    } : null,
  };
}

export function getPWAInfo() {
  return {
    isStandalone: isStandalone(),
    isInstalled: isInstalled(),
    serviceWorker: getServiceWorkerStatus(),
    offline: getOfflineStatus(),
    canInstall: !!deferredPrompt,
    displayMode: isStandalone() ? 'standalone (app-like)' : 'browser',
    url: window.location.href,
    userAgent: navigator.userAgent,
  };
}
