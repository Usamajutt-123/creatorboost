import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UnlockClient from './UnlockClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('name, description')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();

  if (!campaign) return { title: 'Campaign not found' };

  return {
    title: campaign.name,
    description: campaign.description || `Unlock ${campaign.name}`,
    openGraph: {
      title: campaign.name,
      description: campaign.description || '',
      type: 'website',
    },
  };
}

export default async function UnlockPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();

  if (!campaign) notFound();

  return <UnlockClient campaign={campaign} />;
}
