/**
 * Custom-page flow — end-to-end coverage of every guarantee the feature
 * promises: server-controlled multipliers, exact page counts, replay/skip
 * protection, and untouched interaction with the existing CPM / country /
 * fraud / earnings systems.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  FLOW_MULTIPLIER,
  FLOW_PAGE_COUNT,
  FLOW_TYPES,
  coerceFlowType,
  flowMultiplierFor,
  flowRequiredPageCount,
  isFlowType,
  validateFlowPages,
} from '@/lib/flow';
import {
  advanceStepToken,
  createInitialStepToken,
  verifyFlowCompletion,
} from '@/lib/flow-token';
import { buildCampaignWritePayload, extractFlowPages } from '@/lib/campaign-payload';

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

describe('flow helpers', () => {
  it('only exposes normal / 4_pages / 5_pages', () => {
    expect([...FLOW_TYPES]).toEqual(['normal', '4_pages', '5_pages']);
  });

  it('flow_type defaults to normal for unknown / missing values', () => {
    expect(coerceFlowType(undefined)).toBe('normal');
    expect(coerceFlowType(null)).toBe('normal');
    expect(coerceFlowType('')).toBe('normal');
    expect(coerceFlowType('1_page')).toBe('normal');
    expect(coerceFlowType('2_pages')).toBe('normal');
    expect(coerceFlowType('3_pages')).toBe('normal');
    expect(coerceFlowType('6_pages')).toBe('normal');
    expect(coerceFlowType('7_pages')).toBe('normal');
    expect(coerceFlowType('unlimited')).toBe('normal');
  });

  it('exposes only three fixed server-side multipliers', () => {
    expect(FLOW_MULTIPLIER.normal).toBe(1.0);
    expect(FLOW_MULTIPLIER['4_pages']).toBe(1.25);
    expect(FLOW_MULTIPLIER['5_pages']).toBe(1.4);
    expect(flowMultiplierFor('normal')).toBe(1.0);
    expect(flowMultiplierFor('4_pages')).toBe(1.25);
    expect(flowMultiplierFor('5_pages')).toBe(1.4);
    // Forged / unknown -> 1.00, never a made-up multiplier.
    expect(flowMultiplierFor('6_pages')).toBe(1.0);
    expect(flowMultiplierFor('unlimited')).toBe(1.0);
    expect(flowMultiplierFor('1.40')).toBe(1.0);
  });

  it('flow page counts are strict', () => {
    expect(FLOW_PAGE_COUNT.normal).toBe(0);
    expect(FLOW_PAGE_COUNT['4_pages']).toBe(4);
    expect(FLOW_PAGE_COUNT['5_pages']).toBe(5);
    expect(flowRequiredPageCount('normal')).toBe(0);
    expect(flowRequiredPageCount('4_pages')).toBe(4);
    expect(flowRequiredPageCount('5_pages')).toBe(5);
  });

  it('isFlowType narrows correctly', () => {
    expect(isFlowType('normal')).toBe(true);
    expect(isFlowType('4_pages')).toBe(true);
    expect(isFlowType('5_pages')).toBe(true);
    expect(isFlowType('3_pages')).toBe(false);
    expect(isFlowType('6_pages')).toBe(false);
    expect(isFlowType(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Server-side page-count validation
// ---------------------------------------------------------------------

function pages(count: number) {
  return Array.from({ length: count }, (_, i) => ({ position: i + 1, title: `Page ${i + 1}` }));
}

describe('validateFlowPages', () => {
  it('normal must have zero pages', () => {
    expect(validateFlowPages('normal', [])).toBeNull();
    expect(validateFlowPages('normal', pages(1))).toMatch(/must not include/i);
  });

  it('4-page flow requires exactly 4 pages', () => {
    expect(validateFlowPages('4_pages', pages(4))).toBeNull();
  });

  it('5-page flow requires exactly 5 pages', () => {
    expect(validateFlowPages('5_pages', pages(5))).toBeNull();
  });

  it('rejects 1-, 2-, 3-page counts for 4_pages', () => {
    expect(validateFlowPages('4_pages', pages(1))).toMatch(/exactly 4/i);
    expect(validateFlowPages('4_pages', pages(2))).toMatch(/exactly 4/i);
    expect(validateFlowPages('4_pages', pages(3))).toMatch(/exactly 4/i);
  });

  it('rejects 6+ pages for 4_pages', () => {
    expect(validateFlowPages('4_pages', pages(6))).toMatch(/exactly 4/i);
    expect(validateFlowPages('4_pages', pages(7))).toMatch(/exactly 4/i);
  });

  it('rejects 4-page count for 5_pages flow', () => {
    expect(validateFlowPages('5_pages', pages(4))).toMatch(/exactly 5/i);
    expect(validateFlowPages('5_pages', pages(6))).toMatch(/exactly 5/i);
  });

  it('does not require per-page titles (they inherit the campaign name)', () => {
    const noTitles = pages(4).map(p => ({ position: p.position }));
    expect(validateFlowPages('4_pages', noTitles)).toBeNull();
  });

  it('requires contiguous positions 1..N', () => {
    const gapped = [
      { position: 1, title: 'A' },
      { position: 3, title: 'B' },
      { position: 4, title: 'C' },
      { position: 5, title: 'D' },
    ];
    expect(validateFlowPages('4_pages', gapped)).toMatch(/without gaps/i);
  });
});

// ---------------------------------------------------------------------
// campaign-payload flow enforcement (surface used by the server action)
// ---------------------------------------------------------------------

describe('buildCampaignWritePayload — flow', () => {
  const base = {
    name: 'Flow campaign',
    description: '',
    category: 'website_traffic' as const,
    destinationUrl: 'https://example.com/dest',
    status: 'active' as const,
    expiresAt: '',
    tasks: [{ id: 'website_visit' as const, title: '', url: 'https://example.com/task' }],
  };

  it('defaults to normal with no pages', () => {
    const payload = buildCampaignWritePayload(base);
    expect(payload.flow_type).toBe('normal');
    expect(extractFlowPages(payload)).toEqual([]);
  });

  it('4_pages requires exactly 4 titled pages', () => {
    expect(() => buildCampaignWritePayload({
      ...base,
      flowType: '4_pages',
      flowPages: [{ position: 1, title: 'A' }, { position: 2, title: 'B' }, { position: 3, title: 'C' }],
    })).toThrow(/exactly 4/i);

    expect(() => buildCampaignWritePayload({
      ...base,
      flowType: '4_pages',
      flowPages: [
        { position: 1, title: 'A' }, { position: 2, title: 'B' },
        { position: 3, title: 'C' }, { position: 4, title: 'D' },
        { position: 5, title: 'E' },
      ],
    })).toThrow(/exactly 4/i);

    const ok = buildCampaignWritePayload({
      ...base,
      flowType: '4_pages',
      flowPages: [
        { position: 1, title: 'A' }, { position: 2, title: 'B' },
        { position: 3, title: 'C' }, { position: 4, title: 'D' },
      ],
    });
    expect(ok.flow_type).toBe('4_pages');
    expect(extractFlowPages(ok)).toHaveLength(4);
  });

  it('5_pages requires exactly 5 titled pages', () => {
    expect(() => buildCampaignWritePayload({
      ...base,
      flowType: '5_pages',
      flowPages: [
        { position: 1, title: 'A' }, { position: 2, title: 'B' },
        { position: 3, title: 'C' }, { position: 4, title: 'D' },
      ],
    })).toThrow(/exactly 5/i);

    const ok = buildCampaignWritePayload({
      ...base,
      flowType: '5_pages',
      flowPages: [
        { position: 1, title: 'A' }, { position: 2, title: 'B' },
        { position: 3, title: 'C' }, { position: 4, title: 'D' },
        { position: 5, title: 'E' },
      ],
    });
    expect(ok.flow_type).toBe('5_pages');
    expect(extractFlowPages(ok)).toHaveLength(5);
  });

  it('rejects normal + custom pages combination', () => {
    expect(() => buildCampaignWritePayload({
      ...base,
      flowType: 'normal',
      flowPages: [{ position: 1, title: 'A' }],
    })).toThrow(/must not include/i);
  });

  it('the write payload never contains a client-settable multiplier', () => {
    const payload = buildCampaignWritePayload({
      ...base,
      flowType: '4_pages',
      flowPages: pages(4),
    });
    // The DB has no multiplier column; the flow_type alone drives payouts.
    expect(payload).not.toHaveProperty('multiplier');
    expect(payload).not.toHaveProperty('flow_multiplier');
    expect(payload).not.toHaveProperty('earning_multiplier');
  });

  it('every page inherits the campaign name and description (single source of truth)', () => {
    const ok = buildCampaignWritePayload({
      ...base,
      description: 'Unlock the good stuff',
      flowType: '5_pages',
      flowPages: pages(5).map((p, i) => ({ position: p.position, buttonText: i === 0 ? 'Continue' : undefined })),
    });
    const extracted = extractFlowPages(ok);
    expect(extracted).toHaveLength(5);
    for (const page of extracted) {
      expect(page.title).toBe('Flow campaign');
      expect(page.description).toBe('Unlock the good stuff');
    }
    // Pages 4/5 never carry an image or button.
    expect(extracted[3].image_url).toBeNull();
    expect(extracted[3].button_text).toBeNull();
    expect(extracted[4].image_url).toBeNull();
    expect(extracted[4].button_text).toBeNull();
    // Pages 1-3 keep the creator-configured button text.
    expect(extracted[0].button_text).toBe('Continue');
  });
});

// ---------------------------------------------------------------------
// Server-signed flow tokens: cannot skip, cannot replay, cannot forge
// ---------------------------------------------------------------------

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  process.env.FLOW_TOKEN_SECRET = 'flow-test-secret';
});

describe('flow tokens', () => {
  it('normal flow cannot issue a step token', () => {
    expect(createInitialStepToken(CAMPAIGN_ID, 'normal' as never)).toBeNull();
  });

  it('completes a 4-page flow only via sequential advance', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '4_pages');
    expect(init).not.toBeNull();
    let token = init!.token;

    for (let step = 1; step <= 3; step++) {
      const res = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: step });
      expect(res.ok).toBe(true);
      if (res.ok && !res.done) token = res.token;
    }
    const done = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: 4 });
    expect(done.ok).toBe(true);
    if (!done.ok || !done.done) throw new Error('expected completion');
    expect(verifyFlowCompletion(done.completionToken, CAMPAIGN_ID, '4_pages')).toEqual({ ok: true, session: expect.any(String) });
  });

  it('completes a 5-page flow only via sequential advance', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '5_pages');
    let token = init!.token;
    for (let step = 1; step <= 4; step++) {
      const res = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '5_pages', nextStep: step });
      expect(res.ok).toBe(true);
      if (res.ok && !res.done) token = res.token;
    }
    const done = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '5_pages', nextStep: 5 });
    expect(done.ok && done.done).toBe(true);
  });

  it('rejects skipping directly to the final page', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '4_pages');
    const skip = advanceStepToken({ token: init!.token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: 4 });
    expect(skip.ok).toBe(false);
  });

  it('rejects repeating the same page number to inflate progress', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '4_pages');
    let token = init!.token;
    const first = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: 1 });
    expect(first.ok).toBe(true);
    if (first.ok && !first.done) token = first.token;
    // Try to advance to step 1 again from the step-1 token.
    const replay = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: 1 });
    expect(replay.ok).toBe(false);
  });

  it('rejects forged/tampered tokens', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '4_pages')!;
    const [enc, sig] = init.token.split('.');
    const tampered = `${enc}.${sig.slice(0, -2)}AA`;
    const res = advanceStepToken({ token: tampered, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: 1 });
    expect(res.ok).toBe(false);
  });

  it('rejects completion token for a different campaign', () => {
    const init = createInitialStepToken(CAMPAIGN_ID, '4_pages')!;
    let token = init.token;
    for (let step = 1; step <= 4; step++) {
      const res = advanceStepToken({ token, campaignId: CAMPAIGN_ID, flowType: '4_pages', nextStep: step });
      if (res.ok && !res.done) token = res.token;
      if (res.ok && res.done) {
        expect(verifyFlowCompletion(res.completionToken, 'ffffffff-ffff-4fff-8fff-ffffffffffff', '4_pages').ok).toBe(false);
      }
    }
  });

  it('a normal completion token is not valid against normal flow', () => {
    // The verifier never accepts anything against normal because normal has
    // no completion token; the server never applies a multiplier here.
    expect(verifyFlowCompletion('anything', CAMPAIGN_ID, 'normal' as never).ok).toBe(false);
  });

  it('cannot forge multiplier via URL — client value ignored entirely', () => {
    // The public multiplier map is closed; even a "1.40" literal in a URL
    // never becomes an accepted multiplier because we look it up by flow.
    expect(flowMultiplierFor('1.40' as never)).toBe(1);
  });
});

// ---------------------------------------------------------------------
// End-to-end earnings check: flow multiplier is applied on top of the
// existing country CPM / global CPM / level pipeline WITHOUT changing
// any of those systems (they are mocked exactly like record-view.test.ts
// so no shared state is required).
// ---------------------------------------------------------------------

const supabaseState: {
  queries: any[];
  rpcCalls: any[];
  responders: Record<string, (q: any) => any>;
  rpcResponder: (name: string, args: any) => { data?: any; error: null } | { error: { message: string } };
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

import { recordView } from '@/lib/earnings';

const CAMPAIGN = {
  id: '22222222-2222-4222-8222-222222222222',
  creator_id: '33333333-3333-4333-8333-333333333333',
  status: 'active',
  slug: 'flow-campaign',
  deleted_at: null,
  expires_at: null,
} as const;

const PLATFORM_SETTINGS = {
  max_earnings_per_view: 1,
  max_views_per_device_per_day: 20,
  max_views_per_ip_per_day: 200,
  creator_daily_earning_cap: 500,
  campaign_daily_earning_cap: 200,
  platform_daily_earning_cap: 10000,
  duplicate_ip_window_hours: 24,
  duplicate_device_block: false,
  fraud_detection_sensitivity: 'medium',
  vpn_block_enabled: true,
};

function resetResponders() {
  supabaseState.responders = {
    'platform_settings:maybeSingle': () => ({ data: PLATFORM_SETTINGS, error: null }),
    'cpm_settings:maybeSingle': () => ({ data: { cpm: 5, is_active: true }, error: null }),
    'country_tiers:maybeSingle': () => ({ data: { cpm_default: 0.5, active: true }, error: null }),
    'profiles:maybeSingle': (q: any) => {
      const hasStatus = q.filters.some(([, k]: any) => k === 'status');
      return {
        data: hasStatus
          ? { level: 'bronze', status: 'active', country_code: 'PK' }
          : { level: 'bronze', status: 'active', country_code: 'PK', referred_by: null },
        error: null,
      };
    },
    'creator_levels:maybeSingle': () => ({ data: { cpm_multiplier: 1.0 }, error: null }),
    'views:maybeSingle': (q: any) => q.insertData
      ? { data: { id: '44444444-4444-4444-8444-444444444444', status: 'valid', invalid_reason: null, cpm_rate: 0.5, earnings: 0.000625, fraud_score: 0, country_code: 'US' }, error: null }
      : { data: null, error: null },
    'earnings:select': () => ({ data: [], error: null, count: 0 }),
    'campaigns:maybeSingle': () => ({ data: { total_earnings: 0 }, error: null }),
  };
  supabaseState.rpcResponder = (_name, args) => ({
    data: { valid: Boolean(args?.p_valid), earning: Number(args?.p_earning || 0), reason: args?.p_valid ? undefined : 'bot' },
    error: null,
  });
}

beforeEach(() => {
  supabaseState.queries = [];
  supabaseState.rpcCalls = [];
  resetResponders();
});

describe('recordView — flow multiplier applied server-side', () => {
  it('normal flow earns 1.00× (unchanged legacy behaviour)', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: 'normal' },
      visitorIp: '8.8.8.8',
    });
    expect(res.valid).toBe(true);
    expect(res.cpm).toBe(0.5);
    expect(res.flowMultiplier).toBe(1);
    // 0.5 * 1 * 1 / 1000 = 0.0005
    expect(res.earning).toBeCloseTo(0.0005, 10);
  });

  it('normal flow cannot receive 1.25× even if request tries to send flowCompletionVerified', async () => {
    // The route only sets flowCompletionVerified after HMAC verification of
    // a completion token, but even if a bug tried to pass it for a normal
    // campaign, the multiplier stays at 1.00 because storedFlow == 'normal'.
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: 'normal' },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
    });
    expect(res.flowMultiplier).toBe(1);
    expect(res.earning).toBeCloseTo(0.0005, 10);
  });

  it('normal flow cannot receive 1.40× (Pakistan example: still $0.50 × 1.00)', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: 'normal' },
      visitorIp: '8.8.8.8',
    });
    expect(res.flowMultiplier).toBe(1);
    // 0.50 * 1.00 / 1000
    expect(res.earning).toBeCloseTo(0.0005, 10);
  });

  it('4-page flow: without verified completion the multiplier is 1.00', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '4_pages' },
      visitorIp: '8.8.8.8',
      // Client did NOT complete flow — server sees no completion token.
      flowCompletionVerified: false,
    });
    expect(res.flowMultiplier).toBe(1);
    expect(res.earning).toBeCloseTo(0.0005, 10);
  });

  it('4-page flow: with verified completion the multiplier is exactly 1.25', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '4_pages' },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
      flowSessionId: 'sess-4',
    });
    expect(res.flowMultiplier).toBe(1.25);
    // Pakistan example: 0.50 × 1.00 (level) × 1.25 (flow) / 1000 = 0.000625
    expect(res.earning).toBeCloseTo(0.000625, 10);
  });

  it('5-page flow: with verified completion the multiplier is exactly 1.40', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '5_pages' },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
      flowSessionId: 'sess-5',
    });
    expect(res.flowMultiplier).toBe(1.4);
    // 0.50 × 1.00 × 1.40 / 1000
    expect(res.earning).toBeCloseTo(0.0007, 10);
  });

  it('forged flow_type on the campaign row is coerced to normal', async () => {
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '6_pages' as never },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
      flowSessionId: 'sess-fake',
    });
    expect(res.flowMultiplier).toBe(1);
  });

  it('fraud/invalid views still earn $0 regardless of flow multiplier', async () => {
    const { assessFraud } = await import('@/lib/fraud');
    vi.mocked(assessFraud).mockResolvedValueOnce({
      isBot: true, isVpn: false, isProxy: false, isEmulator: false, isTor: false,
      isRepeat: false, fraudScore: 95, reasons: ['bot_ua'],
    });
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '5_pages' },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
      flowSessionId: 'sess-fraud',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toBeTruthy(); // exact reason comes from the RPC; earning is what matters
    expect(res.earning).toBe(0);
  });

  it('existing country CPM still resolves — flow multiplies AFTER country/global CPM + level', async () => {
    // Global CPM applies when country override is disabled.
    supabaseState.responders['country_tiers:maybeSingle'] = () => ({ data: { cpm_default: 0.5, active: false }, error: null });
    supabaseState.responders['creator_levels:maybeSingle'] = () => ({ data: { cpm_multiplier: 1.25 }, error: null });
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '4_pages' },
      visitorIp: '8.8.8.8',
      flowCompletionVerified: true,
      flowSessionId: 'sess-country',
    });
    expect(res.cpm).toBe(5); // global CPM
    expect(res.levelMultiplier).toBe(1.25);
    expect(res.flowMultiplier).toBe(1.25);
    // 5 * 1.25 * 1.25 / 1000 = 0.0078125
    expect(res.earning).toBeCloseTo(0.0078125, 10);
  });

  it('existing idempotency prevents replay from multiplying earnings', async () => {
    supabaseState.responders['views:maybeSingle'] = () => ({
      data: { id: 'existing', status: 'valid', invalid_reason: null, cpm_rate: 0.5, earnings: 0.000625, fraud_score: 0, country_code: 'US', accounted_at: '2026-01-01T00:00:00Z' },
      error: null,
    });
    const res = await recordView({
      campaign: { ...CAMPAIGN, flow_type: '4_pages' },
      visitorIp: '8.8.8.8',
      idempotencyKey: 'replay-1',
      flowCompletionVerified: true,
      flowSessionId: 'sess-replay',
    });
    expect(res.duplicate).toBe(true);
    // No new insert or credit RPC despite the completion token being present.
    expect(supabaseState.queries.some(q => q.method === 'insert')).toBe(false);
    expect(supabaseState.rpcCalls.length).toBe(0);
  });
});
