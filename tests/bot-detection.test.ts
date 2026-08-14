/**
 * Server-authoritative request/bot signal derivation.
 *
 * Every input here is something the SERVER observed. These tests assert that
 * automation is detected, that legitimate (including unusual but real)
 * browsers are not hard-blocked, and that the transport envelope rejects
 * malformed / oversized / wrong-method requests.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_VIEW_PAYLOAD_BYTES,
  analyzeRequestHeaders,
  deriveRequestSignals,
  exceedsPayloadLimit,
  scoreBehavior,
  validateJsonRequestEnvelope,
} from '@/lib/bot-detection';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** A realistic same-origin fetch from a Chromium browser. */
function realBrowserHeaders(overrides: Record<string, string | null> = {}) {
  return {
    userAgent: CHROME_UA,
    accept: '*/*',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
    secFetchSite: 'same-origin',
    secFetchMode: 'cors',
    secFetchDest: 'empty',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    ...overrides,
  };
}

describe('analyzeRequestHeaders — automation detection', () => {
  it('does not flag a real Chromium browser', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders());
    expect(signals.isBot).toBe(false);
    expect(signals.isEmulator).toBe(false);
    expect(signals.score).toBeLessThan(40);
    expect(signals.reasons).toEqual([]);
  });

  it('does not flag a real mobile Safari browser', () => {
    const signals = analyzeRequestHeaders({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      accept: '*/*',
      acceptLanguage: 'en-GB,en;q=0.9',
      acceptEncoding: 'gzip, deflate, br',
      secFetchSite: 'same-origin',
      secFetchMode: 'cors',
    });
    expect(signals.isBot).toBe(false);
    expect(signals.score).toBeLessThan(40);
  });

  it('flags headless Chrome', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36',
    }));
    expect(signals.isBot).toBe(true);
    expect(signals.isEmulator).toBe(true);
    expect(signals.score).toBeGreaterThanOrEqual(90);
    expect(signals.reasons).toContain('automation_ua');
  });

  it.each([
    ['Selenium', 'Mozilla/5.0 selenium/4.16.0 webdriver'],
    ['Playwright', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Playwright/1.40'],
    ['Puppeteer', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 puppeteer'],
    ['PhantomJS', 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 PhantomJS/2.1.1 Safari/538.1'],
  ])('flags the %s automation signature', (_name, ua) => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({ userAgent: ua }));
    expect(signals.isBot).toBe(true);
    expect(signals.isEmulator).toBe(true);
  });

  it.each([
    ['curl', 'curl/8.4.0'],
    ['python-requests', 'python-requests/2.31.0'],
    ['Go', 'Go-http-client/2.0'],
    ['node-fetch', 'node-fetch/3.3.2'],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ])('flags the non-browser client %s', (_name, ua) => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({ userAgent: ua }));
    expect(signals.isBot).toBe(true);
    expect(signals.score).toBeGreaterThanOrEqual(70);
  });

  it('flags a missing or absurdly short user agent', () => {
    expect(analyzeRequestHeaders(realBrowserHeaders({ userAgent: '' })).isBot).toBe(true);
    expect(analyzeRequestHeaders(realBrowserHeaders({ userAgent: 'x' })).isBot).toBe(true);
  });

  it('flags a headless build declared through Sec-CH-UA', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({
      secChUa: '"HeadlessChrome";v="120", "Chromium";v="120"',
    }));
    expect(signals.isBot).toBe(true);
    expect(signals.isEmulator).toBe(true);
    expect(signals.reasons).toContain('headless_client_hint');
  });
});

describe('analyzeRequestHeaders — missing/inconsistent headers are risk, not blocks', () => {
  it('raises risk but does not hard-block a missing Accept-Language', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({ acceptLanguage: '' }));
    expect(signals.isBot).toBe(false);
    expect(signals.score).toBeGreaterThan(0);
    expect(signals.reasons).toContain('missing_accept_language');
  });

  it('flags a Chrome UA with no fetch metadata at all', () => {
    const signals = analyzeRequestHeaders({
      userAgent: CHROME_UA,
      accept: '*/*',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
    });
    expect(signals.reasons).toContain('missing_fetch_metadata');
    expect(signals.score).toBeGreaterThanOrEqual(55);
    // Still a risk signal, not automation proof.
    expect(signals.isBot).toBe(false);
  });

  it('detects a mobile client hint contradicting a desktop UA', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({ secChUaMobile: '?1' }));
    expect(signals.reasons).toContain('mobile_hint_mismatch');
  });

  it('detects a platform hint contradicting the UA', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({ secChUaPlatform: '"Android"' }));
    expect(signals.reasons).toContain('platform_hint_mismatch');
  });

  it('detects impossible OS combinations in one UA', () => {
    const signals = analyzeRequestHeaders(realBrowserHeaders({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Android 13; iPhone) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    }));
    expect(signals.reasons).toContain('impossible_ua_combination');
    expect(signals.score).toBeGreaterThanOrEqual(70);
  });

  it('clamps the score into 0-100', () => {
    const signals = analyzeRequestHeaders({ userAgent: 'curl/8' });
    expect(signals.score).toBeGreaterThanOrEqual(0);
    expect(signals.score).toBeLessThanOrEqual(100);
  });
});

