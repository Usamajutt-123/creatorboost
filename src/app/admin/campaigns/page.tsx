import { adminListCampaigns } from '@/lib/admin-server';
import AdminCampaignsClient from './CampaignsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCampaignsPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of a post-hydration server-action round-trip.
  const campaigns = await adminListCampaigns().catch((e: Error) => e);

  return (
    <AdminCampaignsClient
      initialCampaigns={(Array.isArray(campaigns) ? campaigns : []) as never[]}
      initialError={campaigns instanceof Error ? campaigns.message : null}
    />
  );
}
