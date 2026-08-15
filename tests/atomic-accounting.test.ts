/**
 * Behavioural tests for the atomic view + earning path.
 *
 * The engine used to call `record_view_with_ip_check` and then
 * `credit_view_earning` as two independent statements. A failure in between
 * left a 'valid' view with no ledger row — the creator was underpaid and the
 * counters disagreed with the ledger. `record_view_and_credit` (migration
 * 0021) does the whole thing in one transaction.
 *
 * These drive the real `recordView` against a Supabase double that simulates
 * the RPC's contract, and assert:
 *   * the atomic RPC is the path taken,
 *   * an atomic failure never reports a payable view,
 *   * a replay is idempotent and does not double-credit,
 *   * concurrent duplicates cannot both earn,
 *   * caps still block,
 *   * zero CPM is safe,
 *   * the legacy two-step path is still available for an un-migrated database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { name: string; args: any };

const state: {
  calls: Call[];
  /** Paid slots keyed by `${campaign}:${ipHash}` — mirrors the 24h rule. */
  paidSlots: Set<string>;
  /** Ledger rows created by the atomic RPC. */
  ledger: Array<{ viewId: string; amount: number }>;
  /** Views recorded by the atomic RPC. */
  views: Array<{ id: string; valid: boolean; earning: number }>;
  /** Idempotency key -> original outcome. */
  replays: Map<string, any>;
  atomicAvailable: boolean;
  atomicError: any;
  capSnapshot: Record<string, number>;
} = {
  calls: [],
  paidSlots: new Set(),
  ledger: [],
  views: [],
  replays: new Map(),
  atomicAvailable: true,
  atomicError: null,
  capSnapshot: {},
};

let viewCounter = 0;

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
  referral_percentage: 10,
  earning_holding_hours: 24,
};

let cpmRow: { cpm: number; is_active: boolean } = { cpm: 5, is_active: true };

function buildQuery(table: string) {
  const q: any = {};
  const terminal = async () => {
    if (table === 'platform_settings') return { data: PLATFORM_SETTINGS, error: null };
    if (table === 'cpm_settings') return { data: cpmRow, error: null };
    if (table === 'country_tiers') return { data: null, error: null };
    if (table === 'profiles') return { data: { level: 'gold', status: 'active', cpm_country_code: null, referred_by: null }, error: null };
    if (table === 'creator_levels') return { data: { cpm_multiplier: 1.25 }, error: null };
    if (table === 'campaigns') return { data: { total_earnings: 0 }, error: null };
    return { data: null, error: null };
  };
  q.select = () => q;
  q.eq = () => q;
  q.gte = () => q;
  q.lt = () => q;
  q.limit = () => Promise.resolve({ data: [], error: null, count: 0 });
  q.maybeSingle = terminal;
  q.single = terminal;
  q.insert = () => q;
  if (table === 'views' || table === 'earnings') {
    const list = { data: [], error: null, count: 0 };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.select = () => Object.assign(Promise.resolve(list), q, {
      eq: q.eq, gte: q.gte, limit: () => Promise.resolve(list),
      maybeSingle: async () => ({ data: null, error: null }),
    });
  }
  return q;
}

