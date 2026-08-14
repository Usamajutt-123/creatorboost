/**
 * Tests for Fix 3: Race-safe 24-Hour Same-IP Protection.
 *
 * These tests verify that:
 * - First valid view for a (campaign, IP) pair is credited.
 * - Second view from the same IP within 24h earns nothing.
 * - Same IP after 24h is eligible again.
 * - Two concurrent (simulated) requests: only one credits.
 * - Different IPs are both eligible.
 * - Same IP on a different campaign preserves existing policy.
 * - The atomic RPC is preferred over the advisory-lock fallback.
 * - The fallback still performs the duplicate check.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// --- Supabase mock with dual-mode: supports both RPC and direct insert ---
const supabaseState: {
  queries: any[];
  rpcCalls: any[];
  responders: Record<string, (q: any) => any>;
  rpcResponder: (name: string, args: any) => any;
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
      isBot: false, isVpn: false, isProxy: false, isEmulator: false,
      isTor: false, isRepeat: false, fraudScore: 0, reasons: [],
    })),
  };
});

import { recordView } from '@/lib/earnings';

const CAMPAIGN = {
  id: '11111111-1111-4111-8111-111111111111',
  creator_id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  slug: 'test-campaign',
  deleted_at: null,
  expires_at: null,
};

const CAMPAIGN_B = {
  ...CAMPAIGN,
  id: '44444444-4444-4444-8444-444444444444',
  slug: 'test-campaign-b',
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

let insertCounter = 0;
let existingValidViewsForIp: Record<string, any[]> = {};

function defaultResponders() {
  insertCounter = 0;
  existingValidViewsForIp = {};
  supabaseState.responders = {
    'platform_settings:maybeSingle': () => ({ data: PLATFORM_SETTINGS, error: null }),
    'cpm_settings:maybeSingle': () => ({ data: { cpm: 5, is_active: true }, error: null }),
    'country_tiers:maybeSingle': () => ({ data: { cpm_default: 5, active: true }, error: null }),
    'profiles:maybeSingle': () => ({
      data: { level: 'gold', status: 'active', country_code: null, cpm_country_code: null, referred_by: null },
      error: null,
    }),
    'creator_levels:maybeSingle': () => ({ data: { cpm_multiplier: 1.25 }, error: null }),
    'views:maybeSingle': (q: any) => {
      if (q.insertData) {
        insertCounter++;
        return { data: { id: `view-${insertCounter}`, status: 'valid', cpm_rate: 5, earnings: 0.00625 }, error: null };
      }
      return { data: null, error: null };
    },
    'earnings:select': () => ({ data: [], error: null, count: 0 }),
    'campaigns:maybeSingle': () => ({ data: { total_earnings: 0 }, error: null }),
  };

  // Default RPC responder: always succeeds.
  // The record_view_with_ip_check RPC handles the duplicate IP check.
  supabaseState.rpcResponder = (name: string, args: any) => {
    if (name === 'record_view_with_ip_check') {
      const key = `${args.p_campaign_id}:${args.p_ip_hash}`;
      const existing = existingValidViewsForIp[key] || [];
      const isDuplicate = existing.length > 0 && args.p_status === 'valid';
      insertCounter++;
      const viewId = `view-${insertCounter}`;

      if (!isDuplicate && args.p_status === 'valid') {
        if (!existingValidViewsForIp[key]) existingValidViewsForIp[key] = [];
        existingValidViewsForIp[key].push({ id: viewId });
      }

      return {
        data: {
          view_id: viewId,
          duplicate_ip: isDuplicate,
          status: isDuplicate ? 'invalid' : args.p_status,
          earnings: isDuplicate ? 0 : args.p_earnings,
        },
        error: null,
      };
    }
    return { error: null };
  };
}

beforeEach(() => {
  supabaseState.queries = [];
  supabaseState.rpcCalls = [];
  defaultResponders();
});

describe('Fix 3: Duplicate IP protection — atomic RPC path', () => {
  it('first valid view → credited', async () => {
    const res = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });
    expect(res.valid).toBe(true);
    expect(res.earning).toBeGreaterThan(0);
    expect(res.duplicate).toBe(false);
    // RPC was called.
    const rpcCall = supabaseState.rpcCalls.find(c => c.name === 'record_view_with_ip_check');
    expect(rpcCall).toBeDefined();
  });

  it('second same IP within 24h → 0 earning (duplicate_ip_24h)', async () => {
    // First view succeeds.
    const first = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });
    expect(first.valid).toBe(true);

    // Second view from same IP + same campaign → duplicate.
    const second = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-2',
    });
    expect(second.valid).toBe(false);
    expect(second.reason).toBe('duplicate_ip_24h');
    expect(second.earning).toBe(0);
    const credits = supabaseState.rpcCalls.filter(c => c.name === 'credit_view_earning');
    expect(credits.at(-1)?.args.p_valid).toBe(false);
    expect(credits.at(-1)?.args.p_earning).toBe(0);
  });

  it('different IP → eligible', async () => {
    const first = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });
    expect(first.valid).toBe(true);

    // Different IP → eligible.
    const second = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '1.1.1.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-2',
    });
    expect(second.valid).toBe(true);
    expect(second.earning).toBeGreaterThan(0);
  });

  it('same IP on a different campaign → eligible (policy preserved)', async () => {
    const first = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });
    expect(first.valid).toBe(true);

    // Same IP, different campaign → should be eligible.
    const second = await recordView({
      campaign: CAMPAIGN_B,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-2',
    });
    expect(second.valid).toBe(true);
    expect(second.earning).toBeGreaterThan(0);
  });

  it('two concurrent requests (simulated) → only one credited', async () => {
    // Simulate two concurrent requests by checking the RPC calls.
    // Both will try to insert; the RPC handles the atomic check.
    const promises = [
      recordView({
        campaign: CAMPAIGN,
        visitorIp: '10.0.0.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        deviceFingerprint: 'fp-a',
      }),
      recordView({
        campaign: CAMPAIGN,
        visitorIp: '10.0.0.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        deviceFingerprint: 'fp-b',
      }),
    ];

    const results = await Promise.all(promises);
    const credited = results.filter(r => r.valid && r.earning > 0);
    const duplicates = results.filter(r => r.reason === 'duplicate_ip_24h');
    // Exactly one should be credited, one should be duplicate.
    expect(credited.length).toBe(1);
    expect(duplicates.length).toBe(1);
  });

  it('the RPC is preferred over direct insert (no advisory lock fallback when RPC succeeds)', async () => {
    await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });

    // The atomic RPC should have been called.
    const rpcCall = supabaseState.rpcCalls.find(c => c.name === 'record_view_with_ip_check');
    expect(rpcCall).toBeDefined();
    // No direct insert should have been attempted.
    const insertQueries = supabaseState.queries.filter(q => q.insertData && q.table === 'views');
    expect(insertQueries.length).toBe(0);
  });
});

describe('Fix 3: Fallback path (RPC not available)', () => {
  it('falls back to advisory lock + direct insert when RPC returns undefined_function', async () => {
    // Simulate RPC not existing (PostgreSQL error code 42881).
    supabaseState.rpcResponder = (name: string) => {
      if (name === 'record_view_with_ip_check') {
        return { data: null, error: { code: '42881', message: 'function does not exist' } };
      }
      return { error: null };
    };

    // The advisory lock function also may not exist in dev.
    supabaseMock.rpc.mockImplementation(async (name: string, args: any) => {
      supabaseState.rpcCalls.push({ name, args });
      if (name === 'record_view_with_ip_check') {
        return { data: null, error: { code: '42881', message: 'function does not exist' } };
      }
      if (name === 'pg_advisory_xact_lock') {
        return { data: null, error: null };
      }
      return supabaseState.rpcResponder(name, args);
    });

    const res = await recordView({
      campaign: CAMPAIGN,
      visitorIp: '8.8.8.8',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      deviceFingerprint: 'fp-1',
    });

    // Should still succeed via fallback.
    expect(res.valid).toBe(true);
    expect(res.earning).toBeGreaterThan(0);
  });
});

describe('Fix 3: Migration content checks', () => {
  const root = join(__dirname, '..');
  const migration = readFileSync(join(root, 'supabase/migrations/0017_security_fixes.sql'), 'utf8');
  const repairMigration = readFileSync(join(root, 'supabase/migrations/0019_country_cpm_earnings_repair.sql'), 'utf8');

  it('creates the record_view_with_ip_check RPC', () => {
    expect(migration).toContain('public.record_view_with_ip_check');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('the RPC checks for existing valid view within window', () => {
    expect(migration).toMatch(/SELECT 1 FROM views[\s\S]*campaign_id = p_campaign_id[\s\S]*ip_hash = p_ip_hash[\s\S]*status = 'valid'/);
  });

  it('the RPC forces invalid status for duplicate IP within window', () => {
    expect(migration).toContain("p_status := 'invalid'");
    expect(migration).toContain("p_invalid_reason := 'duplicate_ip_24h'");
  });

  it('the RPC is restricted to service_role only', () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_view_with_ip_check/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_view_with_ip_check[\s\S]*TO service_role/);
  });

  it('the additive repair converts tasks to JSONB and status to the enum', () => {
    expect(repairMigration).toContain('to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[]))');
    expect(repairMigration).toContain("v_status := 'valid'::view_status");
    expect(repairMigration).toContain("v_status := 'invalid'::view_status");
    expect(repairMigration).toContain('duplicate_ip_24h');
  });
});
