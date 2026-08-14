/**
 * THE CORE RULE
 * ----------------------------------------------------------------
 *   1 IP + 1 Campaign = max 1 earning-eligible view per rolling 24 hours.
 *   1 IP + a different Campaign = INDEPENDENT eligibility.
 *
 * These tests drive `recordView` against a Supabase mock whose
 * `record_view_with_ip_check` responder simulates the real database
 * behaviour: an advisory-locked, per-(campaign, ip_hash, window) slot.
 *
 * They cover the exact scenario from the specification:
 *
 *   IP A → Campaign A            → paid
 *   IP A → Campaign A (+2h)      → duplicate, no earning
 *   IP A → Campaign B (+3h)      → paid
 *   IP A → Campaign C (+4h)      → paid
 *   IP A → Campaign B (same 24h) → duplicate, no earning
 *   IP A → Campaign A (+24h)     → paid again
 *
 * Plus: concurrency, ledger side effects, admin visibility and the
 * guarantee that a creator never learns a duplicate happened.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashIp } from '@/lib/fraud';

// ---------------------------------------------------------------------
// Supabase mock: a small in-memory stand-in for the `views` table with the
// same uniqueness semantics as migration 0020's partial unique index.
// ---------------------------------------------------------------------
type RecordedView = {
  id: string;
  campaign_id: string;
  ip_hash: string | null;
  status: string;
  invalid_reason: string | null;
  earnings: number;
  createdAtMs: number;
};

const db: {
  views: RecordedView[];
  rpcCalls: Array<{ name: string; args: any }>;
  /** Virtual clock so a "24 hours later" test does not sleep. */
  nowMs: number;
  windowHours: number;
} = { views: [], rpcCalls: [], nowMs: Date.UTC(2026, 0, 10, 12, 0, 0), windowHours: 24 };

let viewCounter = 0;

/** Mirrors the database: only PAID views occupy a campaign+IP 24h slot. */
function findPaidViewInWindow(campaignId: string, ipHash: string | null): RecordedView | undefined {
  if (!ipHash) return undefined;
  const cutoff = db.nowMs - db.windowHours * 3_600_000;
  return db.views.find(v =>
    v.campaign_id === campaignId &&
    v.ip_hash === ipHash &&
    v.status === 'valid' &&
    v.createdAtMs >= cutoff);
}

function buildQuery(table: string) {
  const state: any = { table, filters: [] };
  const q: any = {};
  const terminal = () => async () => {
    if (table === 'platform_settings') return { data: PLATFORM_SETTINGS, error: null };
    if (table === 'cpm_settings') return { data: { cpm: 5, is_active: true }, error: null };
    if (table === 'country_tiers') return { data: null, error: null };
    if (table === 'profiles') {
      return { data: { level: 'gold', status: 'active', cpm_country_code: null, referred_by: null }, error: null };
    }
    if (table === 'creator_levels') return { data: { cpm_multiplier: 1.25 }, error: null };
    if (table === 'campaigns') return { data: { total_earnings: 0 }, error: null };
    return { data: null, error: null };
  };
  q.select = () => q;
  q.eq = (k: string, v: any) => { state.filters.push([k, v]); return q; };
  q.gte = () => q;
  q.limit = () => q;
  q.maybeSingle = terminal();
  q.single = terminal();
  // `views` list/count reads (fraud frequency, device caps, IP caps).
  q.then = undefined;
  if (table === 'views' || table === 'earnings') {
    const listResult = { data: [], error: null, count: 0 };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.select = () => Object.assign(Promise.resolve(listResult), q, {
      eq: q.eq, gte: q.gte, limit: () => Promise.resolve(listResult), maybeSingle: async () => ({ data: null, error: null }),
    });
  }
  return q;
}