const supabaseMock = {
  from: vi.fn((table: string) => buildQuery(table)),
  rpc: vi.fn(async (name: string, args: any) => {
    state.calls.push({ name, args });

    if (name === 'view_cap_snapshot') {
      return {
        data: [{
          creator_earnings_today: state.capSnapshot.creator ?? 0,
          campaign_earnings_today: state.capSnapshot.campaign ?? 0,
          platform_earnings_today: state.capSnapshot.platform ?? 0,
          ip_views_today: state.capSnapshot.ipViews ?? 0,
          device_views_today: state.capSnapshot.deviceViews ?? 0,
        }],
        error: null,
      };
    }

    if (name === 'record_view_and_credit') {
      if (!state.atomicAvailable) {
        return { data: null, error: { code: '42883', message: 'function does not exist' } };
      }
      if (state.atomicError) return { data: null, error: state.atomicError };

      const key = args.p_idempotency_key;
      if (key && state.replays.has(key)) return { data: state.replays.get(key), error: null };

      const slot = `${args.p_campaign_id}:${args.p_ip_hash}`;
      let valid = args.p_status === 'valid';
      let reason: string | null = args.p_invalid_reason ?? null;
      let earning = valid ? Number(args.p_earnings) || 0 : 0;

      // The 24h campaign+IP slot, exactly as the RPC enforces it.
      if (valid && args.p_ip_hash && state.paidSlots.has(slot)) {
        valid = false;
        reason = 'duplicate_ip_24h';
        earning = 0;
      }

      const id = `view-${++viewCounter}`;
      state.views.push({ id, valid, earning });
      if (valid) {
        state.paidSlots.add(slot);
        // ATOMIC: the ledger row is written in the same step as the view.
        if (earning > 0) state.ledger.push({ viewId: id, amount: earning });
      }

      const result = {
        processed: true,
        replayed: false,
        view_id: id,
        valid,
        earning,
        reason: valid ? null : reason,
        traffic_category: valid ? 'paid' : 'duplicate_24h',
      };
      if (key) state.replays.set(key, { ...result, replayed: true });
      return { data: result, error: null };
    }

    return { data: null, error: null };
  }),
};

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => supabaseMock,
  createClient: async () => supabaseMock,
}));

vi.mock('@/lib/geo', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/geo')>();
  return { ...actual, getCountryFromIP: vi.fn(async () => 'US') };
});

vi.mock('@/lib/fraud', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/fraud')>();
  return {
    ...actual,
    assessFraud: vi.fn(async () => ({
      isBot: false, isVpn: false, isProxy: false, isEmulator: false,
      isTor: false, isRepeat: false, fraudScore: 0, reasons: [],
    })),
  };
});

import { recordView } from '@/lib/earnings';

const CREATOR_ID = '22222222-2222-4222-8222-222222222222';
const campaign = (id: string, slug: string) => ({
  id, slug, creator_id: CREATOR_ID, status: 'active', deleted_at: null, expires_at: null,
});
const CAMPAIGN_A = campaign('11111111-1111-4111-8111-111111111111', 'a');
const CAMPAIGN_B = campaign('44444444-4444-4444-8444-444444444444', 'b');

const view = (over: Record<string, unknown> = {}) => recordView({
  campaign: CAMPAIGN_A,
  visitorIp: '8.8.8.8',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  tasksCompleted: ['website_visit'],
  requiredTasks: 1,
  ...over,
} as never);

beforeEach(() => {
  state.calls = [];
  state.paidSlots = new Set();
  state.ledger = [];
  state.views = [];
  state.replays = new Map();
  state.atomicAvailable = true;
  state.atomicError = null;
  state.capSnapshot = {};
  cpmRow = { cpm: 5, is_active: true };
  viewCounter = 0;
});

// =====================================================================
describe('the atomic RPC is the primary accounting path', () => {
  it('uses record_view_and_credit, not the legacy two-step pair', async () => {
    const result = await view();
    expect(result.valid).toBe(true);
    const names = state.calls.map(c => c.name);
    expect(names).toContain('record_view_and_credit');
    expect(names).not.toContain('record_view_with_ip_check');
    expect(names).not.toContain('credit_view_earning');
  });

  it('a paid view and its ledger row are created together', async () => {
    const result = await view();
    expect(result.valid).toBe(true);
    expect(result.earning).toBeGreaterThan(0);
    // One view, one ledger row, same id — never a view without a ledger row.
    expect(state.views.filter(v => v.valid)).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].viewId).toBe(state.views[0].id);
    expect(state.ledger[0].amount).toBe(result.earning);
  });

  it('never reports a payable view when the transaction fails', async () => {
    state.atomicError = { code: 'XX000', message: 'deadlock detected' };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.earning).toBe(0);
    // Nothing was written.
    expect(state.ledger).toHaveLength(0);
    expect(state.views).toHaveLength(0);
  });
});

