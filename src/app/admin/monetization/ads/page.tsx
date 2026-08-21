import { monetizationLoadAll } from '@/lib/monetization/monetization-admin';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import AdsClient from './AdsClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationAdsPage() {
  let slots: Record<string, unknown>[] = [];
  let steps: Record<string, unknown>[] = [];
  let loadError: string | null = null;
  try {
    const data = await monetizationLoadAll();
    slots = data.slots as unknown as never[];
    steps = data.steps as unknown as never[];
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Ad configuration could not be loaded';
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Ad Management</h1>
        <p className="text-sm text-gray-400">
          Independent ad configuration for the task page and every flow step. Ads are optional for
          visitors and never a requirement to continue.
        </p>
      </div>
      <MonetizationNav />
      <AdsClient initialSlots={slots as never[]} initialSteps={steps as never[]} initialError={loadError} />
    </div>
  );
}
