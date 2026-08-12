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
import { createNotification } from '@/lib/notifications';

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
    await createNotification({
      userId: user.id,
      type: 'campaign',
      title: 'Campaign created',
      message: `"${payload.name}" is ready. Share your unlock link to start earning.`,
      link: `/dashboard/campaigns/${data.id}`,
      metadata: { campaignId: data.id, status: payload.status },
    });
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
    await createNotification({
      userId: user.id,
      type: 'campaign',
      title: 'Campaign updated',
      message: `"${payload.name}" was saved.`,
      link: `/dashboard/campaigns/${data.id}`,
      metadata: { campaignId: data.id },
    });
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
    await createNotification({
      userId: user.id,
      type: 'campaign',
      title: status === 'active' ? 'Campaign activated' : 'Campaign paused',
      message: status === 'active'
        ? 'Your campaign is live and can earn from valid views.'
        : 'Your campaign is paused. Visitors cannot unlock it until you activate it again.',
      link: `/dashboard/campaigns/${data.id}`,
      metadata: { campaignId: data.id, status },
    });
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
