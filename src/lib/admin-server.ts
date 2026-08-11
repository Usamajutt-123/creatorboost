'use server';

/**
 * Server-side administrative operations.
 *
 * SECURITY MODEL
 *  - The acting user's identity is ALWAYS derived from the session
 *    (never from the client). Their role is read from the database.
 *  - Privileged writes use the service-role client (bypasses RLS, which is
 *    intended here because RLS is not bypassed without authorization).
 *  - Every mutation is authorized against the role hierarchy:
 *        creator < admin < super_admin
 *    and recorded in the audit_log.
 *  - Normal admins cannot grant or modify super_admin privileges.
 */

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

type Admin = { id: string; role: string };

async function requireAuth(): Promise<Admin> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) throw new Error('Profile not found');
  return { id: user.id, role: profile.role };
}

async function requireAdmin(): Promise<Admin> {
  const admin = await requireAuth();
  if (admin.role !== 'admin' && admin.role !== 'super_admin') {
    throw new Error('Admin privileges required');
  }
  return admin;
}

async function requireSuperAdmin(): Promise<Admin> {
  const admin = await requireAuth();
  if (admin.role !== 'super_admin') {
    throw new Error('Super admin privileges required');
  }
  return admin;
}

function clientIp(): string | null {
  try {
    const h = headers();
    return h.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  } catch {
    return null;
  }
}

async function audit(admin: Admin, action: string, entityType: string, entityId?: string, oldValues?: unknown, newValues?: unknown) {
  try {
    const supabase = createAdminClient();
    await supabase.rpc('audit_action', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId || null,
      p_old_values: oldValues ? JSON.parse(JSON.stringify(oldValues)) : null,
      p_new_values: newValues ? JSON.parse(JSON.stringify(newValues)) : null,
      p_ip: clientIp(),
      p_actor_id: admin.id,
    });
  } catch (e) {
    console.error('[admin] audit failed', e);
  }
}

export async function serverAdminMe() {
  try {
    const admin = await requireAuth();
    const supabase = createAdminClient();
    const { data: profile } = await supabase.from('profiles').select('id, full_name, email, role, status').eq('id', admin.id).single();
    return { ok: true, admin: profile, isSuper: profile?.role === 'super_admin' };
  } catch {
    return { ok: false, admin: null, isSuper: false };
  }
}

// ------------------------------------------------------------------
// USERS
// ------------------------------------------------------------------
export async function adminListUsers(search?: string, role?: string, status?: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  let q = supabase.from('profiles').select('id, username, full_name, email, level, role, status, total_earnings, total_views, valid_views, created_at').order('created_at', { ascending: false }).limit(200);
  if (role && role !== 'all') q = q.eq('role', role);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data } = await q;
  const rows = (data || []).filter((u: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.email?.toLowerCase().includes(s) || u.username?.toLowerCase().includes(s) || u.full_name?.toLowerCase().includes(s);
  });
  void admin;
  return rows;
}

export async function adminUserDetail(userId: string) {
  await requireAdmin();
  const supabase = createAdminClient();
  const [{ data: profile }, { data: campaigns }, { data: withdrawals }, { data: earnings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('campaigns').select('*').eq('creator_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(20),
    supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('earnings').select('*, campaign:campaigns(name)').eq('creator_id', userId).order('created_at', { ascending: false }).limit(20),
  ]);
  return { profile, campaigns: campaigns || [], withdrawals: withdrawals || [], earnings: earnings || [] };
}

export async function adminSetUserStatus(userId: string, status: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data: target } = await supabase.from('profiles').select('role, status').eq('id', userId).single();
  if (!target) throw new Error('User not found');
  // Regular admins may not modify a super_admin.
  if (target.role === 'super_admin' && admin.role !== 'super_admin') throw new Error('Only super admin can modify a super admin account');
  if (!['active', 'suspended', 'banned'].includes(status)) throw new Error('Invalid status');
  const { error } = await supabase.from('profiles').update({ status }).eq('id', userId);
  if (error) throw new Error(error.message);
  await audit(admin, `user_status_${status}`, 'profile', userId, { status: target.status }, { status });
  return { ok: true };
}

export async function adminSetUserRole(userId: string, role: string) {
  const admin = await requireSuperAdmin();
  if (userId === admin.id) throw new Error('You cannot change your own role');
  if (!['creator', 'admin', 'super_admin'].includes(role)) throw new Error('Invalid role');
  const supabase = createAdminClient();
  const { data: target } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (!target) throw new Error('User not found');
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
  await audit(admin, 'role_change', 'profile', userId, { role: target.role }, { role });
  return { ok: true };
}

