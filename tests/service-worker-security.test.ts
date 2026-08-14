/**
 * Tests for Fix 4: Service Worker Cache Security.
 *
 * These static analysis tests verify that the service worker:
 * - Uses a public-route whitelist instead of a blacklist.
 * - Never caches /destination/*, /dashboard/*, /admin/*, /api/*, /auth/*.
 * - Never caches /login, /signup, /forgot-password, /verify-email, /account/*.
 * - Precaches /offline.html (not /offline).
 * - Rejects redirects, non-200, Set-Cookie, Cache-Control: private/no-store.
 * - Never caches responses that set cookies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
const offlineHtml = readFileSync(join(root, 'public/offline.html'), 'utf8');

describe('Fix 4: Service worker — private route blocking', () => {
  it('blocks /dashboard/*', () => {
    expect(sw).toContain("'/dashboard'");
  });

  it('blocks /admin/*', () => {
    expect(sw).toContain("'/admin'");
  });

  it('blocks /api/*', () => {
    expect(sw).toContain("'/api/'");
  });

  it('blocks /auth/*', () => {
    expect(sw).toContain("'/auth/'");
  });

  it('blocks /destination/*', () => {
    expect(sw).toContain("'/destination/'");
  });

  it('blocks /account/*', () => {
    expect(sw).toContain("'/account/'");
  });

  it('blocks /login', () => {
    expect(sw).toContain("'/login'");
  });

  it('blocks /signup', () => {
    expect(sw).toContain("'/signup'");
  });

  it('blocks /forgot-password', () => {
    expect(sw).toContain("'/forgot-password'");
  });

  it('blocks /verify-email', () => {
    expect(sw).toContain("'/verify-email'");
  });
});

describe('Fix 4: Service worker — public-route whitelist approach', () => {
  it('defines a PUBLIC_NAV_PREFIXES whitelist array', () => {
    expect(sw).toContain('PUBLIC_NAV_PREFIXES');
  });

  it('defines a PRIVATE_NAV_PREFIXES blocklist for explicit private routes', () => {
    expect(sw).toContain('PRIVATE_NAV_PREFIXES');
  });

  it('has an isPublicRoute function', () => {
    expect(sw).toContain('isPublicRoute');
  });

  it('the fetch handler checks isPublicRoute before caching navigations', () => {
    expect(sw).toMatch(/isPublicRoute\(url\.pathname\)/);
  });
});

describe('Fix 4: Service worker — response safety checks', () => {
  it('has an isCacheableResponse function', () => {
    expect(sw).toContain('isCacheableResponse');
  });

  it('rejects redirects (status !== 200)', () => {
    expect(sw).toContain('response.status !== 200');
  });

  it('rejects responses with Set-Cookie', () => {
    expect(sw).toContain('Set-Cookie');
  });

  it('rejects Cache-Control: private', () => {
    expect(sw).toMatch(/cacheControl.*private/);
  });

  it('rejects Cache-Control: no-store', () => {
    expect(sw).toMatch(/cacheControl.*no-store/);
  });

  it('calls isCacheableResponse before caching navigation responses', () => {
    expect(sw).toMatch(/isCacheableResponse\(res\)/);
  });
});

describe('Fix 4: Service worker — offline page precache', () => {
  it('precaches /offline.html (not /offline)', () => {
    expect(sw).toContain("'/offline.html'");
    // Should NOT precache /offline (that route does not exist).
    // Check that PRECACHE array does not contain '/offline' without .html.
    const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([^\]]*)\]/);
    expect(precacheMatch).toBeTruthy();
    const precacheContent = precacheMatch![1];
    // The string '/offline' should only appear as '/offline.html'.
    expect(precacheContent).not.toMatch(/'\/offline'(?!\\.html)/);
  });

  it('offline fallback uses /offline.html', () => {
    expect(sw).toContain("caches.match('/offline.html')");
  });

  it('public/offline.html actually exists', () => {
    expect(offlineHtml.length).toBeGreaterThan(0);
    // Should contain a meaningful offline message.
    expect(offlineHtml.toLowerCase()).toMatch(/offline|unavailable|connection/);
  });
});

describe('Fix 4: Service worker — no caching of same-origin redirects', () => {
  it('API responses are never cached (first-line block)', () => {
    // The first block in the fetch handler should return early for /api/.
    const fetchHandlerMatch = sw.match(/addEventListener\('fetch'[\s\S]*$/);
    expect(fetchHandlerMatch).toBeTruthy();
    // /api/ check should come before any caching logic.
    const apiCheck = sw.indexOf("'/api/'");
    const cachePut = sw.indexOf('caches.open');
    expect(apiCheck).toBeLessThan(cachePut);
  });
});
