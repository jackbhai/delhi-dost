/* Service worker — NETWORK-FIRST for the app shell.
 *
 *   - navigations / index.html  -> network first, cache only as offline fallback
 *   - hashed assets (immutable) -> cache first (safe: filename changes per build)
 *   - /api/*                     -> never intercepted (live data must stay fresh)
 *   - everything cross-origin    -> never touched
 */
const V = 'dost-v11';
const SFX = 'dost-sfx-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== V && k !== SFX).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // cross-origin untouched
  if (url.pathname.startsWith('/api/')) return;        // live relay — never cached

  const isShell = req.mode === 'navigate' || url.pathname.endsWith('/') ||
                  url.pathname.endsWith('index.html');
  const isHashed = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(url.pathname);
  const isSfx = /\/sfx\/[a-z0-9-]+\.wav$/.test(url.pathname);

  /* Sound samples: small immutable files — once heard, cache for offline. */
  if (isSfx) {
    e.respondWith(
      caches.open(SFX).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  if (isShell) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((h) => h || caches.match('./index.html')))
    );
    return;
  }

  if (isHashed) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