// =====================================================================
describe('idempotency and concurrency', () => {
  it('a replayed idempotency key does not create a second earning', async () => {
    const first = await view({ idempotencyKey: 'replay-1' });
    const second = await view({ idempotencyKey: 'replay-1' });

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(second.earning).toBe(first.earning);
    // One ledger row across both requests.
    expect(state.ledger).toHaveLength(1);
    expect(second.duplicate).toBe(true);
  });

  it('two concurrent requests for the same campaign + IP cannot both earn', async () => {
    const [a, b] = await Promise.all([view(), view()]);
    const paid = [a, b].filter(r => r.valid);
    expect(paid).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
    // The loser earns nothing and is not told why.
    const loser = [a, b].find(r => !r.valid)!;
    expect(loser.earning).toBe(0);
  });

  it('the same IP on a different campaign is still independent', async () => {
    const a = await view();
    const b = await view({ campaign: CAMPAIGN_B });
    expect(a.valid).toBe(true);
    expect(b.valid).toBe(true);
    expect(state.ledger).toHaveLength(2);
  });
});

// =====================================================================
describe('caps remain enforced', () => {
  it('blocks when the creator daily cap would be exceeded', async () => {
    state.capSnapshot = { creator: PLATFORM_SETTINGS.creator_daily_earning_cap };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('creator_daily_cap');
    expect(state.ledger).toHaveLength(0);
  });

  it('blocks when the campaign daily cap would be exceeded', async () => {
    state.capSnapshot = { campaign: PLATFORM_SETTINGS.campaign_daily_earning_cap };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('campaign_daily_cap');
  });

  it('blocks when the platform daily cap would be exceeded', async () => {
    state.capSnapshot = { platform: PLATFORM_SETTINGS.platform_daily_earning_cap };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('platform_daily_cap');
  });

  it('blocks when the per-IP daily view cap is reached', async () => {
    state.capSnapshot = { ipViews: PLATFORM_SETTINGS.max_views_per_ip_per_day };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ip_limit');
  });

  it('computes caps with ONE aggregate round-trip, not per-row downloads', async () => {
    await view();
    expect(state.calls.filter(c => c.name === 'view_cap_snapshot')).toHaveLength(1);
  });
});

// =====================================================================
describe('zero CPM is safe', () => {
  it('records the view with no earning and no ledger row', async () => {
    cpmRow = { cpm: 0, is_active: true };
    const result = await view();
    expect(result.earning).toBe(0);
    expect(result.cpm).toBe(0);
    expect(state.ledger).toHaveLength(0);
    // The view itself is still recorded.
    expect(state.views).toHaveLength(1);
  });

  it('an inactive CPM setting also yields zero, never a hardcoded rate', async () => {
    cpmRow = { cpm: 5, is_active: false };
    const result = await view();
    expect(result.cpm).toBe(0);
    expect(result.earning).toBe(0);
  });
});

// =====================================================================
describe('compatibility with an un-migrated database', () => {
  it('falls back to the legacy two-step path when the atomic RPC is absent', async () => {
    state.atomicAvailable = false;
    await view();
    const names = state.calls.map(c => c.name);
    expect(names).toContain('record_view_and_credit');
    // ...and then the previous pair.
    expect(names).toContain('record_view_with_ip_check');
  });
});

// =====================================================================
describe('the engine never returns fraud internals to its caller as money', () => {
  it('a non-payable outcome always carries a zero earning', async () => {
    state.capSnapshot = { creator: PLATFORM_SETTINGS.creator_daily_earning_cap };
    const result = await view();
    expect(result.valid).toBe(false);
    expect(result.earning).toBe(0);
  });
});
