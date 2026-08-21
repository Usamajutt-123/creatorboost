'use server';

/**
 * Server-authoritative monetization administration.
 *
 * SECURITY MODEL — identical to the rest of the admin surface:
 *   - The acting identity is always derived from the verified session; the
 *     role is read from the database on every call.
 *   - The admin account must be ACTIVE (same rule as migration 0021 /
 *     admin-server): role alone is not authorization.
 *   - Every mutation is validated here and again by the database checks.
 *   - Global ad codes, CPM/level rates, payout settings and analytics are
 *     admin-only. Creators have no path into any of these functions.
 *   - Mutations are recorded in the audit log via audit_action.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { getDashboardProfile, getSessionUser } from '@/lib/session';
import { getClientIpFromHeaders } from '@/lib/request-ip';
import {
  normalizePlatformAdCode,
  normalizePlatformAdUrl,
  isValidPlatformAdUrl,
} from '@/lib/platform-ads';
import { sanitizeRichContent, sanitizeStepText, sanitizeStepImageUrl } from './sanitize';
import {
  AD_FORMAT_OPTIONS,
  AD_NETWORK_OPTIONS,
} from './settings';
import { createFlowPreviewToken } from './preview';
import { isCampaignUuid } from '@/lib/route-params';

type Admin = { id: string; role: string };

function finiteNumber(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} is invalid`);
  return number;
}

function shortText(value: unknown, label: string, max: number, allowEmpty = false): string {
  const text = String(value ?? '').trim();
  if ((!allowEmpty && !text) || text.length > max) throw new Error(`${label} is invalid`);
  return text;
}

function boolValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid`);
  return value;
}

function safeFields(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid update payload');
  const fields = Object.entries(input).filter(([key]) => allowed.includes(key));
  if (!fields.length || fields.length !== Object.keys(input).length) throw new Error('Update contains unsupported fields');
  return Object.fromEntries(fields);
}

async function requireAdmin(): Promise<Admin> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');
  const profile = await getDashboardProfile();
  if (!profile) throw new Error('Profile not found');
  if ((profile.role !== 'admin' && profile.role !== 'super_admin') || profile.status !== 'active') {
    throw new Error('Admin privileges required');
  }
  return { id: user.id, role: profile.role };
}

async function audit(admin: Admin, action: string, entityType: string, entityId?: string, newValues?: unknown) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc('audit_action', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId || null,
      p_old_values: null,
      p_new_values: newValues ? JSON.parse(JSON.stringify(newValues)) : null,
      p_ip: getClientIpFromHeaders(await headers()),
      p_actor_id: admin.id,
    });
    if (error) console.error('[monetization-admin] audit failed', { action, message: error.message });
  } catch (error) {
    console.error('[monetization-admin] audit failed', { action, error });
  }
}

function actionError(error: unknown): { ok: false; error: string } {
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

// ---------------------------------------------------------------------------
// READ HELPERS (server-rendered initial data)
// ---------------------------------------------------------------------------

export async function monetizationLoadAll() {
  await requireAdmin();
  const supabase = createAdminClient();
  const [settings, steps, slots, payouts] = await Promise.all([
    supabase.from('monetization_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('monetization_steps').select('*').order('position', { ascending: true }).limit(12),
    supabase.from('monetization_ad_slots').select('*').order('page_key', { ascending: true }).order('slot_number', { ascending: true }).limit(300),
    supabase.from('monetization_payout_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  return {
    settings: settings.data ?? null,
    steps: steps.data ?? [],
    slots: slots.data ?? [],
    payouts: payouts.data ?? null,
  };
}

export async function monetizationLoadRevenue() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('monetization_revenue')
    .select('*')
    .order('revenue_date', { ascending: false })
    .limit(500);
  return data || [];
}

// ---------------------------------------------------------------------------
// FLOW SETTINGS
// ---------------------------------------------------------------------------

const SETTINGS_FIELDS = [
  'flow_enabled', 'task_page_ads_enabled', 'progress_bar_enabled',
  'educational_content_enabled', 'final_redirect_enabled', 'test_mode',
  'steps_count', 'default_countdown_seconds', 'session_ttl_minutes',
] as const;

export async function monetizationSaveSettings(data: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const input = safeFields(data, SETTINGS_FIELDS);
  const payload: Record<string, unknown> = {};

  for (const field of ['flow_enabled', 'task_page_ads_enabled', 'progress_bar_enabled', 'educational_content_enabled', 'final_redirect_enabled', 'test_mode'] as const) {
    if (field in input) payload[field] = boolValue(input[field], field.replace(/_/g, ' '));
  }
  if ('steps_count' in input) payload.steps_count = Math.floor(finiteNumber(input.steps_count, 'Number of steps', 1, 12));
  if ('default_countdown_seconds' in input) payload.default_countdown_seconds = Math.floor(finiteNumber(input.default_countdown_seconds, 'Default countdown', 1, 120));
  if ('session_ttl_minutes' in input) payload.session_ttl_minutes = Math.floor(finiteNumber(input.session_ttl_minutes, 'Session lifetime', 5, 240));

  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_settings').update(payload).eq('id', 1);
  if (error) throw new Error('Monetization settings could not be saved');
  await audit(admin, 'monetization_settings_update', 'monetization_settings', undefined, payload);
  revalidatePath('/admin/monetization');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// STEP CONTENT MANAGEMENT
// ---------------------------------------------------------------------------

const STEP_FIELDS = [
  'title', 'subtitle', 'intro', 'body_html', 'icon',
  'image_url', 'button_text', 'countdown_seconds', 'status',
] as const;

function validateStepPayload(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('title' in input) payload.title = sanitizeStepText(input.title, 160) || undefined;
  if ('subtitle' in input) payload.subtitle = sanitizeStepText(input.subtitle, 300) || null;
  if ('intro' in input) payload.intro = sanitizeStepText(input.intro, 2_000) || null;
  if ('body_html' in input) {
    const html = sanitizeRichContent(input.body_html);
    payload.body_html = html.length > 30_000 ? html.slice(0, 30_000) : html;
  }
  if ('icon' in input) payload.icon = sanitizeStepText(input.icon, 16) || null;
  if ('image_url' in input) {
    const raw = typeof input.image_url === 'string' ? input.image_url.trim() : '';
    payload.image_url = raw ? sanitizeStepImageUrl(raw) : null;
    if (raw && !payload.image_url) throw new Error('Image URL must be a valid http(s) URL');
  }
  if ('button_text' in input) payload.button_text = sanitizeStepText(input.button_text, 60) || null;
  if ('countdown_seconds' in input) payload.countdown_seconds = Math.floor(finiteNumber(input.countdown_seconds, 'Countdown', 1, 120));
  if ('status' in input) {
    const status = String(input.status);
    if (!['enabled', 'disabled'].includes(status)) throw new Error('Step status is invalid');
    payload.status = status;
  }
  return payload;
}

export async function monetizationSaveStep(id: number, data: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const stepId = Math.floor(finiteNumber(id, 'Step ID', 1, 1_000_000));
  const input = safeFields(data, STEP_FIELDS);
  const payload = validateStepPayload(input);
  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_steps').update(payload).eq('id', stepId);
  if (error) throw new Error('Step could not be saved');
  await audit(admin, 'monetization_step_update', 'monetization_steps', String(stepId), payload);
  revalidatePath('/admin/monetization');
  return { ok: true };
}

export async function monetizationAddStep(): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data: steps } = await supabase
    .from('monetization_steps')
    .select('position')
    .order('position', { ascending: true })
    .limit(12);
  if ((steps || []).length >= 12) throw new Error('The flow already has 12 steps');

  const nextPosition = (steps || []).reduce((max, s) => Math.max(max, Number(s.position) || 0), 0) + 1;
  const { error } = await supabase.from('monetization_steps').insert({
    position: nextPosition,
    title: `Step ${nextPosition}`,
    subtitle: 'Describe what visitors will learn on this step',
    countdown_seconds: 10,
    status: 'enabled',
  });
  if (error) throw new Error('Step could not be added');
  await audit(admin, 'monetization_step_add', 'monetization_steps');
  revalidatePath('/admin/monetization');
  return { ok: true };
}

export async function monetizationDeleteStep(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const stepId = Math.floor(finiteNumber(id, 'Step ID', 1, 1_000_000));
  const supabase = createAdminClient();
  const { count } = await supabase
    .from('monetization_steps')
    .select('id', { count: 'exact', head: true });
  if ((count ?? 0) <= 1) throw new Error('The flow must keep at least one step');

  const { error } = await supabase.from('monetization_steps').delete().eq('id', stepId);
  if (error) throw new Error('Step could not be deleted');
  await audit(admin, 'monetization_step_delete', 'monetization_steps', String(stepId));
  revalidatePath('/admin/monetization');
  return { ok: true };
}

export async function monetizationReorderSteps(orderedIds: number[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  if (!Array.isArray(orderedIds) || orderedIds.length < 1 || orderedIds.length > 12) {
    throw new Error('Invalid step order');
  }
  const ids = orderedIds.map(id => Math.floor(finiteNumber(id, 'Step ID', 1, 1_000_000)));
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('reorder_monetization_steps', { p_ids: ids });
  if (error) throw new Error(error.message || 'Steps could not be reordered');
  await audit(admin, 'monetization_step_reorder', 'monetization_steps', undefined, { ids });
  revalidatePath('/admin/monetization');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AD SLOT MANAGEMENT
// ---------------------------------------------------------------------------

const SLOT_FIELDS = [
  'enabled', 'network', 'format', 'zone_id', 'code', 'url',
  'placement', 'device_target', 'priority', 'frequency',
] as const;

function validateSlotPayload(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('enabled' in input) payload.enabled = boolValue(input.enabled, 'Slot enabled flag');
  if ('network' in input) {
    const network = String(input.network);
    if (!AD_NETWORK_OPTIONS.includes(network as never)) throw new Error('Ad network is invalid');
    payload.network = network;
  }
  if ('format' in input) {
    const format = String(input.format);
    if (!Object.values(AD_FORMAT_OPTIONS).flat().includes(format)) throw new Error('Ad format is invalid');
    payload.format = format;
  }
  if ('zone_id' in input) {
    const zone = typeof input.zone_id === 'string' ? input.zone_id.trim() : '';
    if (zone.length > 200) throw new Error('Zone ID is too long');
    payload.zone_id = zone || null;
  }
  if ('code' in input) {
    const raw = input.code;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new Error('Ad code is invalid');
    const code = typeof raw === 'string' ? raw.trim() : '';
    if (code.length > 10_000) throw new Error('Ad code is too long');
    payload.code = normalizePlatformAdCode(code);
  }
  if ('url' in input) {
    const raw = input.url;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new Error('Ad URL is invalid');
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (url.length > 2_000) throw new Error('Ad URL is too long');
    if (url && !isValidPlatformAdUrl(url)) throw new Error('Ad URL must be a valid http(s) URL');
    payload.url = normalizePlatformAdUrl(url);
  }
  if ('placement' in input) {
    const placement = String(input.placement);
    if (!['top', 'middle', 'bottom'].includes(placement)) throw new Error('Ad placement is invalid');
    payload.placement = placement;
  }
  if ('device_target' in input) {
    const device = String(input.device_target);
    if (!['all', 'desktop', 'mobile'].includes(device)) throw new Error('Device targeting is invalid');
    payload.device_target = device;
  }
  if ('priority' in input) payload.priority = Math.floor(finiteNumber(input.priority, 'Priority', 0, 1000));
  if ('frequency' in input) {
    const frequency = String(input.frequency);
    if (!['once_per_session', 'every_view'].includes(frequency)) throw new Error('Frequency is invalid');
    payload.frequency = frequency;
  }
  return payload;
}

export async function monetizationSaveSlot(id: number, data: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const slotId = Math.floor(finiteNumber(id, 'Slot ID', 1, 1_000_000));
  const input = safeFields(data, SLOT_FIELDS);
  const payload = validateSlotPayload(input);
  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_ad_slots').update(payload).eq('id', slotId);
  if (error) throw new Error('Ad slot could not be saved');
  await audit(admin, 'monetization_ad_slot_update', 'monetization_ad_slots', String(slotId), payload);
  revalidatePath('/admin/monetization');
  return { ok: true };
}

export async function monetizationAddSlot(pageKey: string, slotNumber: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const page = shortText(pageKey, 'Page key', 40);
  if (page !== 'task_page' && !/^step_[1-9][0-9]?$/.test(page)) throw new Error('Page key is invalid');
  const number = Math.floor(finiteNumber(slotNumber, 'Slot number', 1, 3));
  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_ad_slots').insert({
    page_key: page,
    slot_number: number,
    enabled: false,
    network: 'adsterra',
    format: 'native_banner',
    placement: 'middle',
    device_target: 'all',
    priority: 0,
    frequency: 'every_view',
  });
  if (error) {
    if (typeof error.code === 'string' && error.code === '23505') {
      throw new Error('This ad slot already exists');
    }
    throw new Error('Ad slot could not be added');
  }
  await audit(admin, 'monetization_ad_slot_add', 'monetization_ad_slots', undefined, { page, number });
  revalidatePath('/admin/monetization');
  return { ok: true };
}

export async function monetizationDeleteSlot(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const slotId = Math.floor(finiteNumber(id, 'Slot ID', 1, 1_000_000));
  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_ad_slots').delete().eq('id', slotId);
  if (error) throw new Error('Ad slot could not be deleted');
  await audit(admin, 'monetization_ad_slot_delete', 'monetization_ad_slots', String(slotId));
  revalidatePath('/admin/monetization');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PAYOUT SETTINGS
// ---------------------------------------------------------------------------

const PAYOUT_FIELDS = [
  'creator_share_percent', 'min_payout_per_view', 'max_payout_per_view',
  'fraud_adjustment_percent', 'fraud_adjustment_threshold',
] as const;

export async function monetizationSavePayoutSettings(data: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const input = safeFields(data, PAYOUT_FIELDS);
  const payload: Record<string, unknown> = {};

  if ('creator_share_percent' in input) payload.creator_share_percent = finiteNumber(input.creator_share_percent, 'Creator share', 0, 100);
  if ('min_payout_per_view' in input) payload.min_payout_per_view = finiteNumber(input.min_payout_per_view, 'Minimum payout per view', 0, 10);
  if ('max_payout_per_view' in input) payload.max_payout_per_view = finiteNumber(input.max_payout_per_view, 'Maximum payout per view', 0, 10);
  if ('fraud_adjustment_percent' in input) payload.fraud_adjustment_percent = finiteNumber(input.fraud_adjustment_percent, 'Fraud adjustment', 0, 100);
  if ('fraud_adjustment_threshold' in input) payload.fraud_adjustment_threshold = finiteNumber(input.fraud_adjustment_threshold, 'Fraud threshold', 0, 100);

  if (Number(payload.min_payout_per_view) > Number(payload.max_payout_per_view)) {
    throw new Error('Minimum payout cannot exceed the maximum');
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_payout_settings').update(payload).eq('id', 1);
  if (error) throw new Error('Payout settings could not be saved');
  await audit(admin, 'monetization_payout_update', 'monetization_payout_settings', undefined, payload);
  revalidatePath('/admin/monetization');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GROSS REVENUE LEDGER (manual, clearly labeled)
// ---------------------------------------------------------------------------

export type RevenueRowInput = {
  date: string;
  network: string;
  impressions?: number | string;
  clicks?: number | string;
  revenue: number | string;
  country?: string;
  notes?: string;
};

export async function monetizationImportRevenue(rows: RevenueRowInput[]): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows provided');
  if (rows.length > 200) throw new Error('Too many rows (max 200 per import)');

  const cleaned: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('Invalid revenue row');
    const date = shortText(row.date, 'Revenue date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Revenue date must be YYYY-MM-DD');
    const network = String(row.network || '').trim();
    if (!['adsterra', 'monetag', 'other'].includes(network)) throw new Error('Revenue network is invalid');
    const revenue = finiteNumber(row.revenue, 'Revenue', 0, 100_000_000);
    const impressions = row.impressions === undefined || row.impressions === '' ? 0 : finiteNumber(row.impressions, 'Impressions', 0, 1_000_000_000_000);
    const clicks = row.clicks === undefined || row.clicks === '' ? 0 : finiteNumber(row.clicks, 'Clicks', 0, 1_000_000_000_000);
    let country: string | null = null;
    if (row.country) {
      const code = String(row.country).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) throw new Error('Revenue country must be a 2-letter code');
      country = code;
    }
    let notes: string | null = null;
    if (row.notes) notes = sanitizeStepText(row.notes, 500) || null;

    cleaned.push({
      revenue_date: date,
      network,
      impressions,
      clicks,
      revenue,
      currency: 'USD',
      country,
      notes,
      source: 'manual',
      created_by: admin.id,
    });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_revenue').insert(cleaned as never[]);
  if (error) throw new Error('Revenue could not be imported');
  await audit(admin, 'monetization_revenue_import', 'monetization_revenue', undefined, {
    count: cleaned.length,
    source: 'manual',
  });
  revalidatePath('/admin/monetization');
  return { ok: true, imported: cleaned.length };
}

export async function monetizationDeleteRevenue(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  const revenueId = Math.floor(finiteNumber(id, 'Revenue ID', 1, 1_000_000_000));
  const supabase = createAdminClient();
  const { error } = await supabase.from('monetization_revenue').delete().eq('id', revenueId);
  if (error) throw new Error('Revenue entry could not be deleted');
  await audit(admin, 'monetization_revenue_delete', 'monetization_revenue', String(revenueId));
  revalidatePath('/admin/monetization');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// FLOW PREVIEW
// ---------------------------------------------------------------------------

/**
 * Issues a short-lived, campaign-bound preview token. The public flow
 * verifies the signature before creating a preview session; preview
 * sessions never record analytics events or generate earnings.
 */
