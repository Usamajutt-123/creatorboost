import { describe, it, expect } from 'vitest';
import { scoreUserAgent, combineSignals, hashIp } from '../src/lib/fraud';

describe('scoreUserAgent', () => {
  it('flags obvious bots hard', () => {
    const r = scoreUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    expect(r.isBot).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('flags crawler/spider/http-clients', () => {
    expect(scoreUserAgent('curl/8.0.1').isBot).toBe(true);
    expect(scoreUserAgent('python-requests/2.31').isBot).toBe(true);
    expect(scoreUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)').isBot).toBe(true);
    expect(scoreUserAgent('node-fetch/1.0').isBot).toBe(true);
  });

  it('flags headless/automation', () => {
    const r = scoreUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 headless');
    expect(r.isEmulator).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(scoreUserAgent('selenium/4.0').isBot).toBe(true);
    expect(scoreUserAgent('puppeteer/20').isBot).toBe(true);
  });

  it('flags suspiciously short UAs', () => {
    const r = scoreUserAgent('okhttp/4.9');
    expect(r.isBot).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it('does not flag normal browsers', () => {
    const r = scoreUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    expect(r.isBot).toBe(false);
    expect(r.isEmulator).toBe(false);
    expect(r.score).toBeLessThan(40);
  });
});

describe('combineSignals', () => {
  it('merges signals and takes the max score', () => {
    const out = combineSignals([
      { isBot: true, fraudScore: 30, reasons: ['bot_ua'] },
      { isVpn: true, fraudScore: 80, reasons: ['vpn_detected'] },
    ]);
    expect(out.isBot).toBe(true);
    expect(out.isVpn).toBe(true);
    expect(out.fraudScore).toBe(80);
    expect(out.reasons).toEqual(['bot_ua', 'vpn_detected']);
  });

  it('clamps the score to 0-100 and never throws on junk', () => {
    const out = combineSignals([
      { fraudScore: 999, reasons: ['a'] },
      { fraudScore: -5, reasons: [] as string[] },
      { fraudScore: Number.NaN },
    ]);
    expect(out.fraudScore).toBe(100);
    expect(Array.isArray(out.reasons)).toBe(true);
  });
});

describe('hashIp', () => {
  it('hashes public IPs and returns null for unusable values', () => {
    expect(hashIp('8.8.8.8')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('127.0.0.1')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('unknown')).toBeNull();
    expect(hashIp('0.0.0.0')).toBeNull();
    expect(hashIp(null)).toBeNull();
    expect(hashIp('')).toBeNull();
  });
});
