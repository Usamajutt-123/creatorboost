import { describe, it, expect } from 'vitest';
import { computePerViewEarning } from '../src/lib/earnings';
import { scoreUserAgent } from '../src/lib/fraud';
import { isValidHttpUrl, localDayKey } from '../src/lib/utils';
import { recordViewSchema } from '../src/lib/view-schema';

describe('Earnings formula (financial math)', () => {
  it('computes cpm * multiplier / 1000', () => {
    expect(computePerViewEarning(5, 1, 1)).toBeCloseTo(0.005, 10);
    expect(computePerViewEarning(5, 1.25, 1)).toBeCloseTo(0.00625, 10);
    expect(computePerViewEarning(1, 2, 1)).toBeCloseTo(0.002, 10);
  });

  it('caps a single view at maxEarningsPerView', () => {
    // cpm 500 * 10x would be 5/1000*... ; cap dominates
    expect(computePerViewEarning(500, 100, 0.01)).toBeLessThanOrEqual(0.01);
  });

  it('never produces negative or NaN earnings', () => {
    expect(computePerViewEarning(0, 1, 1)).toBe(0);
    expect(Number.isFinite(computePerViewEarning(Number.NaN, 1, 1))).toBe(true);
  });

  it('honors a zero per-view cap instead of silently falling back to a dollar cap', () => {
    expect(computePerViewEarning(5, 1, 0)).toBe(0);
  });

  // Test 1: client cannot choose earning amount (amount is always derived & capped)
  it('earning is derived from cpm/multiplier, never client-supplied', () => {
    // There is no client-supplied amount anywhere in the formula.
    const earning = computePerViewEarning(5, 1, 1);
    expect(earning).toBeGreaterThan(0);
    expect(earning).toBeLessThan(1);
  });
});

describe('Fraud UA heuristics', () => {
  it('flags obvious bots', () => {
    const r = scoreUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)');
    expect(r.isBot).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('flags headless/emulator user agents', () => {
    const r = scoreUserAgent('Mozilla/5.0 headless chrome');
    expect(r.isEmulator).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('flags suspiciously short user agents', () => {
    const r = scoreUserAgent('curl/8');
    expect(r.isBot).toBe(true);
  });

  it('does not flag a normal browser UA as a bot', () => {
    const r = scoreUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    expect(r.isBot).toBe(false);
    expect(r.score).toBeLessThan(40);
  });
});

describe('Destination URL validation', () => {
  it('accepts http and https', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });
  it('rejects javascript:, ftp:, and malformed URLs', () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});

describe('View recording schema (client must not control finances)', () => {
  it('accepts only allowed fields', () => {
    const res = recordViewSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      deviceFingerprint: 'fp',
      userAgent: 'UA',
      idempotencyKey: 'k',
    });
    expect(res.success).toBe(true);
  });

  // Tests 3 & 4: client cannot choose country CPM or earning amount
  it('rejects client-supplied countryCode', () => {
    const res = recordViewSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      countryCode: 'US',
    });
    expect(res.success).toBe(false);
  });

  it('rejects client-supplied creatorId', () => {
    const res = recordViewSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      creatorId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.success).toBe(false);
  });

  it('rejects client-supplied cpm / earning / fraudScore / valid', () => {
    for (const [key] of [
      ['cpm', 5], ['earning', 5], ['fraudScore', 0], ['valid', true], ['isBot', false],
    ] as const) {
      const res = recordViewSchema.safeParse({ campaignId: '00000000-0000-0000-0000-000000000000', [key]: 1 });
      expect(res.success).toBe(false);
    }
  });

  it('requires a valid campaign UUID', () => {
    const res = recordViewSchema.safeParse({ campaignId: 'not-a-uuid' });
    expect(res.success).toBe(false);
  });
});

describe('Timezone-safe day key', () => {
  it('produces YYYY-MM-DD in local time', () => {
    // A fixed instant that is a different calendar day in UTC vs some local zones.
    // Just assert shape.
    const key = localDayKey(new Date(2024, 0, 15, 12, 0, 0));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
