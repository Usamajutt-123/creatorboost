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
import { isCampaignUuid } from '@/lib/route-params';
import { slugify } from '@/lib/utils';
import { buildCampaignWritePayload, type CampaignMutationInput } from '@/lib/campaign-payload';
import { createAdminClient } from '@/lib/supabase/server';

export type { CampaignMutationInput };

type CampaignActionResult = { success: true; id: string } | { success: false; error: string };

async function currentActiveUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) throw new Error('You must be signed in');
  if (profile.status === 'suspended' || profile.status === 'banned') {
    throw new Error('Your account cannot manage campaigns');
  }
  if (profile.status !== 'active') {
    throw new Error('Verify your email before managing campaigns');
  }
  return { supabase, user };
}

const CAMPAIGN_BUCKET = 'campaigns';

/**
 * Convert a public storage URL back into its object path, or null when the URL
 * does not belong to this project's `campaigns` bucket.
 *
 * Anything that is not clearly one of our own objects returns null and is
 * therefore never deleted — an external image URL a creator pasted in must not
 * be interpreted as something we own.
 */
function campaignStoragePath(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const marker = `/storage/v1/object/public/${CAMPAIGN_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  try {
    const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
    // Reject traversal and empty paths.
    return path && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
}

/**
 * Remove campaign images that are no longer referenced by ANY campaign.
 *
 * Replacing a campaign's thumbnail/banner previously left the old object in
 * the `campaigns` bucket forever — every edit leaked one file, and the bucket
 * grew without bound with images nothing pointed at.
 *
 * SAFETY: an object is only removed after confirming with a service-role read
 * that no campaign row (including soft-deleted ones, which can be restored)
 * still references it. A shared or re-used image is therefore never deleted
 * out from under another record. Cleanup is best effort: a storage failure is
 * logged and never fails the campaign save.
 */
async function removeUnreferencedCampaignImages(urls: Array<string | null | undefined>): Promise<void> {
  const candidates = [...new Set(urls.map(campaignStoragePath).filter((p): p is string => Boolean(p)))];
  if (candidates.length === 0) return;

  try {
    const admin = createAdminClient();
    const stillReferenced = new Set<string>();
    for (const path of candidates) {
      const { data, error } = await admin
        .from('campaigns')
        .select('id')
        .or(`thumbnail_url.ilike.%${path},banner_url.ilike.%${path}`)
        .limit(1);
      // On ANY doubt (query error included), keep the object.
      if (error || (data && data.length > 0)) stillReferenced.add(path);
    }

    const removable = candidates.filter(path => !stillReferenced.has(path));
    if (removable.length === 0) return;

    const { error } = await admin.storage.from(CAMPAIGN_BUCKET).remove(removable);
    if (error) console.error('[campaign] orphaned image cleanup failed', { message: error.message });
  } catch (e) {
    console.error('[campaign] orphaned image cleanup threw', e);
  }
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
    const payload = buildCampaignWritePayload(input);
    const { supabase, user } = await currentActiveUser();
    const base = slugify(payload.name).slice(0, 72) || 'campaign';
    const slug = `${base}-${randomUUID().slice(0, 8)}`;

    const { data, error } = await supabase
      .from('campaigns')
      .insert({ ...payload, slug, creator_id: user.id })
      .select('id')
      .single();
    if (error) {
      console.error('[createCampaign] insert failed', error.message);
      throw new Error('Campaign could not be created. Please try again.');
    }
    if (!data) throw new Error('Campaign could not be created. Please try again.');
    return { success: true, id: data.id };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateCampaignAction(campaignId: string, input: CampaignMutationInput): Promise<CampaignActionResult> {
  try {
    if (!isCampaignUuid(campaignId)) throw new Error('Campaign not found');
    const payload = buildCampaignWritePayload(input);
    const { supabase, user } = await currentActiveUser();
    // Read the current image URLs BEFORE the update so a replaced image can be
    // cleaned up afterwards.
    const { data: previous } = await supabase
      .from('campaigns')
      .select('thumbnail_url, banner_url')
      .eq('id', campaignId)
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    const { data, error } = await supabase
      .from('campaigns')
      .update(payload)
      .eq('id', campaignId)
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[updateCampaign] update failed', error.message);
      throw new Error('Campaign not found or could not be updated');
    }
    if (!data) throw new Error('Campaign not found or could not be updated');

    // Best-effort: drop images this campaign replaced, but only once no
    // campaign references them any more.
    const replaced: Array<string | null | undefined> = [];
    if (previous?.thumbnail_url && previous.thumbnail_url !== payload.thumbnail_url) replaced.push(previous.thumbnail_url);
    if (previous?.banner_url && previous.banner_url !== payload.banner_url) replaced.push(previous.banner_url);
    if (replaced.length > 0) await removeUnreferencedCampaignImages(replaced);

    return { success: true, id: data.id };
  } catch (error) {
    return actionError(error);
  }
}

export async function setCampaignStatusAction(campaignId: string, status: 'active' | 'paused'): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isCampaignUuid(campaignId)) throw new Error('Campaign not found');
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
    if (!isCampaignUuid(campaignId)) throw new Error('Campaign not found');
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