// ------------------------------------------------------------------
// CAMPAIGNS
// ------------------------------------------------------------------
export async function adminCampaignAction(campaignId: string, action: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data: campaign } = await supabase.from('campaigns').select('status').eq('id', campaignId).single();
  if (!campaign) throw new Error('Campaign not found');

  let patch: Record<string, unknown> | null = null;
  if (action === 'pause') patch = { status: 'paused' };
  else if (action === 'resume') patch = { status: 'active' };
  else if (action === 'delete') patch = { deleted_at: new Date().toISOString() };
  else throw new Error('Invalid action');

  const { error } = await supabase.from('campaigns').update(patch).eq('id', campaignId);
  if (error) throw new Error(error.message);
  await audit(admin, `campaign_${action}`, 'campaign', campaignId, { status: campaign.status }, patch);
  return { ok: true };
}

export async function adminListCampaigns() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('campaigns')
    .select('id, name, creator:public_profiles(full_name, email), total_views, valid_views, total_earnings, status, deleted_at, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  return data || [];
}

// ------------------------------------------------------------------
// WITHDRAWALS
// ------------------------------------------------------------------
export async function adminListWithdrawals() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('withdrawals')
    .select('*, user:public_profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  return data || [];
}

export async function adminApproveWithdrawal(id: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('approve_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_approve', 'withdrawal', id);
  return { ok: true };
}

export async function adminRejectWithdrawal(id: string, reason: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('reject_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id, p_reason: reason });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_reject', 'withdrawal', id, null, { reason });
  return { ok: true };
}

export async function adminPayWithdrawal(id: string, txId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('pay_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id, p_tx_id: txId });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_pay', 'withdrawal', id, null, { txId });
  return { ok: true };
}

// ------------------------------------------------------------------
// READ HELPERS (for admin pages)
// ------------------------------------------------------------------
export async function adminLoadCountries() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase.from('country_tiers').select('*').order('tier').limit(500);
  return data || [];
}

export async function adminLoadLevels() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase.from('creator_levels').select('*').order('sort_order').limit(100);
  return data || [];
}

export async function adminLoadSettings() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
  return data;
}

export async function adminLoadAdNetworks() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase.from('ad_networks').select('*').order('total_revenue', { ascending: false }).limit(100);
  return data || [];
}

// ------------------------------------------------------------------
// CPM / COUNTRY TIERS
// ------------------------------------------------------------------
export async function adminSaveCountryUpdates(updates: { id: number; fields: Record<string, unknown> }[]) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  for (const u of updates) {
    const { error } = await supabase.from('country_tiers').update(u.fields).eq('id', u.id);
    if (error) throw new Error(error.message);
  }
  await audit(admin, 'cpm_update', 'country_tiers', undefined, null, { count: updates.length });
  return { ok: true };
}

export async function adminAddCountry(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('country_tiers').insert(data);
  if (error) throw new Error(error.message);
  await audit(admin, 'country_add', 'country_tiers', undefined, null, data);
  return { ok: true };
}

export async function adminDeleteCountry(id: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('country_tiers').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'country_delete', 'country_tiers', undefined, null, { id });
  return { ok: true };
}

// ------------------------------------------------------------------
// CREATOR LEVELS
// ------------------------------------------------------------------
export async function adminSaveLevel(id: number, data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('creator_levels').update(data).eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'level_update', 'creator_levels', undefined, null, data);
  return { ok: true };
}

// ------------------------------------------------------------------
// PLATFORM SETTINGS
// ------------------------------------------------------------------
export async function adminSaveSettings(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('platform_settings').update(data).eq('id', 1);
  if (error) throw new Error(error.message);
  await audit(admin, 'settings_update', 'platform_settings', undefined, null, data);
  return { ok: true };
}

export async function adminListWithdrawalMethods() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase.from('withdrawal_method_config').select('*').order('sort_order');
  return data || [];
}

// Alias used by the settings page.
export const adminLoadWithdrawalMethods = adminListWithdrawalMethods;

export async function adminSaveWithdrawalMethod(id: number, data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').update(data).eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'wm_update', 'withdrawal_method_config', undefined, null, data);
  return { ok: true };
}

export async function adminAddWithdrawalMethod(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').insert(data);
  if (error) throw new Error(error.message);
  await audit(admin, 'wm_add', 'withdrawal_method_config', undefined, null, data);
  return { ok: true };
}

export async function adminDeleteWithdrawalMethod(id: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'wm_delete', 'withdrawal_method_config', undefined, null, { id });
  return { ok: true };
}

// ------------------------------------------------------------------
// AD NETWORKS
// ------------------------------------------------------------------
export async function adminToggleAdNetwork(id: number, status: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('ad_networks').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'ad_network_status', 'ad_networks', undefined, null, { status });
  return { ok: true };
}
