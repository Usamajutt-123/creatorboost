import { cache } from 'react';
import { notFound } from 'next/navigation';
import UnlockClient from './UnlockClient';
import FlowClient from './FlowClient';
import { loadPublicCampaign, PublicCampaignLookupError } from '@/lib/public-campaign';
import { resolveParams } from '@/lib/route-params';
import { FLOW_PAGE_COUNT } from '@/lib/flow';

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

  // Custom-page flows take over the visitor experience. If the campaign is
  // set to 4_pages / 5_pages but the DB somehow does not have the correct
  // number of pages we fall back to the normal task flow so visitors are
  // never stuck; the trigger in migration 0014 keeps this from happening
  // when campaigns are saved through the app.
  const expectedPages = FLOW_PAGE_COUNT[campaign.flow_type];
  if (campaign.flow_type !== 'normal' && campaign.pages.length === expectedPages) {
    return <FlowClient campaign={{
      ...campaign,
      tasks: campaign.tasks || [],
      task_metadata: campaign.task_metadata || {},
    }} />;
  }

  return <UnlockClient campaign={{ ...campaign, tasks: campaign.tasks || [], task_metadata: campaign.task_metadata || {} }} />;
}
