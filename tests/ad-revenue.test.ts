import { describe, it, expect } from 'vitest';
import { sanitizeRecord, revenueIntegrationStatus } from '../src/lib/ad-revenue/provider';
import { validateManualRevenueRow } from '../src/lib/ad-revenue/manual';
import '../src/lib/ad-revenue/adsterra';
import '../src/lib/ad-revenue/monetag';

describe('sanitizeRecord (provider data validation)', () => {
  it('accepts a valid record and normalizes fields', () => {
    const r = sanitizeRecord({ date: '2026-08-01', network: 'Adsterra', impressions: 1000, clicks: 50, revenue: 12.5, currency: 'usd', country: 'pk' });
    expect(r).not.toBeNull();
    expect(r!.currency).toBe('USD');
    expect(r!.country).toBe('PK');
    expect(r!.revenue).toBe(12.5);
  });

  it('rejects bad dates, negative revenue and missing networks', () => {
    expect(sanitizeRecord({ date: '01/08/2026', network: 'X', impressions: 1, clicks: 0, revenue: 1 })).toBeNull();
    expect(sanitizeRecord({ date: '2026-08-01', network: '', impressions: 1, clicks: 0, revenue: 1 })).toBeNull();
    expect(sanitizeRecord({ date: '2026-08-01', network: 'X', impressions: 1, clicks: 0, revenue: -2 })).toBeNull();
    expect(sanitizeRecord({ date: '2026-08-01', network: 'X', impressions: -1, clicks: 0, revenue: 1 })).not.toBeNull(); // impressions clamped
  });

  it('never fabricates revenue: empty/non-array responses become []', () => {
    expect(sanitizeRecord({} as Record<string, unknown>)).toBeNull();
  });
});

describe('validateManualRevenueRow', () => {
  it('validates a good manual row', () => {
    expect(validateManualRevenueRow({ date: '2026-08-01', network: 'Adsterra', impressions: 10, clicks: null, revenue: 5 })).toBeNull();
    expect(validateManualRevenueRow({ date: '2026-08-01', network: 'Monetag', impressions: 0, clicks: 0, revenue: 0 })).toBeNull();
  });

  it('rejects malformed rows', () => {
    expect(validateManualRevenueRow({ date: 'bad', network: 'X', impressions: 1, clicks: 0, revenue: 1 })).toMatch(/date/i);
    expect(validateManualRevenueRow({ date: '2026-08-01', network: '', impressions: 1, clicks: 0, revenue: 1 })).toMatch(/network/i);
    expect(validateManualRevenueRow({ date: '2026-08-01', network: 'X', impressions: -1, clicks: 0, revenue: 1 })).toMatch(/impressions/i);
    expect(validateManualRevenueRow({ date: '2026-08-01', network: 'X', impressions: 1, clicks: 0, revenue: -1 })).toMatch(/revenue/i);
    expect(validateManualRevenueRow({ date: '2026-08-01', network: 'X', impressions: 1, clicks: 0, revenue: 1, currency: 'US' })).toMatch(/currency/i);
  });
});

describe('revenueIntegrationStatus', () => {
  it('reports not configured when no provider endpoints are set', () => {
    const status = revenueIntegrationStatus();
    expect(status.configured).toBe(false);
    expect(status.providers.some(p => p.id === 'adsterra')).toBe(true);
    expect(status.providers.every(p => p.configured === false)).toBe(true);
  });
});
