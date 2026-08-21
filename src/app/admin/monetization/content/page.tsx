import { monetizationLoadAll } from '@/lib/monetization/monetization-admin';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import ContentClient from './ContentClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationContentPage() {
  let steps: Record<string, unknown>[] = [];
  let loadError: string | null = null;
  try {
    const data = await monetizationLoadAll();
    steps = data.steps as unknown as never[];
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Steps could not be loaded';
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Step Content</h1>
        <p className="text-sm text-gray-400">
          The shortener pages visitors see after unlocking. Reorder steps by dragging the ☰ handle —
          the public flow follows this order instantly.
        </p>
      </div>
      <MonetizationNav />
      <ContentClient initialSteps={steps as never[]} initialError={loadError} />
    </div>
  );
}
