import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidHttpUrl } from '@/lib/tasks';
import { UNLOCK_COOKIE, verifyUnlockToken } from '@/lib/unlock-token';
import { isCampaignUuid, isPublicCampaignSlug, resolveParams } from '@/lib/route-params';
import DestinationClient from './DestinationClient';

export const dynamic = 'force-dynamic';

export default async function DestinationPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign: identifier } = await resolveParams(params);
  if (!isCampaignUuid(identifier) && !isPublicCampaignSlug(identifier)) notFound();

  const admin = createAdminClient();
  let query = admin
    .from('campaigns')
    .select('id, slug, name, description, banner_url, thumbnail_url, destination_url, status, deleted_at, expires_at');
  query = isCampaignUuid(identifier) ? query.eq('id', identifier) : query.eq('slug', identifier);
  const { data: campaign, error } = await query.maybeSingle();

  if (error) {
    console.error('[destination] campaign lookup failed', { identifier, message: error.message, code: error.code });
    throw new Error('Campaign lookup failed');
  }

  const requestTime = Date.now();
  if (!campaign || campaign.status !== 'active' || campaign.deleted_at || (campaign.expires_at && new Date(campaign.expires_at).getTime() <= requestTime)) {
    notFound();
  }
  const cookieStore = await cookies();
  if (!verifyUnlockToken(cookieStore.get(UNLOCK_COOKIE)?.value, campaign.id)) {
    redirect(`/c/${campaign.slug}`);
  }
  if (!isValidHttpUrl(campaign.destination_url)) {
    notFound();
  }

  return <DestinationClient campaign={campaign} />;
}
