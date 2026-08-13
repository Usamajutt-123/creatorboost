import { adminLoadCountries, adminLoadLevels, adminLoadSettings } from '@/lib/admin-server';
import { getCpmSettingsAction } from '@/lib/cpm-actions';
import CpmAdminClient from './CpmClient';

export const dynamic = 'force-dynamic';

export default async function CpmAdminPage() {
  // Same four reads the client used to run on mount, moved into the server
  // render: one authorized pass (requireAdmin is request-cached), first paint
  // includes all configuration instead of four post-hydration round-trips.
  let countries: any[] = [];
  let levels: any[] = [];
  let referralPct = 10;
  let globalCpm = '5';
  let minCpm = '0';
  let maxCpm = '100';
  let cpmMeta: { updatedAt?: string; updatedBy?: string | null; unauthorized?: boolean; loadError?: string } = {};
  let cpmError: string | null = null;
  let loadError: string | null = null;

  try {
    const [c, l, s, cpm] = await Promise.all([
      adminLoadCountries(),
      adminLoadLevels(),
      adminLoadSettings(),
      getCpmSettingsAction(),
    ]);
    countries = c as any[];
    levels = l;
    if (s) referralPct = Number(s.referral_percentage);
    if (cpm.ok) {
      globalCpm = String(cpm.settings.cpm ?? '');
      minCpm = String(cpm.settings.min_cpm ?? '');
      maxCpm = String(cpm.settings.max_cpm ?? '');
      cpmMeta = {
        updatedAt: String(cpm.settings.updated_at || ''),
        updatedBy: cpm.updatedByName,
      };
    } else {
      cpmMeta = { unauthorized: cpm.error.includes('Admin') || cpm.error.includes('authenticated'), loadError: cpm.error };
      cpmError = cpm.error;
    }
  } catch (e: any) {
    cpmError = e.message || 'Failed to load CPM data';
    loadError = e.message || 'Failed to load CPM data';
  }

  return (
    <CpmAdminClient
      initialCountries={countries as never[]}
      initialLevels={levels as never[]}
      initialReferralPct={referralPct}
      initialGlobalCpm={globalCpm}
      initialMinCpm={minCpm}
      initialMaxCpm={maxCpm}
      initialCpmMeta={cpmMeta}
      initialCpmError={cpmError}
      initialLoadError={loadError}
    />
  );
}
