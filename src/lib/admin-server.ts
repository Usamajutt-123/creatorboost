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
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getClientIpFromHeaders } from '@/lib/request-ip';
import { sendTemplateEmail } from '@/lib/email';
import { validateManualRevenueRow, type ManualRevenueInput } from '@/lib/ad-revenue/manual';
import { createNotification } from '@/lib/notifications';

type Admin = { id: string; role: string };

function finiteNumber(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} is invalid`);
  return number;
}

function safeFields(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid update payload');
  const fields = Object.entries(input).filter(([key]) => allowed.includes(key));
  if (!fields.length || fields.length !== Object.keys(input).length) throw new Error('Update contains unsupported fields');
  return Object.fromEntries(fields);
}

function shortText(value: unknown, label: string, max: number, allowEmpty = false): string {
  const text = String(value ?? '').trim();
  if ((!allowEmpty && !text) || text.length > max) throw new Error(`${label} is invalid`);
  return text;
}

async function requireAuth(): Promise<Admin> {
  const supabase = await createClient();
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

async function clientIp(): Promise<string | null> {
  try {
    return getClientIpFromHeaders(await headers());
  } catch {
    return null;
  }
}

async function getProfileEmail(userId: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
    return data?.email || null;
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
      p_ip: await clientIp(),
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
  const { data: target } = await supabase.from('profiles').select('role, status, email').eq('id', userId).single();
  if (!target) throw new Error('User not found');
  // Regular admins may not modify a super_admin.
  if (target.role === 'super_admin' && admin.role !== 'super_admin') throw new Error('Only super admin can modify a super admin account');
  if (!['active', 'suspended', 'banned'].includes(status)) throw new Error('Invalid status');
  if (target.status === status) return { ok: true, unchanged: true };
  const { error } = await supabase.from('profiles').update({ status }).eq('id', userId);
  if (error) throw new Error(error.message);
  await audit(admin, `user_status_${status}`, 'profile', userId, { status: target.status }, { status });

  // Notify the user (graceful: email failures never fail the action).
  if (target.email && (status === 'suspended' || status === 'banned')) {
    try {
      await sendTemplateEmail(status === 'banned' ? 'account_banned' : 'account_suspended', target.email, {
        reason: 'Please contact support for details.',
      });
    } catch (e) {
      console.error('[admin] status email failed', e);
    }
  }
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
  else if (action === 'restore') patch = { deleted_at: null, status: 'paused' }; // restore soft-deleted (stay paused until resumed)
  else throw new Error('Invalid action');

  const { error } = await supabase.from('campaigns').update(patch).eq('id', campaignId);
  if (error) throw new Error(error.message);
  await audit(admin, `campaign_${action}`, 'campaign', campaignId, { status: campaign.status }, patch);
  return { ok: true };
}

export async function adminGetCampaign(campaignId: string) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, slug, name, description, category, status, creator_id, total_views, valid_views, invalid_views, total_earnings, tasks, task_metadata, thumbnail_url, banner_url, expires_at, deleted_at, created_at, updated_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('Campaign could not be loaded');
  return data;
}

export async function adminListCampaigns() {
  await requireAdmin();
  const supabase = createAdminClient();
  // Include soft-deleted campaigns so admins can restore them.
  const { data } = await supabase
    .from('campaigns')
    .select('id, slug, name, creator_id, total_views, valid_views, total_earnings, status, deleted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = data || [];

  // Attach public creator info (PostgREST cannot embed a join to a view).
  const creatorIds = [...new Set(rows.map((c: any) => c.creator_id))];
  let profiles: Record<string, { full_name: string; email: string }> = {};
  if (creatorIds.length) {
    const { data: p } = await supabase
      .from('public_profiles')
      .select('id, full_name')
      .in('id', creatorIds);
    profiles = (p || []).reduce((acc: any, x: any) => { acc[x.id] = { full_name: x.full_name, email: '' }; return acc; }, {});
  }
  return rows.map((c: any) => ({ ...c, creator: profiles[c.creator_id] || null }));
}

// ------------------------------------------------------------------
// WITHDRAWALS
// ------------------------------------------------------------------
export async function adminListWithdrawals() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('withdrawals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = data || [];

  const userIds = [...new Set(rows.map((w: any) => w.user_id))];
  let profiles: Record<string, { full_name: string; email: string }> = {};
  if (userIds.length) {
    // Admin client: full profiles (includes email) — RLS lets admins read these.
    const { data: p } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    profiles = (p || []).reduce((acc: any, x: any) => { acc[x.id] = { full_name: x.full_name, email: x.email }; return acc; }, {});
  }
  return rows.map((w: any) => ({ ...w, user: profiles[w.user_id] || null }));
}

async function withdrawalUserEmail(withdrawalId: string): Promise<{ email: string | null; amount: number; method: string }> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from('withdrawals').select('user_id, amount, fee, method').eq('id', withdrawalId).maybeSingle();
    if (!data) return { email: null, amount: 0, method: '' };
    const email = await getProfileEmail(data.user_id);
    return { email, amount: Number(data.amount), method: data.method };
  } catch {
    return { email: null, amount: 0, method: '' };
  }
}

export async function adminApproveWithdrawal(id: string) {
  const admin = await requireAdmin();
  // Use the acting admin's session for the RPC. The database derives
  // auth.uid(), verifies the role, and blocks self-processing; service-role
  // calls have no end-user auth.uid() and must not bypass that invariant.
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_approve', 'withdrawal', id);
  const { email, amount } = await withdrawalUserEmail(id);
  if (email) {
    try { await sendTemplateEmail('withdrawal_approved', email, { amount: amount.toFixed(2) }); }
    catch (e) { console.error('[admin] withdrawal email failed', e); }
  }
  return { ok: true };
}

export async function adminRejectWithdrawal(id: string, reason: string) {
  const admin = await requireAdmin();
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('A rejection reason is required');
  if (cleanReason.length > 500) throw new Error('Rejection reason is too long');
  const supabase = await createClient();
  const { error } = await supabase.rpc('reject_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id, p_reason: cleanReason });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_reject', 'withdrawal', id, null, { reason });
  const { email, amount } = await withdrawalUserEmail(id);
  if (email) {
    try { await sendTemplateEmail('withdrawal_rejected', email, { amount: amount.toFixed(2), reason: reason || 'Not specified' }); }
    catch (e) { console.error('[admin] withdrawal email failed', e); }
  }
  return { ok: true };
}

export async function adminPayWithdrawal(id: string, txId: string) {
  const admin = await requireAdmin();
  const cleanTxId = txId.trim();
  if (!cleanTxId) throw new Error('A transaction ID is required to mark a withdrawal paid');
  if (cleanTxId.length > 200) throw new Error('Transaction ID is too long');
  const supabase = await createClient();
  const { error } = await supabase.rpc('pay_withdrawal', { p_withdrawal_id: id, p_admin_id: admin.id, p_tx_id: cleanTxId });
  if (error) throw new Error(error.message);
  await audit(admin, 'withdrawal_pay', 'withdrawal', id, null, { txId });
  const { email, amount } = await withdrawalUserEmail(id);
  if (email) {
    try { await sendTemplateEmail('withdrawal_paid', email, { amount: amount.toFixed(2), txId: txId || '' }); }
    catch (e) { console.error('[admin] withdrawal email failed', e); }
  }
  return { ok: true };
}

// ------------------------------------------------------------------
// SUPPORT
// ------------------------------------------------------------------
export async function adminListSupportTickets() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('id, user_id, subject, category, status, priority, assigned_to, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);
  const rows = tickets || [];
  const ids = rows.map((ticket: any) => ticket.id);
  const userIds = [...new Set(rows.map((ticket: any) => ticket.user_id).filter(Boolean))];
  const [{ data: messages }, { data: users }] = await Promise.all([
    ids.length ? supabase.from('ticket_messages').select('id, ticket_id, user_id, message, is_admin, created_at').in('ticket_id', ids).order('created_at') : Promise.resolve({ data: [] as any[] }),
    userIds.length ? supabase.from('public_profiles').select('id, username, full_name').in('id', userIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const userMap = new Map((users || []).map((user: any) => [user.id, user]));
  const messageMap = new Map<string, any[]>();
  for (const message of messages || []) messageMap.set(message.ticket_id, [...(messageMap.get(message.ticket_id) || []), message]);
  return rows.map((ticket: any) => ({ ...ticket, user: ticket.user_id ? userMap.get(ticket.user_id) || null : null, messages: messageMap.get(ticket.id) || [] }));
}

export async function adminReplySupportTicket(ticketId: string, message: string, status: string = 'in_progress') {
  const admin = await requireAdmin();
  const cleanMessage = shortText(message, 'Support reply', 5_000);
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw new Error('Invalid ticket status');
  const supabase = createAdminClient();
  const { data: ticket } = await supabase.from('support_tickets').select('id').eq('id', ticketId).maybeSingle();
  if (!ticket) throw new Error('Support ticket not found');
  const { error } = await supabase.from('ticket_messages').insert({ ticket_id: ticketId, user_id: admin.id, message: cleanMessage, is_admin: true });
  if (error) throw new Error('Support reply could not be saved');
  const { error: statusError } = await supabase.from('support_tickets').update({ status, assigned_to: admin.id }).eq('id', ticketId);
  if (statusError) throw new Error('Support ticket status could not be updated');
  await audit(admin, 'support_reply', 'support_ticket', ticketId, null, { status });
  return { ok: true };
}

export async function adminSetSupportTicketStatus(ticketId: string, status: string) {
  const admin = await requireAdmin();
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw new Error('Invalid ticket status');
  const supabase = createAdminClient();
  const { error } = await supabase.from('support_tickets').update({ status, assigned_to: admin.id }).eq('id', ticketId);
  if (error) throw new Error('Support ticket could not be updated');
  await audit(admin, 'support_status', 'support_ticket', ticketId, null, { status });
  return { ok: true };
}

// ------------------------------------------------------------------
// AD REVENUE LEDGER (REAL vs MANUAL)
// ------------------------------------------------------------------
export async function adminListAdRevenue() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ad_revenue_imports')
    .select('*')
    .order('revenue_date', { ascending: false })
    .limit(500);
  return data || [];
}

export async function adminImportAdRevenue(rows: ManualRevenueInput[]) {
  const admin = await requireAdmin();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows provided');
  if (rows.length > 100) throw new Error('Too many rows (max 100 per import)');

  const cleaned: Record<string, unknown>[] = [];
  for (const r of rows) {
    const err = validateManualRevenueRow(r);
    if (err) throw new Error(err);
    cleaned.push({
      revenue_date: r.date,
      network: String(r.network).trim(),
      impressions: Number(r.impressions) || 0,
      clicks: r.clicks === null || r.clicks === undefined ? 0 : Number(r.clicks),
      revenue: Number(r.revenue),
      currency: (r.currency || 'USD').toUpperCase(),
      country: r.country ? r.country.toUpperCase() : null,
      source: 'manual',
    });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('ad_revenue_imports').insert(cleaned as never[]);
  if (error) throw new Error(error.message);
  await audit(admin, 'ad_revenue_import', 'ad_revenue_imports', undefined, null, { count: cleaned.length, source: 'manual' });
  return { ok: true, imported: cleaned.length };
}

export async function adminDeleteAdRevenue(id: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('ad_revenue_imports').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await audit(admin, 'ad_revenue_delete', 'ad_revenue_imports', undefined, null, { id });
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
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 500) throw new Error('Invalid country update batch');
  const supabase = createAdminClient();
  for (const update of updates) {
    const id = finiteNumber(update.id, 'Country ID', 1, 1_000_000);
    const fields = safeFields(update.fields, ['cpm_min', 'cpm_max', 'cpm_default', 'payout_percentage', 'active']);
    if ('cpm_min' in fields) fields.cpm_min = finiteNumber(fields.cpm_min, 'CPM minimum', 0, 10_000);
    if ('cpm_max' in fields) fields.cpm_max = finiteNumber(fields.cpm_max, 'CPM maximum', 0, 10_000);
    if ('cpm_default' in fields) fields.cpm_default = finiteNumber(fields.cpm_default, 'Default CPM', 0, 10_000);
    if ('payout_percentage' in fields) fields.payout_percentage = finiteNumber(fields.payout_percentage, 'Payout percentage', 0, 100);
    if ('active' in fields && typeof fields.active !== 'boolean') throw new Error('Country active flag is invalid');
    const { error } = await supabase.from('country_tiers').update(fields).eq('id', id);
    if (error) throw new Error('Country rate could not be saved');
  }
  await audit(admin, 'cpm_update', 'country_tiers', undefined, null, { count: updates.length });
  return { ok: true };
}

export async function adminAddCountry(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const input = safeFields(data, ['country_code', 'country_name', 'tier', 'cpm_min', 'cpm_max', 'cpm_default', 'payout_percentage', 'active']);
  const countryCode = shortText(input.country_code, 'Country code', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Country code must have two letters');
  const tier = String(input.tier || '');
  if (!['tier_1', 'tier_2', 'tier_3', 'tier_4'].includes(tier)) throw new Error('Country tier is invalid');
  const cpmMin = finiteNumber(input.cpm_min, 'CPM minimum', 0, 10_000);
  const cpmMax = finiteNumber(input.cpm_max, 'CPM maximum', cpmMin, 10_000);
  const cpmDefault = finiteNumber(input.cpm_default, 'Default CPM', cpmMin, cpmMax);
  const payload = {
    country_code: countryCode,
    country_name: shortText(input.country_name, 'Country name', 100),
    tier,
    cpm_min: cpmMin,
    cpm_max: cpmMax,
    cpm_default: cpmDefault,
    payout_percentage: finiteNumber(input.payout_percentage, 'Payout percentage', 0, 100),
    active: typeof input.active === 'boolean' ? input.active : true,
  };
  const supabase = createAdminClient();
  const { error } = await supabase.from('country_tiers').insert(payload);
  if (error) throw new Error('Country could not be added');
  await audit(admin, 'country_add', 'country_tiers', undefined, null, payload);
  return { ok: true };
}

export async function adminDeleteCountry(id: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('country_tiers').delete().eq('id', finiteNumber(id, 'Country ID', 1, 1_000_000));
  if (error) throw new Error(error.message);
  await audit(admin, 'country_delete', 'country_tiers', undefined, null, { id });
  return { ok: true };
}

// ------------------------------------------------------------------
// CREATOR LEVELS
// ------------------------------------------------------------------
export async function adminSaveLevel(id: number, data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const levelId = finiteNumber(id, 'Level ID', 1, 1_000_000);
  const input = safeFields(data, ['name', 'min_views', 'cpm_multiplier', 'badge_color', 'priority_support', 'fast_withdrawal', 'verified_badge', 'premium_analytics']);
  const payload: Record<string, unknown> = {};
  if ('name' in input) payload.name = shortText(input.name, 'Level name', 50);
  if ('min_views' in input) payload.min_views = Math.floor(finiteNumber(input.min_views, 'Minimum views', 0, 10_000_000_000));
  if ('cpm_multiplier' in input) payload.cpm_multiplier = finiteNumber(input.cpm_multiplier, 'CPM multiplier', 0, 100);
  if ('badge_color' in input) {
    const color = shortText(input.badge_color, 'Badge color', 20);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Badge color must be a hex color');
    payload.badge_color = color;
  }
  for (const field of ['priority_support', 'fast_withdrawal', 'verified_badge', 'premium_analytics'] as const) {
    if (field in input) {
      if (typeof input[field] !== 'boolean') throw new Error(`${field} is invalid`);
      payload[field] = input[field];
    }
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('creator_levels').update(payload).eq('id', levelId);
  if (error) throw new Error('Level could not be saved');
  await audit(admin, 'level_update', 'creator_levels', undefined, null, payload);
  return { ok: true };
}

// ------------------------------------------------------------------
// PLATFORM SETTINGS
// ------------------------------------------------------------------
export async function adminSaveSettings(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const input = safeFields(data, [
    'site_name', 'site_tagline', 'support_email', 'site_announcement', 'site_announcement_active',
    'min_withdrawal', 'referral_percentage', 'fraud_detection_sensitivity', 'vpn_block_enabled',
    'duplicate_device_block', 'duplicate_ip_window_hours', 'maintenance_mode', 'signup_enabled',
    'max_earnings_per_view', 'max_views_per_device_per_day', 'max_views_per_ip_per_day',
    'creator_daily_earning_cap', 'campaign_daily_earning_cap', 'platform_daily_earning_cap', 'earning_holding_hours',
  ]);
  const payload: Record<string, unknown> = {};
  for (const field of ['site_name', 'site_tagline', 'support_email', 'site_announcement'] as const) {
    if (field in input) payload[field] = shortText(input[field], field.replace(/_/g, ' '), field === 'site_announcement' ? 1_000 : 200, field !== 'site_name');
  }
  if (typeof payload.support_email === 'string' && payload.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.support_email)) throw new Error('Support email is invalid');
  for (const field of ['site_announcement_active', 'vpn_block_enabled', 'duplicate_device_block', 'maintenance_mode', 'signup_enabled'] as const) {
    if (field in input) {
      if (typeof input[field] !== 'boolean') throw new Error(`${field} is invalid`);
      payload[field] = input[field];
    }
  }
  if ('fraud_detection_sensitivity' in input) {
    const value = String(input.fraud_detection_sensitivity);
    if (!['low', 'medium', 'high', 'strict'].includes(value)) throw new Error('Fraud sensitivity is invalid');
    payload.fraud_detection_sensitivity = value;
  }
  const numericLimits: Record<string, [number, number, boolean]> = {
    min_withdrawal: [0, 1_000_000, false], referral_percentage: [0, 100, false], max_earnings_per_view: [0, 1_000_000, false],
    max_views_per_device_per_day: [0, 1_000_000, true], max_views_per_ip_per_day: [0, 10_000_000, true],
    creator_daily_earning_cap: [0, 10_000_000, false], campaign_daily_earning_cap: [0, 10_000_000, false], platform_daily_earning_cap: [0, 1_000_000_000, false], earning_holding_hours: [0, 8_760, true], duplicate_ip_window_hours: [0, 8_760, true],
  };
  for (const [field, [min, max, integer]] of Object.entries(numericLimits)) {
    if (field in input) {
      const value = finiteNumber(input[field], field.replace(/_/g, ' '), min, max);
      payload[field] = integer ? Math.floor(value) : value;
    }
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('platform_settings').update(payload).eq('id', 1);
  if (error) throw new Error('Settings could not be saved');
  await audit(admin, 'settings_update', 'platform_settings', undefined, null, payload);
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

function withdrawalMethodPayload(data: Record<string, unknown>, includeMethod: boolean): Record<string, unknown> {
  const allowed = includeMethod
    ? ['method', 'label', 'icon', 'enabled', 'min_amount', 'max_amount', 'fee_percentage', 'sort_order']
    : ['label', 'icon', 'enabled', 'min_amount', 'max_amount', 'fee_percentage', 'sort_order'];
  const input = safeFields(data, allowed);
  const payload: Record<string, unknown> = {};
  if (includeMethod) {
    const method = shortText(input.method, 'Method key', 40).toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(method)) throw new Error('Method key is invalid');
    payload.method = method;
  }
  if ('label' in input) payload.label = shortText(input.label, 'Method label', 80);
  if ('icon' in input) payload.icon = shortText(input.icon, 'Method icon', 20);
  if ('enabled' in input) { if (typeof input.enabled !== 'boolean') throw new Error('Method enabled flag is invalid'); payload.enabled = input.enabled; }
  const min = 'min_amount' in input ? finiteNumber(input.min_amount, 'Method minimum', 0.01, 1_000_000) : undefined;
  const max = 'max_amount' in input ? finiteNumber(input.max_amount, 'Method maximum', min ?? 0.01, 10_000_000) : undefined;
  if (min !== undefined) payload.min_amount = min;
  if (max !== undefined) payload.max_amount = max;
  if ('fee_percentage' in input) payload.fee_percentage = finiteNumber(input.fee_percentage, 'Method fee', 0, 100);
  if ('sort_order' in input) payload.sort_order = Math.floor(finiteNumber(input.sort_order, 'Sort order', 0, 10_000));
  return payload;
}

export async function adminSaveWithdrawalMethod(id: number, data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const payload = withdrawalMethodPayload(data, false);
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').update(payload).eq('id', finiteNumber(id, 'Method ID', 1, 1_000_000));
  if (error) throw new Error('Withdrawal method could not be saved');
  await audit(admin, 'wm_update', 'withdrawal_method_config', undefined, null, payload);
  return { ok: true };
}

export async function adminAddWithdrawalMethod(data: Record<string, unknown>) {
  const admin = await requireAdmin();
  const payload = withdrawalMethodPayload(data, true);
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').insert(payload);
  if (error) throw new Error('Withdrawal method could not be added');
  await audit(admin, 'wm_add', 'withdrawal_method_config', undefined, null, payload);
  return { ok: true };
}

export async function adminDeleteWithdrawalMethod(id: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from('withdrawal_method_config').delete().eq('id', finiteNumber(id, 'Method ID', 1, 1_000_000));
  if (error) throw new Error(error.message);
  await audit(admin, 'wm_delete', 'withdrawal_method_config', undefined, null, { id });
  return { ok: true };
}

// ------------------------------------------------------------------
// AD NETWORKS
// ------------------------------------------------------------------
export async function adminToggleAdNetwork(id: number, status: string) {
  const admin = await requireAdmin();
  if (!['active', 'paused', 'inactive'].includes(status)) throw new Error('Invalid ad network status');
  const supabase = createAdminClient();
  const { error } = await supabase.from('ad_networks').update({ status }).eq('id', finiteNumber(id, 'Ad network ID', 1, 1_000_000));
  if (error) throw new Error(error.message);
  await audit(admin, 'ad_network_status', 'ad_networks', undefined, null, { status });
  return { ok: true };
}

// ------------------------------------------------------------------
// ADMIN ANNOUNCEMENTS
// ------------------------------------------------------------------

export type AdminAnnouncementType = 'announcement' | 'important' | 'maintenance' | 'update';
export type AdminAnnouncementAudience =
  | 'all_creators'
  | 'active_creators'
  | 'suspended_creators'
  | 'banned_creators'
  | 'specific_creators';

const ANNOUNCEMENT_TYPES: readonly AdminAnnouncementType[] = [
  'announcement', 'important', 'maintenance', 'update',
];
const ANNOUNCEMENT_AUDIENCES: readonly AdminAnnouncementAudience[] = [
  'all_creators', 'active_creators', 'suspended_creators', 'banned_creators', 'specific_creators',
];

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeAnnouncementIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10_000 || value.some(id => !isUuid(id))) {
    throw new Error('Announcement recipients are invalid');
  }
  return [...new Set(value)];
}

function validateAnnouncementAudience(value: unknown): AdminAnnouncementAudience {
  if (typeof value !== 'string' || !ANNOUNCEMENT_AUDIENCES.includes(value as AdminAnnouncementAudience)) {
    throw new Error('Announcement audience is invalid');
  }
  return value as AdminAnnouncementAudience;
}

function validateAnnouncementType(value: unknown): AdminAnnouncementType {
  if (typeof value !== 'string' || !ANNOUNCEMENT_TYPES.includes(value as AdminAnnouncementType)) {
    throw new Error('Announcement type is invalid');
  }
  return value as AdminAnnouncementType;
}

function validateAnnouncementKey(value: unknown): string {
  const key = shortText(value, 'Announcement idempotency key', 100);
  if (key.length < 16 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Announcement idempotency key is invalid');
  }
  return key;
}

function announcementAudienceFilter(audience: AdminAnnouncementAudience) {
  switch (audience) {
    case 'active_creators': return { status: 'active' };
    case 'suspended_creators': return { status: 'suspended' };
    case 'banned_creators': return { status: 'banned' };
    default: return null;
  }
}

/** Count exactly the profiles the delivery function will target. */
export async function adminGetAnnouncementRecipientCount(
  audienceValue: string,
  recipientIdsValue: string[] = [],
): Promise<number> {
  await requireAdmin();
  const audience = validateAnnouncementAudience(audienceValue);
  const recipientIds = normalizeAnnouncementIds(recipientIdsValue);
  if (audience === 'specific_creators' && recipientIds.length === 0) return 0;

  const supabase = createAdminClient();
  let query = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'creator');

  const status = announcementAudienceFilter(audience);
  if (status) query = query.eq('status', status.status);
  if (audience === 'specific_creators') query = query.in('id', recipientIds);

  const { count, error } = await query;
  if (error) throw new Error('Recipient count could not be calculated');
  return count ?? 0;
}

/** Search creator profiles for the specific-recipient picker. */
export async function adminListAnnouncementCreators(search = '') {
  await requireAdmin();
  const term = search.trim().replace(/[^a-zA-Z0-9@._+\\-\\s]/g, '').slice(0, 80);
  const supabase = createAdminClient();
  let query = supabase
    .from('profiles')
    .select('id, username, full_name, email, status')
    .eq('role', 'creator')
    .order('created_at', { ascending: false })
    .limit(50);

  if (term) {
    query = query.or(`username.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error('Creators could not be loaded');
  return data || [];
}

