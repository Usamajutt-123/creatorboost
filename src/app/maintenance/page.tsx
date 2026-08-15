import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { getOperationalSettings } from '@/lib/operational-settings';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Scheduled maintenance',
  robots: { index: false, follow: false },
};

/**
 * Shown while an operator has `maintenance_mode` enabled. Uses the existing
 * visual language (hero gradient + glass card) so nothing about the product's
 * design changes; this page simply did not exist before, which is why the
 * admin toggle had no effect.
 */
export default async function MaintenancePage() {
  const settings = await getOperationalSettings();

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 py-12">
      <main className="relative w-full max-w-lg text-center">
        <div className="glass-strong rounded-2xl p-8 card-glow shadow-2xl">
          <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-5">
            <Wrench className="w-7 h-7 text-white" />
          </span>
          <h1 className="font-display text-2xl font-bold mb-2">We&apos;ll be right back</h1>
          <p className="text-sm text-gray-400">
            CreatorBoost is undergoing scheduled maintenance. Existing campaigns and earnings are safe —
            please check back shortly.
          </p>
          {settings.announcement && (
            <p className="mt-5 rounded-xl bg-purple-500/10 border border-purple-500/30 px-4 py-3 text-xs text-purple-200">
              {settings.announcement}
            </p>
          )}
          <p className="mt-6 text-xs text-gray-500">
            <Link href="/login" className="text-purple-400 hover:text-purple-300">Operator sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
