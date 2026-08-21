import { monetizationLoadAll, monetizationLoadRevenue } from '@/lib/monetization/monetization-admin';
import { adminLoadCountries, adminLoadLevels } from '@/lib/admin-server';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import PayoutsClient from './PayoutsClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationPayoutsPage() {
  let payouts: Record<string, unknown> | null = null;
  let countries: unknown[] = [];
  let levels: unknown[] = [];
  let revenue: unknown[] = [];
  let loadError: string | null = null;

  try {
    const [all, c, l, r] = await Promise.all([
      monetizationLoadAll(),
      adminLoadCountries(),
      adminLoadLevels(),
      monetizationLoadRevenue(),
    ]);
    payouts = all.payouts as Record<string, unknown> | null;
    countries = c;
    levels = l;
    revenue = r;
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Payout configuration could not be loaded';
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Payouts</h1>
        <p className="text-sm text-gray-400">
          Country rates, level multipliers, creator share and the manual revenue ledger. The earning
          formula stays: (country CPM × level multiplier) / 1000 — from qualified views only.
        </p>
      </div>
      <MonetizationNav />
      <PayoutsClient
        initialPayouts={payouts}
        initialCountries={countries as never[]}
        initialLevels={levels as never[]}
        initialRevenue={revenue as never[]}
        initialError={loadError}
      />
    </div>
  );
}
