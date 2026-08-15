import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidHttpUrl } from '@/lib/tasks';
import { UNLOCK_COOKIE, unlockSubject, verifyUnlockToken } from '@/lib/unlock-token';
import { headers } from 'next/headers';
import { getClientIpFromHeaders } from '@/lib/request-ip';
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
  // The unlock cookie is verified against the SAME binding the record
  // endpoint used (coarse network prefix + user agent), so a copied cookie
  // does not unlock the destination from another browser or network.
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const subject = unlockSubject(getClientIpFromHeaders(requestHeaders), requestHeaders.get('user-agent'));
  if (!verifyUnlockToken(cookieStore.get(UNLOCK_COOKIE)?.value, campaign.id, requestTime, subject)) {
    redirect(`/c/${campaign.slug}`);
  }
  if (!isValidHttpUrl(campaign.destination_url)) {
    notFound();
  }

  return <DestinationClient campaign={campaign} />;
}