export async function adminListAnnouncements() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, type, audience, recipient_count, created_at, sent_at, sent_by, status, idempotency_key')
    .not('idempotency_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Announcement history could not be loaded');

  const rows = data || [];
  const senderIds = [...new Set(rows.map((row: any) => row.sent_by).filter(Boolean))];
  const senderById: Record<string, { full_name: string | null; email: string | null }> = {};
  if (senderIds.length) {
    const { data: senders } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', senderIds);
    for (const sender of senders || []) {
      senderById[sender.id] = { full_name: sender.full_name, email: sender.email };
    }
  }

  return rows.map((row: any) => ({
    ...row,
    sender: row.sent_by ? senderById[row.sent_by] || null : null,
  }));
}

type AdminAnnouncementInput = {
  title: unknown;
  message: unknown;
  type: unknown;
  audience: unknown;
  recipientIds?: unknown;
  idempotencyKey: unknown;
};

/**
 * Send one announcement through the atomic, service-role-only database
 * function. The caller's role is checked here and again inside SQL.
 */
export async function adminSendAnnouncement(input: AdminAnnouncementInput) {
  const admin = await requireAdmin();
  if (!input || typeof input !== 'object') throw new Error('Announcement payload is invalid');

  const title = shortText(input.title, 'Announcement title', 200);
  const message = shortText(input.message, 'Announcement message', 2_000);
  const type = validateAnnouncementType(input.type);
  const audience = validateAnnouncementAudience(input.audience);
  const recipientIds = normalizeAnnouncementIds(input.recipientIds);
  if (audience === 'specific_creators' && recipientIds.length === 0) {
    throw new Error('Select at least one creator');
  }
  const idempotencyKey = validateAnnouncementKey(input.idempotencyKey);

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('send_admin_announcement', {
    p_admin_id: admin.id,
    p_title: title,
    p_message: message,
    p_type: type,
    p_audience: audience,
    p_recipient_ids: audience === 'specific_creators' ? recipientIds : [],
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    console.error('[admin] announcement send failed', error);
    throw new Error('Announcement could not be sent');
  }

  const result = (data || {}) as {
    ok?: boolean;
    duplicate?: boolean;
    announcement_id?: string;
    recipient_count?: number;
    status?: string;
  };
  if (!result.ok || !result.announcement_id) throw new Error('Announcement could not be sent');

  if (!result.duplicate) {
    await audit(admin, 'announcement_send', 'announcement', result.announcement_id, null, {
      title,
      type,
      audience,
      recipient_count: Number(result.recipient_count || 0),
    });
  }
  revalidatePath('/admin/announcements');
  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    announcementId: result.announcement_id,
    recipientCount: Number(result.recipient_count || 0),
    status: result.status || 'sent',
  };
}