export async function monetizationCreatePreview(campaignId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireAdmin();
  if (!isCampaignUuid(campaignId)) throw new Error('Campaign not found');
  const supabase = createAdminClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, slug, status, deleted_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign || campaign.deleted_at) throw new Error('Campaign not found');
  if (campaign.status !== 'active') throw new Error('Only active campaigns can be previewed');

  const token = createFlowPreviewToken(campaign.id);
  if (!token) throw new Error('Preview service is not configured');
  return { ok: true, url: `/api/flow/preview?slug=${encodeURIComponent(campaign.slug)}&token=${encodeURIComponent(token)}` };
}

// ---------------------------------------------------------------------------
// ANALYTICS (admin)
// ---------------------------------------------------------------------------

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    console.error(`[monetization-admin] ${name} failed`, error.message);
    return [];
  }
  return (data as T[]) ?? [];
}

export async function monetizationLoadOverview() {
  const supabase = createAdminClient();
  await requireAdmin();
  const { data, error } = await supabase.rpc('admin_monetization_overview');
  if (error) {
    console.error('[monetization-admin] overview failed', error.message);
    return null;
  }
  return data as unknown as Record<string, unknown> | null;
}

export async function monetizationLoadFunnel(days = 30) {
  return rpc<{ stage: string; count: number }>('admin_monetization_funnel', { p_days: days });
}

export async function monetizationLoadStepStats(days = 30) {
  return rpc<{ step: number; started: number; completed: number }>('admin_monetization_step_stats', { p_days: days });
}

export async function monetizationLoadDaily(days = 14) {
  return rpc<{ day: string; flow_starts: number; destinations: number; qualified: number; creator_payout: number; gross_revenue: number }>(
    'admin_monetization_daily', { p_days: days });
}

export async function monetizationLoadCountries(days = 7, limit = 10) {
  return rpc<{ country_code: string; events: number; qualified: number }>(
    'admin_monetization_countries', { p_days: days, p_limit: limit });
}

export async function monetizationLoadDevices(days = 7) {
  return rpc<{ device: string; events: number }>('admin_monetization_devices', { p_days: days });
}

export async function monetizationLoadTopCreators(days = 30, limit = 5) {
  return rpc<{ creator_id: string; username: string; qualified: number; payout: number }>(
    'admin_monetization_top_creators', { p_days: days, p_limit: limit });
}

export async function monetizationLoadTopCampaigns(days = 30, limit = 5) {
  return rpc<{ campaign_id: string; campaign_name: string; slug: string; qualified: number; payout: number }>(
    'admin_monetization_top_campaigns', { p_days: days, p_limit: limit });
}


