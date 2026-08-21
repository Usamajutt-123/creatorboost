import {
  monetizationLoadFunnel,
  monetizationLoadStepStats,
  monetizationLoadDaily,
  monetizationLoadCountries,
  monetizationLoadDevices,
  monetizationLoadRevenue,
} from '@/lib/monetization/monetization-admin';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import AnalyticsClient from './AnalyticsClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationAnalyticsPage() {
  const [funnel, stepStats, daily, countries, devices, revenue] = await Promise.all([
    monetizationLoadFunnel(30).catch(() => []),
    monetizationLoadStepStats(30).catch(() => []),
    monetizationLoadDaily(30).catch(() => []),
    monetizationLoadCountries(30, 10).catch(() => []),
    monetizationLoadDevices(30).catch(() => []),
    monetizationLoadRevenue().catch(() => []),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Monetization Analytics</h1>
        <p className="text-sm text-gray-400">
          Funnel drop-off, traffic quality and the revenue split. Only real data is shown — the revenue
          ledger is manual until a provider API is connected.
        </p>
      </div>
      <MonetizationNav />
      <AnalyticsClient
        funnel={funnel}
        stepStats={stepStats}
        daily={daily}
        countries={countries}
        devices={devices}
        revenue={revenue}
      />
    </div>
  );
}
