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
import { buildCampaignWritePayload, extractFlowPages, type CampaignMutationInput } from '@/lib/campaign-payload';
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
  if (!profile) throw new Error('You must be signed in');
  if (profile.status === 'suspended' || profile.status === 'banned') {
    throw new Error('Your account cannot manage campaigns');
  }
  if (profile.status !== 'active') {
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

type DatabaseError = { code?: string; message: string; details?: string; hint?: string };

/** Log the complete Postgres failure on the server, but only expose raw DB
 * text during development. Production users receive a stable, non-sensitive
 * message (except for the page-count invariant, which is safe and actionable).
 */
function campaignDatabaseError(operation: 'create' | 'update', error: DatabaseError): Error {
  console.error(`[${operation}Campaign] atomic save failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  if (error.code === '23514' && error.message.includes('requires exactly')) {
    return new Error(error.message);
  }
  if (process.env.NODE_ENV !== 'production') {
    return new Error(`${error.message}${error.code ? ` [${error.code}]` : ''}`);
  }
  if (error.code === '23505') return new Error('A campaign with that identifier already exists. Please try again.');
  if (error.code === '42501') return new Error('You do not have permission to save this campaign.');
  return new Error(operation === 'create'
    ? 'Campaign could not be created. Please try again.'
    : 'Campaign not found or could not be updated.');
}

function pagesForRpc(pages: ReturnType<typeof extractFlowPages>) {
  return pages.map(page => ({
    image_url: page.image_url,
    button_text: page.button_text,
  }));
}

export async function createCampaignAction(input: CampaignMutationInput): Promise<CampaignActionResult> {
  try {
    const payload = buildCampaignWritePayload(input);
    const pages = extractFlowPages(payload);
    const { supabase, user } = await currentActiveUser();
    const base = slugify(payload.name).slice(0, 72) || 'campaign';
    const slug = `${base}-${randomUUID().slice(0, 8)}`;

    // One RPC call means one Postgres transaction. This is required because
    // 0014's deferred trigger checks the campaign and all page rows at commit.
    const { data, error } = await supabase.rpc('save_campaign_with_pages', {
      p_campaign: { ...payload, slug },
      p_pages: pagesForRpc(pages),
      p_campaign_id: null,
    });
    if (error) throw campaignDatabaseError('create', error);
    const campaignId = typeof data === 'string' ? data : null;
    if (!campaignId) throw new Error('Campaign save returned no campaign ID');

    await createNotification({
      userId: user.id,
      type: 'campaign',
      title: 'Campaign created',
      message: `"${payload.name}" is ready. Share your unlock link to start earning.`,
      link: `/dashboard/campaigns/${campaignId}`,
      metadata: { campaignId, status: payload.status },
    });
    return { success: true, id: campaignId };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateCampaignAction(campaignId: string, input: CampaignMutationInput): Promise<CampaignActionResult> {
  try {
    if (!isCampaignUuid(campaignId)) throw new Error('Campaign not found');
    const payload = buildCampaignWritePayload(input);
    const pages = extractFlowPages(payload);
    const { supabase, user } = await currentActiveUser();
    const { data, error } = await supabase.rpc('save_campaign_with_pages', {
      p_campaign: { ...payload },
      p_pages: pagesForRpc(pages),
      p_campaign_id: campaignId,
    });
    if (error) throw campaignDatabaseError('update', error);
    const savedCampaignId = typeof data === 'string' ? data : null;
    if (!savedCampaignId) throw new Error('Campaign save returned no campaign ID');

    await createNotification({
      userId: user.id,
      type: 'campaign',
      title: 'Campaign updated',
      message: `"${payload.name}" was saved.`,
      link: `/dashboard/campaigns/${savedCampaignId}`,
      metadata: { campaignId: savedCampaignId },
    });
    return { success: true, id: savedCampaignId };
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
