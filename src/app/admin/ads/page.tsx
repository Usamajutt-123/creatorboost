import { adminLoadAdNetworks, adminListAdRevenue } from '@/lib/admin-server';
import AdminAdsClient from './AdsClient';

export const dynamic = 'force-dynamic';

export default async function AdminAdsPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of two post-hydration server-action round-trips.
  const [networks, revenue] = await Promise.all([
    adminLoadAdNetworks().catch((e: Error) => e),
    adminListAdRevenue().catch((e: Error) => e),
  ]);

  const error = networks instanceof Error ? networks : revenue instanceof Error ? revenue : null;

  return (
    <AdminAdsClient
      initialNetworks={(Array.isArray(networks) ? networks : []) as never[]}
      initialRevenue={(Array.isArray(revenue) ? revenue : []) as never[]}
      initialError={error ? error.message : null}
    />
  );
}
