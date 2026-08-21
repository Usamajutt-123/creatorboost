import { cache } from 'react';
import { notFound } from 'next/navigation';
import UnlockServerBody from '@/app/unlock/UnlockServerBody';
import { loadPublicCampaign, PublicCampaignLookupError } from '@/lib/public-campaign';
import { resolveParams } from '@/lib/route-params';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ slug: string }> };

/** Request-scoped campaign lookup shared by metadata and the page render. */
const getCampaign = cache(loadPublicCampaign);

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await resolveParams(params);
  try {
    const campaign = await getCampaign(slug);
    if (!campaign) return { title: 'Link not found', robots: { index: false, follow: false } };
    const description = campaign.description || `Complete the tasks to unlock ${campaign.name}.`;
    return {
      title: campaign.name,
      description,
      alternates: { canonical: `/unlock/${campaign.slug}` },
      openGraph: { title: campaign.name, description, type: 'website', images: campaign.banner_url ? [{ url: campaign.banner_url }] : undefined },
      twitter: { card: 'summary_large_image', title: campaign.name, description, images: campaign.banner_url ? [campaign.banner_url] : undefined },
    };
  } catch (error) {
    if (error instanceof PublicCampaignLookupError) {
      return { title: 'Link unavailable', robots: { index: false, follow: false } };
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
    if (error instanceof PublicCampaignLookupError) throw error;
    throw error;
  }
  if (!campaign) notFound();

  return <UnlockServerBody campaign={campaign} />;
}