const supabaseMock = {
  from: vi.fn((table: string) => buildQuery(table)),
  rpc: vi.fn(async (name: string, args: any) => {
    db.rpcCalls.push({ name, args });

    if (name === 'record_view_with_ip_check') {
      const campaignId: string = args.p_campaign_id;
      const ipHash: string | null = args.p_ip_hash;
      let status: string = args.p_status;
      let reason: string | null = args.p_invalid_reason;
      let earnings: number = Number(args.p_earnings) || 0;

      // The atomic campaign + IP + 24h check, exactly as the RPC does it.
      let duplicate = false;
      if (status === 'valid' && ipHash && findPaidViewInWindow(campaignId, ipHash)) {
        duplicate = true;
        status = 'invalid';
        reason = 'duplicate_ip_24h';
        earnings = 0;
      }

      const view: RecordedView = {
        id: `view-${++viewCounter}`,
        campaign_id: campaignId,
        ip_hash: ipHash,
        status,
        invalid_reason: reason,
        earnings,
        createdAtMs: db.nowMs,
      };
      db.views.push(view);

      return {
        data: {
          view_id: view.id,
          duplicate_ip: duplicate,
          status,
          earnings,
          traffic_category: status === 'valid' ? 'paid' : 'duplicate_24h',
          earning_eligible: status === 'valid',
        },
        error: null,
      };
    }

    if (name === 'credit_view_earning') {
      // The ledger RPC re-checks the stored view before crediting.
      const view = db.views.find(v => v.id === args.p_view_id);
      const valid = args.p_valid === true && view?.status === 'valid';
      return {
        data: valid
          ? { processed: true, valid: true, earning: Number(args.p_earning) || 0 }
          : { processed: true, valid: false, reason: view?.invalid_reason || 'invalid_traffic' },
        error: null,
      };
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

const PLATFORM_SETTINGS = {
  max_earnings_per_view: 1,
  max_views_per_device_per_day: 20,
  max_views_per_ip_per_day: 200,
  creator_daily_earning_cap: 500,
  campaign_daily_earning_cap: 200,
  platform_daily_earning_cap: 10000,
  duplicate_ip_window_hours: 24,
  duplicate_device_block: false, // isolate the IP rule under test
  fraud_detection_sensitivity: 'medium',
  vpn_block_enabled: true,
};

const CREATOR_ID = '22222222-2222-4222-8222-222222222222';
const campaign = (id: string, slug: string) => ({
  id, slug, creator_id: CREATOR_ID, status: 'active', deleted_at: null, expires_at: null,
});

const CAMPAIGN_A = campaign('11111111-1111-4111-8111-111111111111', 'campaign-a');
const CAMPAIGN_B = campaign('44444444-4444-4444-8444-444444444444', 'campaign-b');
const CAMPAIGN_C = campaign('55555555-5555-4555-8555-555555555555', 'campaign-c');

const IP_A = '8.8.8.8';
const IP_B = '1.1.1.1';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function visit(camp: typeof CAMPAIGN_A, ip: string, extra: Record<string, unknown> = {}) {
  return recordView({ campaign: camp, visitorIp: ip, userAgent: BROWSER_UA, ...extra });
}

/** Advance the virtual clock. */
function advanceHours(hours: number) {
  db.nowMs += hours * 3_600_000;
}

beforeEach(() => {
  db.views = [];
  db.rpcCalls = [];
  db.nowMs = Date.UTC(2026, 0, 10, 12, 0, 0);
  db.windowHours = 24;
  viewCounter = 0;
});

// =====================================================================
describe('24h duplicate protection — the exact specified scenario', () => {
  it('walks the full IP A timeline across campaigns A, B and C', async () => {
    // Campaign A → first valid view → creator view + earning
    const a1 = await visit(CAMPAIGN_A, IP_A);
    expect(a1.valid).toBe(true);
    expect(a1.earning).toBeGreaterThan(0);
    expect(a1.category).toBe('paid');

    // Campaign A → 2 hours later → duplicate → no creator earning
    advanceHours(2);
    const a2 = await visit(CAMPAIGN_A, IP_A);
    expect(a2.valid).toBe(false);
    expect(a2.reason).toBe('duplicate_ip_24h');
    expect(a2.earning).toBe(0);
    expect(a2.category).toBe('duplicate_24h');

    // Campaign B → 3 hours later → valid (independent campaign)
    advanceHours(1);
    const b1 = await visit(CAMPAIGN_B, IP_A);
    expect(b1.valid).toBe(true);
    expect(b1.earning).toBeGreaterThan(0);

    // Campaign C → 4 hours later → valid (independent campaign)
    advanceHours(1);
    const c1 = await visit(CAMPAIGN_C, IP_A);
    expect(c1.valid).toBe(true);
    expect(c1.earning).toBeGreaterThan(0);

    // Campaign B → same 24h window → duplicate
    advanceHours(1);
    const b2 = await visit(CAMPAIGN_B, IP_A);
    expect(b2.valid).toBe(false);
    expect(b2.reason).toBe('duplicate_ip_24h');
    expect(b2.earning).toBe(0);

    // Campaign A → after 24h from the first A view → eligible again
    advanceHours(20); // total elapsed since a1 = 25h
    const a3 = await visit(CAMPAIGN_A, IP_A);
    expect(a3.valid).toBe(true);
    expect(a3.earning).toBeGreaterThan(0);
    expect(a3.category).toBe('paid');
  });

  it('same IP + same campaign within 24h → no creator earning', async () => {
    await visit(CAMPAIGN_A, IP_A);
    advanceHours(23);
    const second = await visit(CAMPAIGN_A, IP_A);
    expect(second.valid).toBe(false);
    expect(second.earning).toBe(0);
    expect(second.reason).toBe('duplicate_ip_24h');
  });

  it('same IP + same campaign after 24h → earning allowed', async () => {
    const first = await visit(CAMPAIGN_A, IP_A);
    expect(first.valid).toBe(true);
    advanceHours(25);
    const second = await visit(CAMPAIGN_A, IP_A);
    expect(second.valid).toBe(true);
    expect(second.earning).toBeGreaterThan(0);
  });

  it('same IP + different campaign within 24h → earning allowed', async () => {
    await visit(CAMPAIGN_A, IP_A);
    const other = await visit(CAMPAIGN_B, IP_A);
    expect(other.valid).toBe(true);
    expect(other.earning).toBeGreaterThan(0);
  });

  it('different IP + same campaign → earning allowed', async () => {
    await visit(CAMPAIGN_A, IP_A);
    const other = await visit(CAMPAIGN_A, IP_B);
    expect(other.valid).toBe(true);
    expect(other.earning).toBeGreaterThan(0);
  });

  it('is NOT a site-wide per-IP limit — one IP earns across many campaigns', async () => {
    const results = [
      await visit(CAMPAIGN_A, IP_A),
      await visit(CAMPAIGN_B, IP_A),
      await visit(CAMPAIGN_C, IP_A),
    ];
    expect(results.every(r => r.valid && r.earning > 0)).toBe(true);
  });

  it('keeps a shared/NAT IP earning on every campaign it has not seen', async () => {
    // A university NAT: many people, one egress IP, browsing different links.
    await visit(CAMPAIGN_A, IP_A);
    const stillPaid = await visit(CAMPAIGN_B, IP_A);
    expect(stillPaid.valid).toBe(true);
  });

  it('uses the hashed IP, never the raw IP, as the uniqueness key', async () => {
    await visit(CAMPAIGN_A, IP_A);
    const call = db.rpcCalls.find(c => c.name === 'record_view_with_ip_check');
    expect(call).toBeDefined();
    expect(call!.args.p_ip_hash).toBe(hashIp(IP_A));
    expect(call!.args.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(call!.args.p_ip_hash).not.toContain(IP_A);
  });
});

// =====================================================================
describe('concurrency — only one paid view per campaign + IP + 24h', () => {
  it('two concurrent identical requests produce exactly one earning', async () => {
    const [first, second] = await Promise.all([
      visit(CAMPAIGN_A, IP_A, { deviceFingerprint: 'fp-a' }),
      visit(CAMPAIGN_A, IP_A, { deviceFingerprint: 'fp-b' }),
    ]);

    const paid = [first, second].filter(r => r.valid && r.earning > 0);
    const duplicates = [first, second].filter(r => r.reason === 'duplicate_ip_24h');
    expect(paid).toHaveLength(1);
    expect(duplicates).toHaveLength(1);

    // Exactly one paid row exists in the simulated table.
    expect(db.views.filter(v => v.status === 'valid')).toHaveLength(1);
  });

  it('five concurrent requests still credit exactly one', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => visit(CAMPAIGN_A, IP_A, { deviceFingerprint: `fp-${i}` })),
    );
    expect(results.filter(r => r.valid && r.earning > 0)).toHaveLength(1);
    expect(results.filter(r => r.reason === 'duplicate_ip_24h')).toHaveLength(4);
    expect(db.views.filter(v => v.status === 'valid')).toHaveLength(1);
  });

  it('concurrent requests on DIFFERENT campaigns all earn', async () => {
    const results = await Promise.all([
      visit(CAMPAIGN_A, IP_A),
      visit(CAMPAIGN_B, IP_A),
      visit(CAMPAIGN_C, IP_A),
    ]);
    expect(results.filter(r => r.valid && r.earning > 0)).toHaveLength(3);
  });

  it('the duplicate check and the insert happen in ONE atomic RPC call', async () => {
    await visit(CAMPAIGN_A, IP_A);
    // No separate SELECT-then-INSERT: a single RPC performs both.
    const recordCalls = db.rpcCalls.filter(c => c.name === 'record_view_with_ip_check');
    expect(recordCalls).toHaveLength(1);
    // And the campaign id is part of the key, so the lock is per-campaign.
    expect(recordCalls[0].args.p_campaign_id).toBe(CAMPAIGN_A.id);
  });
});

// =====================================================================
describe('earnings ledger — duplicates must never credit', () => {
  it('a duplicate view sends p_valid=false and p_earning=0 to the ledger RPC', async () => {
    await visit(CAMPAIGN_A, IP_A);
    db.rpcCalls.length = 0;

    const dup = await visit(CAMPAIGN_A, IP_A);
    expect(dup.valid).toBe(false);

    const credit = db.rpcCalls.find(c => c.name === 'credit_view_earning');
    expect(credit).toBeDefined();
    expect(credit!.args.p_valid).toBe(false);
    expect(credit!.args.p_earning).toBe(0);
  });

  it('a duplicate view never yields a positive earning to the caller', async () => {
    await visit(CAMPAIGN_A, IP_A);
    const dup = await visit(CAMPAIGN_A, IP_A);
    expect(dup.earning).toBe(0);
    expect(dup.valid).toBe(false);
  });

  it('the first view credits with the unchanged CPM formula', async () => {
    // cpm 5 × level multiplier 1.25 / 1000 = 0.00625
    const paid = await visit(CAMPAIGN_A, IP_A);
    expect(paid.cpm).toBe(5);
    expect(paid.levelMultiplier).toBe(1.25);
    expect(paid.earning).toBeCloseTo(0.00625, 10);

    const credit = db.rpcCalls.find(c => c.name === 'credit_view_earning');
    expect(credit!.args.p_valid).toBe(true);
    expect(credit!.args.p_earning).toBeCloseTo(0.00625, 10);
  });

  it('the stored duplicate row carries zero earnings', async () => {
    await visit(CAMPAIGN_A, IP_A);
    await visit(CAMPAIGN_A, IP_A);
    const duplicateRow = db.views.find(v => v.invalid_reason === 'duplicate_ip_24h');
    expect(duplicateRow).toBeDefined();
    expect(duplicateRow!.earnings).toBe(0);
    expect(duplicateRow!.status).toBe('invalid');
  });
});

// =====================================================================
describe('admin visibility vs creator privacy', () => {
  it('the duplicate is still RECORDED so admins can see the traffic', async () => {
    await visit(CAMPAIGN_A, IP_A);
    await visit(CAMPAIGN_A, IP_A);
    // Both the paid view and the duplicate exist in `views`.
    expect(db.views).toHaveLength(2);
    expect(db.views.filter(v => v.status === 'valid')).toHaveLength(1);
    expect(db.views.filter(v => v.invalid_reason === 'duplicate_ip_24h')).toHaveLength(1);
  });

  it('classifies the duplicate under an admin-safe category', async () => {
    await visit(CAMPAIGN_A, IP_A);
    const dup = await visit(CAMPAIGN_A, IP_A);
    expect(dup.category).toBe('duplicate_24h');
  });

  it('the duplicate category is flagged as NOT creator-visible', async () => {
    const { isCreatorVisibleCategory } = await import('@/lib/view-eligibility');
    await visit(CAMPAIGN_A, IP_A);
    const dup = await visit(CAMPAIGN_A, IP_A);
    expect(isCreatorVisibleCategory(dup.category)).toBe(false);
  });

  it('a paid view is creator-visible', async () => {
    const { isCreatorVisibleCategory } = await import('@/lib/view-eligibility');
    const paid = await visit(CAMPAIGN_A, IP_A);
    expect(isCreatorVisibleCategory(paid.category)).toBe(true);
  });
});

// =====================================================================
describe('server-derived signals reach the fraud engine', () => {
  it('forwards header signals, session timing and task count', async () => {
    const { assessFraud } = await import('@/lib/fraud');
    const headerSignals = { isBot: false, isEmulator: false, score: 40, reasons: ['missing_accept_language'] };

    await visit(CAMPAIGN_A, IP_A, { headerSignals, sessionSeconds: 42, requiredTasks: 3 });

    expect(vi.mocked(assessFraud)).toHaveBeenCalledWith(
      expect.objectContaining({
        headerSignals,
        sessionSeconds: 42,
        requiredTasks: 3,
        userAgent: BROWSER_UA,
      }),
    );
  });

  it('a bot assessment produces a non-paid, admin-categorised view', async () => {
    const { assessFraud } = await import('@/lib/fraud');
    vi.mocked(assessFraud).mockResolvedValueOnce({
      isBot: true, isVpn: false, isProxy: false, isEmulator: false,
      isTor: false, isRepeat: false, fraudScore: 95, reasons: ['automation_ua'],
    });

    const result = await visit(CAMPAIGN_A, IP_A);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bot');
    expect(result.earning).toBe(0);
    expect(result.category).toBe('bot_or_automation');

    // Recorded for admin analytics, credited to nobody.
    const credit = db.rpcCalls.find(c => c.name === 'credit_view_earning');
    expect(credit!.args.p_valid).toBe(false);
    expect(credit!.args.p_earning).toBe(0);
  });

  it('a blocked bot does not consume the 24h slot — a real visitor still earns', async () => {
    const { assessFraud } = await import('@/lib/fraud');
    vi.mocked(assessFraud).mockResolvedValueOnce({
      isBot: true, isVpn: false, isProxy: false, isEmulator: false,
      isTor: false, isRepeat: false, fraudScore: 95, reasons: ['automation_ua'],
    });
    await visit(CAMPAIGN_A, IP_A);

    // A genuine visitor behind the same NAT IP is still eligible.
    const human = await visit(CAMPAIGN_A, IP_A);
    expect(human.valid).toBe(true);
    expect(human.earning).toBeGreaterThan(0);
  });
});
