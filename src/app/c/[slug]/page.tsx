import { cache } from 'react';
import { notFound } from 'next/navigation';
import UnlockClient from './UnlockClient';
import { loadPublicCampaign, PublicCampaignLookupError } from '@/lib/public-campaign';
import { resolveParams } from '@/lib/route-params';
import { createAdminClient } from '@/lib/supabase/server';
import { getPublicPlatformAds } from '@/lib/platform-ads';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Next.js calls `generateMetadata` and the page component for the same request,
 * and both need the campaign. Without memoization every visit to a public
 * unlock link ran the campaign lookup twice, doubling the Supabase latency on
 * the most traffic-heavy route in the app. `cache()` is request-scoped, so
 * campaign changes are still picked up on the very next request.
 */
const getCampaign = cache(loadPublicCampaign);

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await resolveParams(params);
  try {
    const campaign = await getCampaign(slug);
    if (!campaign) return { title: 'Campaign not found', robots: { index: false, follow: false } };
    const description = campaign.description || `Complete the tasks to unlock ${campaign.name}.`;
    return {
      title: campaign.name,
      description,
      alternates: { canonical: `/c/${campaign.slug}` },
      openGraph: { title: campaign.name, description, type: 'website', images: campaign.banner_url ? [{ url: campaign.banner_url }] : undefined },
      twitter: { card: 'summary_large_image', title: campaign.name, description, images: campaign.banner_url ? [campaign.banner_url] : undefined },
    };
  } catch (error) {
    if (error instanceof PublicCampaignLookupError) {
      return { title: 'Campaign unavailable', robots: { index: false, follow: false } };
    }
    throw error;
  }
}

export default async function UnlockPage({ params }: PageProps) {
  const { slug } = await resolveParams(params);
  let campaign;
  try {
    campaign = await getCampaign(slug);
  } catch (error) {
    if (error instanceof PublicCampaignLookupError) {
      throw error;
    }
    throw error;
  }
  if (!campaign) notFound();

  const adminSupabase = createAdminClient();
  // Platform ads are read with the server-only client from the single
  // platform_settings row. Campaign data is never consulted for ads, and the
  // browser receives only enabled, renderable placements.
  const { data: adSettings } = await adminSupabase
    .from('platform_settings')
    .select('banner_enabled, banner_code, banner_url, popunder_enabled, popunder_code, popunder_url')
    .eq('id', 1)
    .single();
  const platformAds = getPublicPlatformAds(adSettings);

  return <UnlockClient campaign={{ ...campaign, tasks: campaign.tasks || [], task_metadata: campaign.task_metadata || {} }} platformAds={platformAds} />;
}
