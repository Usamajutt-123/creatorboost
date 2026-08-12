'use server';

/**
 * Server-authoritative campaign mutations.
 *
 * Browser validation is useful for UX, but all campaign data – especially
 * external URLs and task configuration – is validated again here and is
 * protected by matching database checks/RLS in migration 0008.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { TASK_TYPES, isValidHttpUrl } from '@/lib/tasks';
import { slugify } from '@/lib/utils';

const categories = [
  'youtube_growth',
  'instagram_growth',
  'tiktok_growth',
  'telegram_growth',
  'discord_growth',
  'website_traffic',
  'app_install',
  'other',
] as const;

const statuses = ['draft', 'active', 'paused'] as const;

const taskSchema = z.object({
  id: z.enum(TASK_TYPES),
  title: z.string().trim().max(120).optional().default(''),
  url: z.string().trim().max(2_000),
});

const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(150),
  description: z.string().trim().max(2_000).optional().default(''),
  category: z.enum(categories),
  destinationUrl: z.string().trim().max(2_000).optional().default(''),
  status: z.enum(statuses),
  expiresAt: z.string().trim().max(32).optional().default(''),
  thumbnailUrl: z.string().trim().max(2_000).nullable().optional(),
  bannerUrl: z.string().trim().max(2_000).nullable().optional(),
  tasks: z.array(taskSchema).min(1, 'Choose at least one task').max(TASK_TYPES.length),
});

export type CampaignMutationInput = z.input<typeof campaignSchema>;

type CampaignActionResult = { success: true; id: string } | { success: false; error: string };

function toEndOfDay(value: string): string | null {
  if (!value) return null;
  // The UI submits YYYY-MM-DD. Treat it as the end of that UTC day so a
  // campaign does not become expired as soon as its selected date begins.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expiry date is invalid');
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error('Expiry date must be in the future');
  }
  return date.toISOString();
}

function safeMediaUrl(value: string | null | undefined, field: string): string | null {
  if (!value) return null;
  if (!isValidHttpUrl(value)) throw new Error(`${field} must be a valid http(s) URL`);
  return value.trim();
}

function normalize(input: CampaignMutationInput) {
  const parsed = campaignSchema.parse(input);
  const ids = parsed.tasks.map(task => task.id);
  if (new Set(ids).size !== ids.length) throw new Error('Each task type can only be added once');

  for (const task of parsed.tasks) {
    if (!isValidHttpUrl(task.url)) {
      throw new Error(`Add a valid http(s) URL for ${task.id.replace(/_/g, ' ')}`);
    }
    if (task.id === 'custom' && !task.title.trim()) {
      throw new Error('Custom tasks need a title');
    }
  }

  if (parsed.status === 'active' && !isValidHttpUrl(parsed.destinationUrl)) {
    throw new Error('An active campaign needs a valid http(s) destination URL');
  }
  if (parsed.destinationUrl && !isValidHttpUrl(parsed.destinationUrl)) {
    throw new Error('Destination URL must be a valid http(s) URL');
  }

  const taskMetadata: Record<string, { title?: string; url: string }> = {};
  for (const task of parsed.tasks) {
    // Store exactly what the creator configured. The unlock page reads this
    // field for every task type; no type-specific URL is substituted.
    taskMetadata[task.id] = {
      ...(task.id === 'custom' ? { title: task.title.trim() } : {}),
      url: task.url.trim(),
    };
  }

  return {
    name: parsed.name,
    description: parsed.description || null,
    category: parsed.category,
    destination_url: parsed.destinationUrl.trim(),
    status: parsed.status,
    expires_at: toEndOfDay(parsed.expiresAt),
    thumbnail_url: safeMediaUrl(parsed.thumbnailUrl, 'Thumbnail URL'),
    banner_url: safeMediaUrl(parsed.bannerUrl, 'Banner URL'),
    tasks: ids,
    task_metadata: taskMetadata,
  };
}

async function currentActiveUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.status !== 'active') {
    throw new Error('Verify your email before managing campaigns');
  }
  return { supabase, user };
}

function actionError(error: unknown): CampaignActionResult {
  if (error instanceof z.ZodError) {
    return { success: false, error: error.issues[0]?.message || 'Campaign details are invalid' };
  }
  if (error instanceof Error) return { success: false, error: error.message };
  return { success: false, error: 'Campaign could not be saved' };
}

export async function createCampaignAction(input: CampaignMutationInput): Promise<CampaignActionResult> {
  try {
    const payload = normalize(input);
    const { supabase, user } = await currentActiveUser();
    const base = slugify(payload.name).slice(0, 72) || 'campaign';
    const slug = `${base}-${randomUUID().slice(0, 8)}`;

    const { data, error } = await supabase
      .from('campaigns')
      .insert({ ...payload, slug, creator_id: user.id })
      .select('id')
      .single();
    if (error || !data) throw new Error('Campaign could not be created. Please try again.');
    return { success: true, id: data.id };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateCampaignAction(campaignId: string, input: CampaignMutationInput): Promise<CampaignActionResult> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) throw new Error('Campaign not found');
    const payload = normalize(input);
    const { supabase, user } = await currentActiveUser();
    const { data, error } = await supabase
      .from('campaigns')
      .update(payload)
      .eq('id', campaignId)
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error || !data) throw new Error('Campaign not found or could not be updated');
    return { success: true, id: data.id };
  } catch (error) {
    return actionError(error);
  }
}

export async function setCampaignStatusAction(campaignId: string, status: 'active' | 'paused'): Promise<{ success: boolean; error?: string }> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) throw new Error('Campaign not found');
    const { supabase, user } = await currentActiveUser();
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status })
      .eq('id', campaignId)
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error || !data) throw new Error('Campaign not found or could not be updated');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Campaign could not be updated' };
  }
}

export async function deleteCampaignAction(campaignId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) throw new Error('Campaign not found');
    const { supabase, user } = await currentActiveUser();
    const { data, error } = await supabase
      .from('campaigns')
      .update({ deleted_at: new Date().toISOString(), status: 'paused' })
      .eq('id', campaignId)
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error || !data) throw new Error('Campaign not found or already deleted');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Campaign could not be deleted' };
  }
}

