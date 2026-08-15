/**
 * CreatorBoost service worker.
 *
 * SECURITY-FIRST PWA: uses a public-route whitelist so private,
 * authentication-dependent, token-gated, or redirect-sensitive pages
 * are NEVER cached. This prevents expired unlock tokens, admin data,
 * or dashboard state from leaking through the service worker cache.
 *
 * Update strategy: versioned cache name + skipWaiting/clients.claim,
 * so a new deploy replaces the old cache on the next load.
 */
const CACHE = 'creatorboost-v3';
const PRECACHE = ['/', '/offline.html', '/favicon.png', '/site.webmanifest'];

/**
 * Public-route whitelist. Only navigations matching these prefixes
 * are eligible for caching. Everything else is pass-through.
 *
 * This is intentionally restrictive: adding a new private route
 * never accidentally becomes cached.
 */
const PUBLIC_NAV_PREFIXES = [
  '/',
  '/blog',
  '/about',
  '/contact',
  '/c/',
  '/terms',
  '/privacy',
  '/explore',
  '/leaderboard',
];

/**
 * Private-route prefixes that MUST NEVER be cached, even if they
 * accidentally match a public prefix (e.g. "/").
 */
const PRIVATE_NAV_PREFIXES = [
  '/dashboard',
  '/admin',
  '/api/',
  '/auth/',
  '/destination/',
  '/account/',
  '/login',
  '/signup',
  '/forgot-password',
  '/verify-email',
  '/settings',
  '/withdraw',
  '/maintenance',
];

/** Check if a pathname is a cacheable public route. */
function isPublicRoute(pathname) {
  // Explicit private blocks first (most important).
  for (const priv of PRIVATE_NAV_PREFIXES) {
    if (priv === '/') continue; // never block root
    if (pathname === priv || pathname.startsWith(priv + '/') || pathname.startsWith(priv)) {
      return false;
    }
  }
  // Allow the exact root and public prefixes.
  for (const pub of PUBLIC_NAV_PREFIXES) {
    if (pub === '/') {
      if (pathname === '/') return true;
      continue;
    }
    if (pathname === pub || pathname.startsWith(pub + '/') || pathname.startsWith(pub)) {
      return true;
    }
  }
  return false;
}

/**
 * Requests that must never be served from, or written to, the cache —
 * regardless of request mode.
 *
 * The navigation whitelist alone was NOT sufficient. Only `request.mode ===
 * 'navigate'` went through `isPublicRoute`; every other same-origin GET fell
 * through to the stale-while-revalidate branch at the bottom. That included
 * Next.js RSC payload requests (`/dashboard?_rsc=...`, issued with mode
 * 'cors'/'no-cors' by router prefetch and client navigation), which carry the
 * rendered private page data. Authenticated dashboard and admin content could
 * therefore be written into a cache that survives sign-out and is readable by
 * the next user of the device.
 */
function isPrivateRequest(url, request) {
  // Any RSC / Next data payload is treated as private: it is a serialised
  // render of a page whose privacy we cannot judge from the URL alone.
  if (url.searchParams.has('_rsc')) return true;
  if (request.headers.get('RSC') === '1') return true;
  if (request.headers.get('Next-Router-Prefetch') === '1') return true;
  if (url.pathname.startsWith('/_next/data/')) return true;
  return !isPublicRoute(url.pathname);
}

/**
 * Check whether a fetch Response is safe to cache.
 * Rejects redirects, non-200, Set-Cookie, private/no-store headers.
 */
function isCacheableResponse(response) {
  if (!response) return false;
  // Must be an opaque or same-origin OK response.
  if (response.type === 'opaque') return false;
  if (response.status !== 200) return false;

  const headers = response.headers;
  // Never cache responses that set cookies (auth state).
  if (headers.has('Set-Cookie')) return false;

  const cacheControl = (headers.get('Cache-Control') || '').toLowerCase();
  if (cacheControl.includes('private') || cacheControl.includes('no-store')) {
    return false;
  }

  return true;
}

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

  // NEVER cache API endpoints — these include financial, auth, and
  // data-modifying requests. This is the first hard block.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first with public-route whitelist.
  if (request.mode === 'navigate') {
    // Private routes are always network-only (no caching at all).
    if (!isPublicRoute(url.pathname)) return;

    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache if the response passes ALL safety checks.
          if (isCacheableResponse(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('/offline.html') || Response.error();
        })
    );
    return;
  }

  // Non-navigation requests. Anything that is (or might be) private — an RSC
  // payload, a prefetch, a private route — is passed straight through to the
  // network and never touches the cache. Only genuinely public, cacheable
  // assets reach the stale-while-revalidate branch below.
  if (isPrivateRequest(url, request)) return;

  // Static assets: stale-while-revalidate, only for public assets.
  // The precache whitelist handles the shell; this handles other
  // same-origin static files (JS/CSS/images).
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (isCacheableResponse(res)) {
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
