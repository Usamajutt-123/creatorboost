import { monetizationLoadAll } from '@/lib/monetization/monetization-admin';
import MonetizationNav from '@/components/monetization/MonetizationNav';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function MonetizationSettingsPage() {
  let settings: Record<string, unknown> | null = null;
  let loadError: string | null = null;
  try {
    const data = await monetizationLoadAll();
    settings = data.settings as Record<string, unknown> | null;
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Settings could not be loaded';
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold mb-1">Monetization Settings</h1>
        <p className="text-sm text-gray-400">Global controls for the monetized unlock + shortener flow.</p>
      </div>
      <MonetizationNav />
      <SettingsClient initialSettings={settings} initialError={loadError} />
    </div>
  );
}
