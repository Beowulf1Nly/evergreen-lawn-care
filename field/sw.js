/* Evergreen /field — network-first service worker.
   Always serves the freshest version from the network when online, and falls
   back to the last cached copy only when offline. Takes over immediately so
   updates are never stuck behind a stale worker (the old bug). */
const CACHE = 'evg-field-shell-v3';

self.addEventListener('install', function (e) { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    } catch (err) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;         // cross-origin (Stripe, Apps Script, maps) pass through

  e.respondWith((async function () {
    // Bound the network wait: on a live-but-stalled cellular connection fetch() can hang
    // for a very long time without rejecting, which would freeze the app on launch. Abort
    // after 8s and fall back to the cached shell instead of spinning.
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      const fresh = await fetch(req, { signal: ctrl.signal });  // network first → always up to date
      clearTimeout(timer);
      if (fresh && fresh.ok) {                                  // only cache real 2xx — never a 404/5xx error body
        try { const c = await caches.open(CACHE); c.put(req, fresh.clone()); } catch (_) {}
      }
      return fresh;
    } catch (err) {                                            // offline / aborted / stalled → last cached copy
      clearTimeout(timer);
      const cached = await caches.match(req);
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