describe('deriveRequestSignals — reads the real Headers object', () => {
  it('derives from headers, ignoring anything a body could claim', () => {
    const headers = new Headers({
      'user-agent': 'python-requests/2.31.0',
      accept: '*/*',
      'accept-language': 'en',
      'accept-encoding': 'gzip',
    });
    const signals = deriveRequestSignals(headers);
    expect(signals.isBot).toBe(true);
    expect(signals.reasons).toContain('non_browser_client');
  });

  it('passes a genuine browser through cleanly', () => {
    const headers = new Headers({
      'user-agent': CHROME_UA,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-ch-ua': '"Chromium";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });
    expect(deriveRequestSignals(headers).isBot).toBe(false);
  });
});

describe('validateJsonRequestEnvelope — request-level protection', () => {
  const ok = { method: 'POST', contentType: 'application/json', contentLength: '120' };

  it('accepts a well-formed JSON POST', () => {
    expect(validateJsonRequestEnvelope(ok)).toEqual({ ok: true });
  });

  it('accepts application/json with a charset parameter', () => {
    expect(validateJsonRequestEnvelope({ ...ok, contentType: 'application/json; charset=utf-8' }).ok).toBe(true);
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])('rejects %s with 405', method => {
    const result = validateJsonRequestEnvelope({ ...ok, method });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(405);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])(
    'rejects content-type %s with 415',
    contentType => {
      const result = validateJsonRequestEnvelope({ ...ok, contentType });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(415);
    },
  );

  it('rejects a null content-type', () => {
    const result = validateJsonRequestEnvelope({ ...ok, contentType: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(415);
  });

  it('rejects an oversized declared payload with 413', () => {
    const result = validateJsonRequestEnvelope({ ...ok, contentLength: String(MAX_VIEW_PAYLOAD_BYTES + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it('rejects a malformed content-length', () => {
    const result = validateJsonRequestEnvelope({ ...ok, contentLength: 'not-a-number' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('allows an absent content-length (chunked)', () => {
    expect(validateJsonRequestEnvelope({ ...ok, contentLength: null }).ok).toBe(true);
  });
});

describe('exceedsPayloadLimit — a lying Content-Length cannot smuggle a big body', () => {
  it('measures bytes, not characters', () => {
    expect(exceedsPayloadLimit('{"a":1}')).toBe(false);
    expect(exceedsPayloadLimit('x'.repeat(MAX_VIEW_PAYLOAD_BYTES + 1))).toBe(true);
    // Multi-byte characters count by byte length.
    expect(exceedsPayloadLimit('é'.repeat(MAX_VIEW_PAYLOAD_BYTES / 2 + 1))).toBe(true);
  });
});

describe('scoreBehavior — server-derived behavioural risk', () => {
  it('does not penalise a normal single visit', () => {
    const result = scoreBehavior({ recentViews: 1, distinctCampaigns: 1, campaignRepeats: 1 });
    expect(result.score).toBe(0);
    expect(result.isRepeat).toBe(false);
  });

  it('tolerates a modest shared-IP volume without a blocking score', () => {
    // A family / small office on one NAT IP.
    const result = scoreBehavior({ recentViews: 6, distinctCampaigns: 4, campaignRepeats: 1 });
    expect(result.score).toBeLessThan(40);
  });

  it('flags an impossible request volume from one IP', () => {
    const result = scoreBehavior({ recentViews: 60, distinctCampaigns: 3, campaignRepeats: 2 });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.isRepeat).toBe(true);
    expect(result.reasons).toContain('frequency_abuse');
  });

  it('flags rapid campaign switching', () => {
    const result = scoreBehavior({ recentViews: 20, distinctCampaigns: 15, campaignRepeats: 1 });
    expect(result.reasons).toContain('rapid_campaign_switching');
  });

  it('flags a repeated reload pattern on one campaign', () => {
    const result = scoreBehavior({ recentViews: 14, distinctCampaigns: 1, campaignRepeats: 12 });
    expect(result.reasons).toContain('reload_pattern');
    expect(result.isRepeat).toBe(true);
  });

  it('flags instant task completion as impossible click speed', () => {
    const result = scoreBehavior({ sessionSeconds: 0.4, requiredTasks: 3 });
    expect(result.reasons).toContain('instant_completion');
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('flags a negative (future-dated) session as impossible timing', () => {
    const result = scoreBehavior({ sessionSeconds: -30, requiredTasks: 2 });
    expect(result.reasons).toContain('impossible_timing');
  });

  it('accepts a realistic completion time', () => {
    const result = scoreBehavior({ sessionSeconds: 45, requiredTasks: 3, recentViews: 1, distinctCampaigns: 1 });
    expect(result.score).toBe(0);
  });

  it('flags an abnormally long session', () => {
    const result = scoreBehavior({ sessionSeconds: 8 * 3600, requiredTasks: 2 });
    expect(result.reasons).toContain('abnormal_session_duration');
  });
});
