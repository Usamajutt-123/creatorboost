import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidHttpUrl } from '@/lib/tasks';
import { UNLOCK_COOKIE, verifyUnlockToken } from '@/lib/unlock-token';
import DestinationClient from './DestinationClient';

export const dynamic = 'force-dynamic';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

export default async function DestinationPage({ params }: { params: { campaign: string } }) {
  const admin = createAdminClient();
  let query = admin
    .from('campaigns')
    .select('id, slug, name, description, banner_url, thumbnail_url, destination_url, status, deleted_at, expires_at');
  query = isUuid(params.campaign) ? query.eq('id', params.campaign) : query.eq('slug', params.campaign);
  const { data: campaign } = await query.maybeSingle();

  const requestTime = new Date().getTime();
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
