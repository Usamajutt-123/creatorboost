/**
 * CreatorBoost service worker.
 *
 * Real, minimal PWA: precaches the shell, serves static assets
 * stale-while-revalidate, serves navigations network-first with an
 * offline fallback, and never touches API or authenticated routes.
 *
 * Update strategy: versioned cache name + skipWaiting/clients.claim,
 * so a new deploy replaces the old cache on the next load.
 */
const CACHE = 'creatorboost-v1';
const PRECACHE = ['/', '/offline', '/favicon.png', '/site.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // precache is best-effort; never block install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache financial or private endpoints.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/admin')) return;
  if (url.pathname.startsWith('/auth/')) return;

  // Navigations: network-first with offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('/offline') || Response.error();
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
