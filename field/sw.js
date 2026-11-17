/* Evergreen /field — network-first service worker.
   Always serves the freshest version from the network when online, and falls
   back to the last cached copy only when offline. Takes over immediately so
   updates are never stuck behind a stale worker (the old bug).

   STORAGE (fixed 2026-11-17): the page's updater fetches index.html?_=<timestamp>
   every few minutes. Responses used to be cached under the FULL url, so every check
   stored another ~424 KB copy of the app, forever (tens of MB per phone per day).
   Now every response is cached under ONE key per file: the path with the query
   string removed, and "/field/" treated as "/field/index.html". A newer copy
   overwrites the older one. Bump CACHE when this file changes: activate deletes
   every other cache, which is what clears the old bloat off each phone. */
const CACHE = 'evg-field-shell-v4';

// ".../field/" (the scope) -> ".../field/index.html" = the single cache key of the app shell
function shellKey() {
  let scope = self.registration && self.registration.scope ? self.registration.scope : self.location.href.replace(/[^\/]*$/, '');
  try { const u = new URL(scope); u.search = ''; u.hash = ''; scope = u.href; } catch (err) {}
  if (scope.charAt(scope.length - 1) !== '/') scope += '/';
  return scope + 'index.html';
}
// One cache key per file: drop ?query and #hash, and map a folder url to its index.html
function cacheKeyFor(urlStr) {
  const u = new URL(urlStr);
  u.search = ''; u.hash = '';
  if (u.pathname.charAt(u.pathname.length - 1) === '/') u.pathname += 'index.html';
  return u.href;
}

// Best effort: store a fresh shell at install so the app can cold-start offline even if the
// crew never reloads again while online. A failure here must never fail the install.
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil((async function () {
    // Bounded like the fetch handler below: a stalled connection must not leave this worker
    // stuck "installing" (the previous worker keeps serving the app until this one is ready).
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (err) {} }, 8000);
    try {
      const key = shellKey();
      const fresh = await fetch(key, ctrl ? { cache: 'no-store', signal: ctrl.signal } : { cache: 'no-store' });
      if (fresh && fresh.ok && !fresh.redirected) {
        const c = await caches.open(CACHE);
        await c.put(key, fresh);
      }
    } catch (err) {}
    clearTimeout(timer);
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      const old = keys.filter(function (k) { return k !== CACHE; });
      // Before the old caches go: if the new cache has no shell yet (install had no signal),
      // carry the NEWEST old copy across so an offline launch keeps working. Old entries are
      // keyed by full url; the updater's "_" param is a timestamp, so the largest one is newest.
      try {
        const cur = await caches.open(CACHE);
        const key = shellKey();
        if (!(await cur.match(key))) {
          let best = null, bestTs = -1;
          for (let i = 0; i < old.length; i++) {
            if (old[i].indexOf('evg-field-shell') !== 0) continue;
            const oc = await caches.open(old[i]);
            const reqs = await oc.keys();
            for (let j = 0; j < reqs.length; j++) {
              let same = false, ts = 0;
              try {
                same = cacheKeyFor(reqs[j].url) === key;
                ts = parseInt(new URL(reqs[j].url).searchParams.get('_') || '0', 10) || 0;
              } catch (err) {}
              if (same && ts > bestTs) { best = { cache: oc, req: reqs[j] }; bestTs = ts; }
            }
          }
          if (best) {
            const resp = await best.cache.match(best.req);
            if (resp && resp.ok && !resp.redirected) await cur.put(key, resp);
          }
        }
      } catch (err) {}
      await Promise.all(old.map(function (k) { return caches.delete(k); }));
      // Belt and braces: nothing in the current cache may be keyed with a query string.
      try {
        const cur2 = await caches.open(CACHE);
        const reqs2 = await cur2.keys();
        await Promise.all(reqs2.filter(function (r) { return r.url.indexOf('?') >= 0; }).map(function (r) { return cur2.delete(r); }));
      } catch (err) {}
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
    let key = req.url;
    try { key = cacheKeyFor(req.url); } catch (err) {}
    // Bound the network wait: on a live-but-stalled cellular connection fetch() can hang
    // for a very long time without rejecting, which would freeze the app on launch. Abort
    // after 8s and fall back to the cached shell instead of spinning.
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (err) {} }, 8000);
    try {
      const fresh = await fetch(req, ctrl ? { signal: ctrl.signal } : {});  // network first → always up to date
      clearTimeout(timer);
      // only cache real 2xx — never a 404/5xx error body, and never a redirected response
      // (a browser refuses to use one for a page load). Stored under the query-less key, so
      // each file has exactly ONE entry and a new copy replaces the old one.
      if (fresh && fresh.ok && !fresh.redirected) {
        try { const c = await caches.open(CACHE); c.put(key, fresh.clone()); } catch (_) {}
      }
      return fresh;
    } catch (err) {                                            // offline / aborted / stalled → last cached copy
      clearTimeout(timer);
      let cached = null;
      try {
        const c = await caches.open(CACHE);
        cached = await c.match(key);
        // any page load inside /field/ can start from the one cached shell
        if (!cached && req.mode === 'navigate') cached = await c.match(shellKey());
      } catch (_) {}
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
