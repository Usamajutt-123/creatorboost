import {
  monetizationLoadOverview,
  monetizationLoadFunnel,
  monetizationLoadDaily,
  monetizationLoadCountries,
  monetizationLoadTopCreators,
  monetizationLoadTopCampaigns,
} from '@/lib/monetization/monetization-admin';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import OverviewClient from './OverviewClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationOverviewPage() {
  const [overview, funnel, daily, countries, topCreators, topCampaigns] = await Promise.all([
    monetizationLoadOverview().catch(() => null),
    monetizationLoadFunnel(30).catch(() => []),
    monetizationLoadDaily(14).catch(() => []),
    monetizationLoadCountries(7, 8).catch(() => []),
    monetizationLoadTopCreators(30, 5).catch(() => []),
    monetizationLoadTopCampaigns(30, 5).catch(() => []),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Monetization Overview</h1>
        <p className="text-sm text-gray-400">
          Qualified views, flow completion and revenue. Revenue values come from the manual revenue ledger
          (labeled in Revenue) and the creator payout ledger — nothing is invented.
        </p>
      </div>
      <MonetizationNav />
      <OverviewClient
        overview={overview}
        funnel={funnel}
        daily={daily}
        countries={countries}
        topCreators={topCreators}
        topCampaigns={topCampaigns}
        schemaMissing={overview === null}
      />
    </div>
  );
}