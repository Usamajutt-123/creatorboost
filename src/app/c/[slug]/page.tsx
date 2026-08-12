import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UnlockClient from './UnlockClient';

export const dynamic = 'force-dynamic';

async function loadPublicCampaign(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('public_campaigns')
    .select('id, slug, name, description, banner_url, thumbnail_url, tasks, task_metadata, updated_at')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const campaign = await loadPublicCampaign(params.slug);
  if (!campaign) return { title: 'Campaign not found', robots: { index: false, follow: false } };
  const description = campaign.description || `Complete the tasks to unlock ${campaign.name}.`;
  return {
    title: campaign.name,
    description,
    alternates: { canonical: `/c/${campaign.slug}` },
    openGraph: { title: campaign.name, description, type: 'website', images: campaign.banner_url ? [{ url: campaign.banner_url }] : undefined },
    twitter: { card: 'summary_large_image', title: campaign.name, description, images: campaign.banner_url ? [campaign.banner_url] : undefined },
  };
}

export default async function UnlockPage({ params }: { params: { slug: string } }) {
  const campaign = await loadPublicCampaign(params.slug);
  if (!campaign) notFound();
  return <UnlockClient campaign={{ ...campaign, tasks: campaign.tasks || [], task_metadata: campaign.task_metadata || {} }} />;
}
