/* Evergreen Field Mode — service worker
   Strategy:
   - App shell (this folder's static files) is precached so the app opens with no signal.
   - Navigations: network-first, fall back to the cached shell (offline launch).
   - Static assets: stale-while-revalidate.
   - The Apps Script API (script.google.com) is NEVER cached or intercepted — the
     app's own offline queue owns write reliability, and reads must stay fresh.
   Bump CACHE_VERSION on every deploy so old shells are replaced. */
const CACHE_VERSION = 'evg-field-v7';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                         // never touch POSTs (photo uploads etc.)
  const url = new URL(req.url);

  // Bypass the backend API entirely — let the page + offline queue handle it.
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('script.googleusercontent.com')) return;

  // Cross-origin (maps, fonts, CDNs): just go to network.
  if (url.origin !== self.location.origin) return;

  // Navigations → network-first, fall back to cached shell so the app opens offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Same-origin static assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
