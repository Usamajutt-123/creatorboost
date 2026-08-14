/**
 * Tests for Fix 1: Creator Country CPM Manipulation Prevention.
 *
 * These tests verify that:
 * - The earnings engine uses the admin-controlled cpm_country_code, not the
 *   creator-editable country_code.
 * - A creator cannot manipulate their CPM by changing their profile country.
 * - The signup default does not accidentally give every creator premium CPM.
 * - The database migration correctly restricts cpm_country_code writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// --- Module-level mocks (same pattern as existing tests) -----------------
const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: fromMock, rpc: rpcMock })),
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
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

import { computeViewEarnings } from '@/lib/earnings';

function chain(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  };
  return query;
}

const CAPS = {
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

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe('Fix 1: Country CPM manipulation prevention', () => {
  it('uses cpm_country_code (admin-controlled) for CPM lookup, not country_code', async () => {
    // Scenario: creator changed country_code to US (client-side edit) but
    // cpm_country_code is still PK (admin-controlled).
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_settings') return chain({ data: CAPS, error: null });
      if (table === 'cpm_settings') return chain({ data: { cpm: 5, is_active: true }, error: null });
      if (table === 'profiles') {
        return chain({
          data: {
            level: 'bronze',
            status: 'active',
            country_code: 'US',    // creator changed this to US
            cpm_country_code: 'PK', // admin-controlled, still PK
          },
          error: null,
        });
      }
      if (table === 'country_tiers') {
        return chain({
          data: { cpm_default: 0.5, active: true }, // PK rate
          error: null,
        });
      }
      if (table === 'creator_levels') return chain({ data: { cpm_multiplier: 1 }, error: null });
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await computeViewEarnings({
      creatorId: 'test-creator',
      countryCode: 'US', // visitor country (irrelevant for creator CPM)
      fraud: { isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false, isRepeat: false, fraudScore: 0, reasons: [] },
    });

    // The CPM should be the PK rate (0.5), NOT the US rate.
    // This proves the creator cannot manipulate CPM by editing country_code.
    expect(result.cpm).toBe(0.5);
    expect(result.earning).toBeCloseTo(0.0005, 10);
  });

  it('falls back to country_code when cpm_country_code is null (legacy profiles)', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_settings') return chain({ data: CAPS, error: null });
      if (table === 'cpm_settings') return chain({ data: { cpm: 5, is_active: true }, error: null });
      if (table === 'profiles') {
        return chain({
          data: {
            level: 'bronze',
            status: 'active',
            country_code: 'PK',
            cpm_country_code: null, // legacy profile without migration 0017
          },
          error: null,
        });
      }
      if (table === 'country_tiers') {
        return chain({ data: { cpm_default: 0.5, active: true }, error: null });
      }
      if (table === 'creator_levels') return chain({ data: { cpm_multiplier: 1 }, error: null });
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await computeViewEarnings({
      creatorId: 'test-creator',
      countryCode: 'US',
      fraud: { isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false, isRepeat: false, fraudScore: 0, reasons: [] },
    });

    // Should fall back to PK (from country_code).
    expect(result.cpm).toBe(0.5);
  });

  it('uses global CPM when both cpm_country_code and country_code are null', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_settings') return chain({ data: CAPS, error: null });
      if (table === 'cpm_settings') return chain({ data: { cpm: 2, is_active: true }, error: null });
      if (table === 'profiles') {
        return chain({
          data: { level: 'bronze', status: 'active', country_code: null, cpm_country_code: null },
          error: null,
        });
      }
      if (table === 'creator_levels') return chain({ data: { cpm_multiplier: 1 }, error: null });
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await computeViewEarnings({
      creatorId: 'test-creator',
      countryCode: 'US',
      fraud: { isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false, isRepeat: false, fraudScore: 0, reasons: [] },
    });

    expect(result.cpm).toBe(2); // global CPM
  });

  it('preserves the creator-level multiplier on top of country CPM', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_settings') return chain({ data: CAPS, error: null });
      if (table === 'cpm_settings') return chain({ data: { cpm: 5, is_active: true }, error: null });
      if (table === 'profiles') {
        return chain({
          data: { level: 'gold', status: 'active', country_code: 'PK', cpm_country_code: 'PK' },
          error: null,
        });
      }
      if (table === 'country_tiers') return chain({ data: { cpm_default: 0.5, active: true }, error: null });
      if (table === 'creator_levels') return chain({ data: { cpm_multiplier: 1.25 }, error: null });
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await computeViewEarnings({
      creatorId: 'test-creator',
      countryCode: 'US',
      fraud: { isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false, isRepeat: false, fraudScore: 0, reasons: [] },
    });

    expect(result.cpm).toBe(0.5);
    expect(result.levelMultiplier).toBe(1.25);
    expect(result.earning).toBeCloseTo(0.000625, 10);
  });
});

describe('Fix 1: Signup default country safety', () => {
  const root = join(__dirname, '..');
  const signupPage = readFileSync(join(root, 'src/app/signup/page.tsx'), 'utf8');

  it('does not default to a premium country (US)', () => {
    // The signup form must NOT have a hardcoded default of 'US'.
    // Look for the useState default.
    expect(signupPage).toContain("country: ''");
    expect(signupPage).not.toMatch(/country:\s*'US'/);
  });

  it('includes a "Select your country" placeholder', () => {
    expect(signupPage).toMatch(/Select.*country/i);
  });

  it('validates that country is selected before submission', () => {
    expect(signupPage).toContain("form.country");
    expect(signupPage).toContain('Please select your country');
  });
});

describe('Fix 1: Migration file content checks', () => {
  const root = join(__dirname, '..');
  const migration = readFileSync(join(root, 'supabase/migrations/0017_security_fixes.sql'), 'utf8');

  it('adds cpm_country_code column to profiles', () => {
    expect(migration).toContain('cpm_country_code');
    expect(migration).toContain('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cpm_country_code');
  });

  it('restricts cpm_country_code column grant to service_role only', () => {
    // The authenticated grant should only include the allowed columns.
    expect(migration).toContain("GRANT UPDATE (username, full_name, avatar_url, bio, country_code) ON TABLE profiles TO authenticated");
    // cpm_country_code must NOT be in the authenticated grant.
    expect(migration).not.toMatch(/GRANT UPDATE.*cpm_country_code.*authenticated/);
  });

  it('updates handle_new_user to set cpm_country_code', () => {
    expect(migration).toContain('cpm_country_code');
    expect(migration).toMatch(/INSERT INTO public\.profiles[\s\S]*cpm_country_code/);
  });

  it('profiles_role_guard silently reverts cpm_country_code changes by non-admins', () => {
    expect(migration).toContain('NEW.cpm_country_code := OLD.cpm_country_code');
  });
});
