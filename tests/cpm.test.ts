import { afterEach, describe, expect, it, vi } from 'vitest';
import { computePerViewEarning } from '../src/lib/finance';
import {
  existingEarningsRecalculatedOnCpmChange,
  parseActiveCpm,
  validateCpmUpdate,
} from '../src/lib/cpm';

describe('CPM validation (admin source of truth)', () => {
  it('accepts a numeric CPM within min/max', () => {
    expect(validateCpmUpdate({ cpm: 8, minCpm: 1, maxCpm: 20 })).toEqual({
      ok: true, cpm: 8, minCpm: 1, maxCpm: 20,
    });
  });

  it('rejects invalid, negative, and out-of-range CPM', () => {
    expect(validateCpmUpdate({ cpm: 'nope', minCpm: 0, maxCpm: 10 }).ok).toBe(false);
    expect(validateCpmUpdate({ cpm: -1, minCpm: 0, maxCpm: 10 }).ok).toBe(false);
    expect(validateCpmUpdate({ cpm: 50, minCpm: 1, maxCpm: 10 }).ok).toBe(false);
    expect(validateCpmUpdate({ cpm: 5, minCpm: 10, maxCpm: 1 }).ok).toBe(false);
  });

  it('parses the active database CPM and treats inactive as zero', () => {
    expect(parseActiveCpm({ cpm: 8, is_active: true })).toBe(8);
    expect(parseActiveCpm({ cpm: 8, is_active: false })).toBe(0);
    expect(parseActiveCpm(null)).toBe(0);
  });

  it('uses current CPM in the earning formula', () => {
    expect(computePerViewEarning(5, 1, 1)).toBeCloseTo(0.005, 10);
    expect(computePerViewEarning(8, 1, 1)).toBeCloseTo(0.008, 10);
  });

  it('a CPM change affects only new earnings, never already credited ones', () => {
    const alreadyCredited = computePerViewEarning(5, 1, 1);
    const nextView = computePerViewEarning(8, 1, 1);
    expect(alreadyCredited).toBeCloseTo(0.005, 10);
    expect(nextView).toBeCloseTo(0.008, 10);
    expect(existingEarningsRecalculatedOnCpmChange()).toBe(false);
  });
});

const authGetUser = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: fromMock,
  })),
  createAdminClient: vi.fn(() => ({
    from: fromMock,
    rpc: rpcMock,
  })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

function chain(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    upsert: vi.fn(() => query),
    insert: vi.fn(async () => ({ error: null })),
  };
  return query;
}

describe('updateCpmAction authorization', () => {
  afterEach(() => {
    vi.resetModules();
    authGetUser.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('rejects non-admin callers', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fromMock.mockImplementation(() => chain({ data: { role: 'creator' }, error: null }));
    const { updateCpmAction } = await import('@/lib/cpm-actions');
    const res = await updateCpmAction({ cpm: 8, minCpm: 0, maxCpm: 20 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admin/i);
  });

  it('lets an authenticated admin persist a new CPM and write an audit row', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    const previous = { cpm: 5, min_cpm: 0, max_cpm: 100, is_active: true };
    const next = { cpm: 8, min_cpm: 0, max_cpm: 100, updated_at: '2026-08-12T15:30:00.000Z' };
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') return chain({ data: { role: 'admin' }, error: null });
      if (table === 'cpm_settings') {
        const q = chain({ data: previous, error: null });
        q.upsert = vi.fn(() => chain({ data: next, error: null }));
        return q;
      }
      if (table === 'cpm_change_log') {
        return {
          insert: vi.fn(async (row: any) => {
            expect(row.previous_cpm).toBe(5);
            expect(row.new_cpm).toBe(8);
            expect(row.admin_user_id).toBe('admin-1');
            expect(row.action_type).toBe('cpm_changed');
            return { error: null };
          }),
        };
      }
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { updateCpmAction } = await import('@/lib/cpm-actions');
    const res = await updateCpmAction({ cpm: 8, minCpm: 0, maxCpm: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cpm).toBe(8);
  });

  it('rejects an invalid CPM before writing', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    fromMock.mockImplementation(() => chain({ data: { role: 'admin' }, error: null }));
    const { updateCpmAction } = await import('@/lib/cpm-actions');
    const res = await updateCpmAction({ cpm: -3, minCpm: 0, maxCpm: 10 });
    expect(res.ok).toBe(false);
  });
});
