import { notFound } from 'next/navigation';
import { isCampaignUuid, resolveParams } from '@/lib/route-params';
import EditCampaignForm from './EditCampaignForm';

export const dynamic = 'force-dynamic';

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await resolveParams(params);
  if (!isCampaignUuid(id)) notFound();
  return <EditCampaignForm campaignId={id} />;
}
