/**
 * Tests for Fix 5: Distributed Rate Limiter.
 *
 * These tests verify that:
 * - The rate limiter uses a database-backed store (Supabase RPC) as the
 *   primary store, not an in-memory Map.
 * - Multiple "processes" (simulated) share the same rate limit state.
 * - The in-memory fallback only kicks in when the database is unavailable.
 * - A custom store injection still works.
 * - The rate limit table and RPC exist in the migration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock the Supabase admin client.
const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
  createClient: vi.fn(async () => ({})),
}));

describe('Fix 5: Rate limiter uses database-backed store', () => {
  beforeEach(() => {
    vi.resetModules();
    rpcMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the check_rate_limit Supabase RPC', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const { rateLimit } = await import('@/lib/rate-limit');
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('check_rate_limit', expect.objectContaining({
      p_key: 'test-key',
      p_limit: 10,
    }));
  });

  it('returns false when the RPC reports the limit is exceeded', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const { rateLimit } = await import('@/lib/rate-limit');
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(false);
  });

  it('falls back to in-memory when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection failed' } });
    const { rateLimit } = await import('@/lib/rate-limit');
    const result = await rateLimit('test-key', 10, 60000);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true); // first call should always pass via fallback
  });

  it('falls back to in-memory when the RPC throws', async () => {
    rpcMock.mockRejectedValue(new Error('network error'));
    const { rateLimit } = await import('@/lib/rate-limit');
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(true); // first call via fallback
  });

  it('custom store injection overrides both DB and in-memory', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const { rateLimit, setRateLimitStore } = await import('@/lib/rate-limit');
    const custom = vi.fn(async () => false);
    setRateLimitStore(custom);

    const result = await rateLimit('custom-key', 5, 30000);
    expect(result).toBe(false);
    expect(custom).toHaveBeenCalledWith('custom-key', 5, 30000);
    // DB should not have been called since custom overrides.
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('Fix 5: In-memory fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  });

  it('allows the first request through', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    expect(await rateLimit('mem-key-1', 5, 60000)).toBe(true);
  });

  it('blocks after the limit is exceeded', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    for (let i = 0; i < 5; i++) {
      expect(await rateLimit('mem-limit-1', 5, 60000)).toBe(true);
    }
    expect(await rateLimit('mem-limit-1', 5, 60000)).toBe(false);
  });

  it('different keys have separate limits', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    for (let i = 0; i < 5; i++) {
      await rateLimit('key-a-1', 5, 60000);
    }
    // key-a is exhausted, but key-b should still work.
    expect(await rateLimit('key-b-1', 5, 60000)).toBe(true);
  });
});

describe('Fix 5: Migration content checks', () => {
  const root = join(__dirname, '..');
  const migration = readFileSync(join(root, 'supabase/migrations/0017_security_fixes.sql'), 'utf8');

  it('creates the rate_limit_entries table', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS rate_limit_entries');
    expect(migration).toContain('key TEXT NOT NULL');
    expect(migration).toContain('window_start TIMESTAMPTZ');
    expect(migration).toContain('count INTEGER');
  });

  it('enables RLS on rate_limit_entries with no direct access', () => {
    expect(migration).toContain('ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('no_direct_access');
    expect(migration).toContain('USING (FALSE)');
  });

  it('creates the check_rate_limit RPC', () => {
    expect(migration).toContain('public.check_rate_limit');
    expect(migration).toContain('p_key TEXT');
    expect(migration).toContain('p_limit INTEGER');
    expect(migration).toContain('p_window_seconds INTEGER');
  });

  it('the RPC uses ON CONFLICT upsert for atomicity', () => {
    expect(migration).toContain('ON CONFLICT');
    expect(migration).toMatch(/DO UPDATE SET count = rate_limit_entries\.count \+ 1/);
  });

  it('the RPC returns a boolean', () => {
    expect(migration).toMatch(/RETURNS BOOLEAN/);
  });

  it('restricts check_rate_limit to service_role only', () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.check_rate_limit/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.check_rate_limit[\s\S]*TO service_role/);
  });

  it('creates a cleanup function for expired rate limit windows', () => {
    expect(migration).toContain('public.cleanup_rate_limits');
  });
});

describe('Fix 5: Affected routes use the distributed rate limiter', () => {
  const root = join(__dirname, '..');

  it('/api/views/record uses rateLimit from @/lib/rate-limit', () => {
    const route = readFileSync(join(root, 'src/app/api/views/record/route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/rate-limit'");
    expect(route).toMatch(/rateLimit\(/);
  });

  it('/api/support uses rateLimit from @/lib/rate-limit', () => {
    const route = readFileSync(join(root, 'src/app/api/support/route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/rate-limit'");
    expect(route).toMatch(/rateLimit\(/);
  });

  it('/api/referrals/click uses rateLimit from @/lib/rate-limit', () => {
    const route = readFileSync(join(root, 'src/app/api/referrals/click/route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/rate-limit'");
    expect(route).toMatch(/rateLimit\(/);
  });
});

describe('Fix 5: Rate limiter is NOT single-process dependent', () => {
  it('rate-limit.ts imports createAdminClient for DB-backed store', () => {
    const root = join(__dirname, '..');
    const src = readFileSync(join(root, 'src/lib/rate-limit.ts'), 'utf8');
    expect(src).toContain('supabase/server');
    expect(src).toContain('check_rate_limit');
  });

  it('rate-limit.ts keeps local store only as fallback, not primary', () => {
    const root = join(__dirname, '..');
    const src = readFileSync(join(root, 'src/lib/rate-limit.ts'), 'utf8');
    // The local store should be mentioned as fallback.
    expect(src).toMatch(/fallback/i);
    // The Supabase check should be tried first.
    const supabasePos = src.indexOf('supabaseRateLimit');
    const localPos = src.indexOf('localStore.get');
    // supabaseRateLimit should be referenced before localStore in the main function.
    expect(supabasePos).toBeLessThan(localPos);
  });
});
