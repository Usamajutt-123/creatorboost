/**
 * Integration tests for the view-recording pipeline (recordView), with the
 * Supabase client mocked at the module boundary. These verify the security
 * invariants of the earnings engine: server-side country/fraud/creator
 * derivation, idempotency, self-view protection, lifecycle guards, and
 * atomic crediting through credit_view_earning.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- mocks -----------------------------------------------------------
const supabaseState: {
  queries: any[];
  rpcCalls: any[];
  responders: Record<string, (q: any) => any>;
  rpcResponder: (name: string, args: any) => { error: null } | { error: { message: string } };
} = {
  queries: [],
  rpcCalls: [],
  responders: {},
  rpcResponder: () => ({ error: null }),
};

function buildQuery(table: string) {
  const q: any = {};
  const state: any = { table, filters: [] };
  const terminal = (method: string) => async (...args: any[]) => {
    const spec = { ...state, method, args };
    supabaseState.queries.push(spec);
    const responder = supabaseState.responders[`${table}:${method}`] || supabaseState.responders[table];
    if (responder) return responder(spec);
    // default: empty success
    if (method === 'maybeSingle' || method === 'single') return { data: null, error: null };
    return { data: [], error: null, count: 0 };
  };
  q.select = (...args: any[]) => { state.selectArgs = args; return q; };
  q.eq = (k: string, v: any) => { state.filters.push(['eq', k, v]); return q; };
  q.gte = (k: string, v: any) => { state.filters.push(['gte', k, v]); return q; };
  q.lt = (k: string, v: any) => { state.filters.push(['lt', k, v]); return q; };
  q.is = (k: string, v: any) => { state.filters.push(['is', k, v]); return q; };
  q.order = () => q;
  q.limit = () => q;
  q.maybeSingle = terminal('maybeSingle');
  q.single = terminal('single');
  q.insert = (data: any) => { state.insertData = data; return q; };
  return q;
}

const supabaseMock = {
  from: vi.fn((table: string) => buildQuery(table)),
  rpc: vi.fn(async (name: string, args: any) => {
    supabaseState.rpcCalls.push({ name, args });
    return supabaseState.rpcResponder(name, args);
  }),
};

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => supabaseMock,
  createClient: () => supabaseMock,
}));

vi.mock('@/lib/geo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geo')>();
  return { ...actual, getCountryFromIP: vi.fn(async () => 'US') };
});

vi.mock('@/lib/fraud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fraud')>();
  return {
    ...actual,
    hashIp: actual.hashIp,
    assessFraud: vi.fn(async () => ({
      isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false,
      isRepeat: false, fraudScore: 0, reasons: [],
    })),
  };
});

import { recordView, computePerViewEarning, computeReferralCommission, computeWithdrawalFee } from '@/lib/earnings';
import { recordViewSchema } from '@/lib/view-schema';

// --- fixtures ---------------------------------------------------------
const CAMPAIGN = {
  id: '11111111-1111-4111-8111-111111111111',
  creator_id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  slug: 'test-campaign',
  deleted_at: null,
  expires_at: null,
};

const PLATFORM_SETTINGS = {
  max_earnings_per_view: 1,
  max_views_per_device_per_day: 20,
  max_views_per_ip_per_day: 200,
  creator_daily_earning_cap: 500,
  campaign_daily_earning_cap: 200,
  platform_daily_earning_cap: 10000,
  duplicate_ip_window_hours: 24,
  duplicate_device_block: true,
  fraud_detection_sensitivity: 'medium',
  vpn_block_enabled: true,
};

function defaultResponders() {
  supabaseState.responders = {
    'platform_settings:maybeSingle': () => ({ data: PLATFORM_SETTINGS, error: null }),
    'platform_settings:single': () => ({ data: PLATFORM_SETTINGS, error: null }),
    'cpm_settings:maybeSingle': () => ({ data: { cpm: 5, is_active: true }, error: null }),
    'country_tiers:maybeSingle': () => ({ data: { cpm_default: 5, active: true }, error: null }),
    'profiles:maybeSingle': (q: any) => {
      const hasStatus = q.filters.some(([op, k]: any) => k === 'status');
      return { data: hasStatus ? { level: 'gold', status: 'active' } : { level: 'gold', referred_by: null }, error: null };
    },
    'creator_levels:maybeSingle': () => ({ data: { cpm_multiplier: 1.25 }, error: null }),
    // The idempotency pre-check and the insert both resolve via maybeSingle;
    // when an insert payload is present, return the created view row.
    'views:maybeSingle': (q: any) =>
      q.insertData
        ? { data: { id: '33333333-3333-4333-8333-333333333333', status: 'valid', invalid_reason: null, cpm_rate: 5, earnings: 0.00625, fraud_score: 0, country_code: 'US' }, error: null }
        : { data: null, error: null },
    'earnings:select': () => ({ data: [], error: null, count: 0 }),
    'campaigns:maybeSingle': () => ({ data: { total_earnings: 0 }, error: null }),
  };
  supabaseState.rpcResponder = () => ({ error: null });
}

beforeEach(() => {
  supabaseState.queries = [];
  supabaseState.rpcCalls = [];
  defaultResponders();
});

// --- tests -------------------------------------------------------------
describe('recordView — happy path', () => {
  it('derives country server-side, credits atomically, and passes correct caps', async () => {
    const res = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-abc',
      tasksCompleted: ['website_visit'],
      idempotencyKey: 'idem-1',
    });

    expect(res.valid).toBe(true);
    expect(res.countryCode).toBe('US');
    // earning = min((5 * 1.25)/1000, 1)
    expect(res.earning).toBeCloseTo(0.00625, 10);
    expect(res.cpm).toBe(5);

    // Atomic credit RPC was called with the inserted view id.
    const credit = supabaseState.rpcCalls.find(c => c.name === 'credit_view_earning');
    expect(credit).toBeDefined();
    expect(credit.args.p_view_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(credit.args.p_creator_id).toBe(CAMPAIGN.creator_id);
    expect(credit.args.p_valid).toBe(true);
    expect(credit.args.p_earning).toBeCloseTo(0.00625, 10);
  });

  it('the client schema rejects every financial field', () => {
    for (const key of ['creatorId', 'countryCode', 'cpm', 'earning', 'fraudScore', 'valid', 'status', 'ip', 'amount']) {
      const res = recordViewSchema.safeParse({ campaignId: CAMPAIGN.id, [key]: key === 'valid' ? true : 'x' });
      expect(res.success, `expected rejection of ${key}`).toBe(false);
    }
  });

  it('rejects a client-supplied valid flag on valid-looking requests', () => {
    const res = recordViewSchema.safeParse({ campaignId: CAMPAIGN.id, valid: true });
    expect(res.success).toBe(false);
  });
});

describe('recordView — security guards', () => {
  it('blocks self-views (authenticated campaign owner)', async () => {
    const res = await recordView({ campaign: CAMPAIGN, visitorIp: '8.8.8.8', sessionUserId: CAMPAIGN.creator_id });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('self_view');
    expect(supabaseState.rpcCalls.length).toBe(0);
  });

  it('blocks inactive / deleted / expired campaigns', async () => {
    const inactive = await recordView({ campaign: { ...CAMPAIGN, status: 'paused' }, visitorIp: '8.8.8.8' });
    expect(inactive.reason).toBe('campaign_inactive');

    const deleted = await recordView({ campaign: { ...CAMPAIGN, deleted_at: new Date().toISOString() }, visitorIp: '8.8.8.8' });
    expect(deleted.reason).toBe('campaign_deleted');

    const expired = await recordView({ campaign: { ...CAMPAIGN, expires_at: new Date(Date.now() - 1000).toISOString() }, visitorIp: '8.8.8.8' });
    expect(expired.reason).toBe('campaign_expired');
  });

  it('treats a replayed idempotency key as a duplicate without re-crediting', async () => {
    supabaseState.responders['views:maybeSingle'] = () => ({
      data: { id: 'old', status: 'valid', invalid_reason: null, cpm_rate: 5, earnings: 0.00625, fraud_score: 0, country_code: 'US' },
      error: null,
    });
    const res = await recordView({ campaign: CAMPAIGN, visitorIp: '8.8.8.8', idempotencyKey: 'replay-key' });
    expect(res.duplicate).toBe(true);
    expect(res.earning).toBeCloseTo(0.00625, 10);
    // No new insert, no credit RPC.
    expect(supabaseState.queries.some(q => q.method === 'insert')).toBe(false);
    expect(supabaseState.rpcCalls.length).toBe(0);
  });

  it('flags bot user agents server-side (client cannot set isBot)', async () => {
    const { assessFraud } = await import('@/lib/fraud');
    vi.mocked(assessFraud).mockResolvedValueOnce({
      isBot: true, isVpn: false, isProxy: false, isEmulator: false, isTor: false,
      isRepeat: false, fraudScore: 95, reasons: ['bot_ua'],
    });
    const res = await recordView({ campaign: CAMPAIGN, visitorIp: '8.8.8.8', userAgent: 'curl/8' });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('bot');
    // The view is still recorded as invalid (for the invalid counter), but
    // the credit RPC must carry p_valid=false and zero earnings.
    const credit = supabaseState.rpcCalls.find(c => c.name === 'credit_view_earning');
    expect(credit).toBeDefined();
    expect(credit.args.p_valid).toBe(false);
    expect(credit.args.p_earning).toBe(0);
  });
});

describe('pure earnings helpers', () => {
  it('computePerViewEarning caps and sanitizes', () => {
    expect(computePerViewEarning(5, 1, 1)).toBeCloseTo(0.005, 10);
    expect(computePerViewEarning(Number.NaN, 1, 1)).toBe(0);
    expect(computePerViewEarning(500, 100, 0.01)).toBeLessThanOrEqual(0.01);
  });

  it('computeReferralCommission respects caps and negatives', () => {
    expect(computeReferralCommission(1, 10)).toBeCloseTo(0.1, 10);
    expect(computeReferralCommission(1, 10, 0.05)).toBeCloseTo(0.05, 10);
    expect(computeReferralCommission(-1, 10)).toBe(0);
    expect(computeReferralCommission(1, -5)).toBe(0);
    expect(computeReferralCommission(Number.NaN, 10)).toBe(0);
  });

  it('computeWithdrawalFee rounds to cents', () => {
    expect(computeWithdrawalFee(100, 2)).toBe(2);
    expect(computeWithdrawalFee(99.99, 2)).toBeCloseTo(2.0, 2);
    expect(computeWithdrawalFee(100, 0)).toBe(0);
    expect(computeWithdrawalFee(-5, 2)).toBe(0);
  });
});
