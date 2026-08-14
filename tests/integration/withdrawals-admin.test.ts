/**
 * Integration tests for withdrawal request + admin authorization, with the
 * Supabase clients mocked at the module boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const state: {
  rpcCalls: Array<{ name: string; args: any }>;
  updates: Array<{ table: string; data: any; id: any }>;
  authUser: { id: string } | null;
  profiles: Record<string, any>;
} = {
  rpcCalls: [],
  updates: [],
  authUser: { id: 'user-1' },
  profiles: {},
};

function makeClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.authUser }, error: null })),
    },
    rpc: vi.fn(async (name: string, args: any) => {
      state.rpcCalls.push({ name, args });
      if (name === 'request_withdrawal') {
        if (args.p_user_id !== state.authUser?.id) return { data: { success: false, error: 'Unauthorized' }, error: null };
        return { data: { success: true, withdrawal_id: 'wd-1', fee: 0, total: 100 }, error: null };
      }
      if (name === 'audit_action') return { data: null, error: null };
      if (name === 'approve_withdrawal') return { data: null, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const q: any = {};
      let idFilter: string | null = null;
      q.select = () => q;
      q.eq = (k: string, v: any) => { if (k === 'id') idFilter = v; return q; };
      q.in = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: idFilter ? (state.profiles[idFilter] ?? null) : null, error: null });
      q.single = async () => ({ data: idFilter ? (state.profiles[idFilter] ?? null) : null, error: null });
      q.update = (data: any) => { state.updates.push({ table, data, id: idFilter }); return q; };
      return q;
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => makeClient(),
  createAdminClient: () => makeClient(),
}));

import { requestWithdrawalAction } from '@/lib/withdraw-actions';
import { adminSetUserStatus, adminSetUserRole, adminApproveWithdrawal, adminSaveSettings } from '@/lib/admin-server';

beforeEach(() => {
  state.rpcCalls = [];
  state.updates = [];
  state.authUser = { id: 'user-1' };
  state.profiles = {
    'user-1': { role: 'creator', status: 'active', email: 'actor@creatorboost.io' },
  };
});

describe('requestWithdrawalAction', () => {
  it('rejects unauthenticated requests', async () => {
    state.authUser = null;
    const res = await requestWithdrawalAction({ amount: 50, method: 'paypal', account: 'a@b.com' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('Not authenticated');
  });

  it('validates input before calling the RPC', async () => {
    const bad = await requestWithdrawalAction({ amount: -5, method: 'paypal', account: 'x' });
    expect(bad.success).toBe(false);

    const noMethod = await requestWithdrawalAction({ amount: 50, method: '', account: 'x' });
    expect(noMethod.success).toBe(false);

    expect(state.rpcCalls.length).toBe(0);
  });

  it('submits a valid withdrawal through the RPC with the acting user id', async () => {
    const res = await requestWithdrawalAction({ amount: 50, method: 'paypal', account: 'a@b.com' });
    expect(res.success).toBe(true);
    expect(res.withdrawalId).toBe('wd-1');
    const call = state.rpcCalls.find(c => c.name === 'request_withdrawal');
    expect(call).toBeDefined();
    expect(call!.args.p_user_id).toBe('user-1');
    expect(call!.args.p_amount).toBe(50);
  });
});

describe('admin authorization (privilege escalation)', () => {
  it('blocks non-admins from user status changes', async () => {
    state.profiles['user-1'] = { role: 'creator', status: 'active', email: 'x@y.com' };
    await expect(adminSetUserStatus('user-2', 'banned')).rejects.toThrow('Admin privileges required');
  });

  it('blocks creators from changing platform ads', async () => {
    state.profiles['user-1'] = { role: 'creator', status: 'active' };
    await expect(adminSaveSettings({
      banner_enabled: true,
      banner_code: '<ins>creator ad</ins>',
    })).rejects.toThrow('Admin privileges required');
    expect(state.updates.some(update => update.table === 'platform_settings')).toBe(false);
  });

  it('allows admins and super admins to save platform ads through the protected action', async () => {
    const adSettings = {
      banner_enabled: true,
      banner_code: '<ins>platform banner</ins>',
      banner_url: 'https://ads.example/banner',
      popunder_enabled: true,
      popunder_code: '',
      popunder_url: 'https://ads.example/popunder',
    };

    for (const role of ['admin', 'super_admin']) {
      state.profiles['user-1'] = { role, status: 'active' };
      state.updates = [];
      const result = await adminSaveSettings(adSettings);
      expect(result.ok).toBe(true);
      const update = state.updates.find(item => item.table === 'platform_settings');
      expect(update?.data).toMatchObject({
        banner_enabled: true,
        banner_code: '<ins>platform banner</ins>',
        banner_url: 'https://ads.example/banner',
        popunder_enabled: true,
        popunder_code: null,
        popunder_url: 'https://ads.example/popunder',
      });
    }
  });

  it('blocks admins from changing roles (super-admin only)', async () => {
    state.profiles['user-1'] = { role: 'admin', status: 'active' };
    await expect(adminSetUserRole('user-2', 'super_admin')).rejects.toThrow('Super admin privileges required');
  });

  it('blocks an admin from modifying a super_admin account', async () => {
    state.profiles['user-1'] = { role: 'admin', status: 'active' };
    state.profiles['super-1'] = { role: 'super_admin', status: 'active', email: 'x@y.com' };
    await expect(adminSetUserStatus('super-1', 'banned')).rejects.toThrow('Only super admin can modify a super admin account');
  });

  it('lets a super admin change roles and audits the action', async () => {
    state.profiles['user-1'] = { role: 'super_admin', status: 'active' };
    state.profiles['user-2'] = { role: 'creator', status: 'active' };
    const res = await adminSetUserRole('user-2', 'admin');
    expect(res.ok).toBe(true);
    const audit = state.rpcCalls.find(c => c.name === 'audit_action');
    expect(audit).toBeDefined();
    expect(audit!.args.p_action).toBe('role_change');
  });
});

describe('withdrawal processing emails are triggered but never fatal', () => {
  it('approveWithdrawal calls the RPC and does not throw when email is not configured', async () => {
    state.profiles['user-1'] = { role: 'admin', status: 'active' };
    state.profiles['wd-user'] = { role: 'creator', status: 'active', email: 'creator@x.com' };
    // withdrawalUserEmail reads withdrawals -> user_id, then profiles by id.
    const res = await adminApproveWithdrawal('wd-1');
    expect(res.ok).toBe(true);
    expect(state.rpcCalls.some(c => c.name === 'approve_withdrawal')).toBe(true);
  });
});
