/**
 * Behavioural tests for admin authorization.
 *
 * The rule, enforced identically in the UI, the server actions, RLS and the
 * SECURITY DEFINER RPCs:
 *
 *   authorized  <=>  role IN ('admin','super_admin') AND status = 'active'
 *
 * Before this, a suspended or banned admin lost the /admin UI (the layout
 * redirected them) but kept every server action and every database
 * capability, because the checks only looked at `role`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getSessionUser = vi.fn();
const getDashboardProfile = vi.fn();

vi.mock('@/lib/session', () => ({
  getSessionUser: (...a: unknown[]) => getSessionUser(...a),
  getDashboardProfile: (...a: unknown[]) => getDashboardProfile(...a),
  DASHBOARD_PROFILE_COLUMNS: 'id',
}));

const rpcMock = vi.fn(async () => ({ data: null, error: null }));
const fromMock = vi.fn(() => {
  const q: any = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = () => q;
  q.limit = () => Promise.resolve({ data: [], error: null });
  q.maybeSingle = async () => ({ data: null, error: null });
  q.single = async () => ({ data: null, error: null });
  q.update = () => q;
  return q;
});

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
  createClient: async () => ({ from: fromMock, rpc: rpcMock }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendTemplateEmail: vi.fn(async () => ({ sent: true })),
  isConfigured: () => false,
}));

beforeEach(() => {
  getSessionUser.mockReset();
  getDashboardProfile.mockReset();
  rpcMock.mockClear();
  getSessionUser.mockResolvedValue({ id: 'actor-1' });
});

/** A representative admin-only read and an admin-only write. */
async function adminRead() {
  const { adminLoadLevels } = await import('@/lib/admin-server');
  return adminLoadLevels();
}
async function superAdminWrite() {
  const { adminSetUserRole } = await import('@/lib/admin-server');
  return adminSetUserRole('someone-else', 'admin');
}

describe('active admins retain their privileges', () => {
  it('an active admin is authorized', async () => {
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'admin', status: 'active' });
    await expect(adminRead()).resolves.toBeTruthy();
  });

  it('an active super admin is authorized', async () => {
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'super_admin', status: 'active' });
    await expect(adminRead()).resolves.toBeTruthy();
  });
});

describe('a suspended or banned admin loses privileges', () => {
  it.each(['suspended', 'banned', 'pending_verification'])(
    'a %s admin cannot use an admin server action',
    async status => {
      getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'admin', status });
      await expect(adminRead()).rejects.toThrow(/admin privileges required/i);
    },
  );

  it.each(['suspended', 'banned'])(
    'a %s super admin cannot use a super-admin server action',
    async status => {
      getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'super_admin', status });
      await expect(superAdminWrite()).rejects.toThrow(/privileges required/i);
    },
  );

  it('a suspended super admin also loses ordinary admin actions', async () => {
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'super_admin', status: 'suspended' });
    await expect(adminRead()).rejects.toThrow(/admin privileges required/i);
  });

  it('the refusal does not disclose that the account merely lost status', async () => {
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'admin', status: 'banned' });
    // Identical message to a plain creator's refusal — no "you are banned" oracle.
    await expect(adminRead()).rejects.toThrow('Admin privileges required');
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'creator', status: 'active' });
    await expect(adminRead()).rejects.toThrow('Admin privileges required');
  });
});

describe('normal creators are unaffected', () => {
  it('an active creator is still refused, exactly as before', async () => {
    getDashboardProfile.mockResolvedValue({ id: 'actor-1', role: 'creator', status: 'active' });
    await expect(adminRead()).rejects.toThrow(/admin privileges required/i);
  });

  it('an unauthenticated caller is refused', async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(adminRead()).rejects.toThrow(/not authenticated/i);
  });

  it('a missing profile is refused rather than defaulted to admin', async () => {
    getDashboardProfile.mockResolvedValue(null);
    await expect(adminRead()).rejects.toThrow(/profile not found/i);
  });
});
