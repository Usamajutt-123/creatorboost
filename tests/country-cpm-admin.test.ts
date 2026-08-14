import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const getSessionUser = vi.fn();
const getDashboardProfile = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
  getDashboardProfile: (...args: unknown[]) => getDashboardProfile(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: fromMock, rpc: rpcMock })),
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

function chain(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    update: vi.fn(async () => result),
    insert: vi.fn(async () => result),
    delete: vi.fn(() => query),
  };
  return query;
}

describe('country CPM admin authorization', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionUser.mockReset();
    getDashboardProfile.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('rejects a creator who tries to update country CPM rates', async () => {
    getSessionUser.mockResolvedValue({ id: 'creator-1' });
    getDashboardProfile.mockResolvedValue({ id: 'creator-1', role: 'creator' });
    const { adminSaveCountryUpdates } = await import('@/lib/admin-server');
    await expect(adminSaveCountryUpdates([{ id: 1, fields: { cpm_default: 0.5 } }])).rejects.toThrow(/admin/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    getSessionUser.mockResolvedValue(null);
    getDashboardProfile.mockResolvedValue(null);
    const { adminSaveCountryUpdates } = await import('@/lib/admin-server');
    await expect(adminSaveCountryUpdates([{ id: 1, fields: { cpm_default: 0.5 } }])).rejects.toThrow(/authenticated/i);
  });

  it('lets an admin update a country CPM rate', async () => {
    getSessionUser.mockResolvedValue({ id: 'admin-1' });
    getDashboardProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    const updates: unknown[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === 'country_tiers') {
        return {
          update: vi.fn((fields: unknown) => {
            updates.push(fields);
            return {
              eq: vi.fn(async () => ({ data: { id: 1 }, error: null })),
            };
          }),
        };
      }
      return chain({ data: null, error: null });
    });
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { adminSaveCountryUpdates } = await import('@/lib/admin-server');
    const res = await adminSaveCountryUpdates([{ id: 1, fields: { cpm_default: 0.75 } }]);
    expect(res).toEqual({ ok: true });
    expect(updates).toEqual([{ cpm_default: 0.75 }]);
  });

  it('does not allow unsupported country fields (including creator-owned CPM)', async () => {
    getSessionUser.mockResolvedValue({ id: 'admin-1' });
    getDashboardProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    const { adminSaveCountryUpdates } = await import('@/lib/admin-server');
    await expect(adminSaveCountryUpdates([{ id: 1, fields: { country_code: 'US' } }])).rejects.toThrow(/unsupported/i);
  });
});

describe('country CPM security invariants', () => {
  const root = join(__dirname, '..');
  const adminServer = readFileSync(join(root, 'src/lib/admin-server.ts'), 'utf8');
  const earnings = readFileSync(join(root, 'src/lib/earnings.ts'), 'utf8');
  const settings = readFileSync(join(root, 'src/app/dashboard/settings/SettingsClient.tsx'), 'utf8');
  const init = readFileSync(join(root, 'supabase/migrations/0001_init.sql'), 'utf8');
  const hardening = readFileSync(join(root, 'supabase/migrations/0004_security_hardening.sql'), 'utf8');
  const repair = readFileSync(join(root, 'supabase/migrations/0008_production_repair.sql'), 'utf8');

  it('keeps country CPM writes behind requireAdmin', () => {
    expect(adminServer).toMatch(/export async function adminSaveCountryUpdates[\s\S]*await requireAdmin\(\)/);
    expect(adminServer).toMatch(/export async function adminAddCountry[\s\S]*await requireAdmin\(\)/);
    expect(adminServer).toMatch(/export async function adminDeleteCountry[\s\S]*await requireAdmin\(\)/);
  });

  it('uses the creator profile country, not a client-supplied CPM', () => {
    expect(earnings).toMatch(/select\('level, status, cpm_country_code, country_code'\)/);
    expect(earnings).toContain('resolveCreatorCpm');
    expect(earnings).toContain('country_tiers');
    expect(earnings).not.toMatch(/opts\.cpm/);
  });

  it('lets creators change country_code but not country CPM columns', () => {
    expect(settings).toContain('country_code: profile.country_code || null');
    expect(settings).not.toContain('cpm_default');
    expect(settings).not.toContain('country_tiers');
    expect(repair).toContain('GRANT UPDATE (username, full_name, avatar_url, bio, country_code) ON TABLE profiles TO authenticated');
  });

  it('keeps the existing country_tiers table and admin-only write policy', () => {
    expect(init).toContain('CREATE TABLE country_tiers');
    expect(hardening).toContain('CREATE POLICY "admins_manage_country_tiers"');
    expect(init).toContain('CREATE POLICY "public_read_country_tiers"');
  });
});
