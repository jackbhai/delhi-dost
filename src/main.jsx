import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import './styles/dost.css'
import './styles/polish.css';
import { initTheme } from './core/theme.js';
import { initPWA } from './core/pwa.js';
import { ErrorBoundary } from './ErrorBoundary';

// Init theme before render - apply saved theme immediately to avoid flash
initTheme();

// Init PWA - setup install prompt handling
initPWA();

// Global error handler for uncaught errors
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error);
  const root = document.getElementById('root');
  if (root && !root.innerHTML) {
    root.innerHTML = `<div style="padding:20px;margin:20px;background:#1a1a1a;color:#ff6b6b;font-family:monospace;font-size:14px;border-radius:8px;border:2px solid #ff6b6b">
      <h2 style="color:#ff6b6b;margin-top:0">JavaScript Error</h2>
      <p style="color:#fff">${e.message}</p>
      <pre style="background:#000;padding:15px;border-radius:4px;overflow:auto;color:#fff">${e.error?.stack || ''}</pre>
      <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;background:#4ecdc4;color:#000;border:none;border-radius:4px;cursor:pointer;font-size:16px;font-weight:bold">Reload Page</button>
    </div>`;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        import.meta.env.BASE_URL + 'sw.js', { updateViaCache: 'none' });
      /* A new build used to reload the page the moment its worker installed —
         mid-song, mid-scroll, no warning. It now waits on a one-line prompt
         and only hands over once the user taps it. */
      let bar = null, handing = false;
      const ask = () => {
        if (bar) return;
        bar = document.createElement('div');
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);'
          + 'z-index:2147483000;display:flex;gap:10px;align-items:center;'
          + 'background:#111A2B;border:1px solid rgba(255,176,32,.45);border-radius:12px;'
          + 'padding:8px 12px;color:#F2F6FF;font:13px/1.2 "DM Sans",system-ui,sans-serif;'
          + 'box-shadow:0 6px 24px rgba(0,0,0,.5)';
        const msg = document.createElement('span');
        msg.textContent = 'New version ready';
        const btn = document.createElement('button');
        btn.textContent = 'Reload';
        btn.style.cssText = 'background:#FFB020;color:#000;border:0;border-radius:8px;'
          + 'padding:6px 12px;font-weight:700;font-size:13px;cursor:pointer';
        btn.onclick = () => {
          if (!reg.waiting) { location.reload(); return; }
          handing = true;
          reg.waiting.postMessage('skip-waiting');
        };
        bar.append(msg, btn);
        document.body.appendChild(bar);
      };
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Only after we asked for the handover; the first claim on install
        // must not bounce anyone anywhere.
        if (handing) location.reload();
      });
      const check = () => reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) ask();
        });
      });
      if (reg.waiting) ask();
      // A tab left open for days picks up deploys the moment it gets focus.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      check();
    } catch {}
  });
}
