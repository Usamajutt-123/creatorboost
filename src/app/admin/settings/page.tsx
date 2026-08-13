import { adminLoadSettings, adminLoadWithdrawalMethods } from '@/lib/admin-server';
import AdminSettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of two post-hydration server-action round-trips.
  const [settings, methods] = await Promise.all([
    adminLoadSettings().catch(() => null),
    adminLoadWithdrawalMethods().catch((e: Error) => e),
  ]);

  return (
    <AdminSettingsClient
      initialSettings={settings}
      initialMethods={(Array.isArray(methods) ? methods : []) as never[]}
      initialError={methods instanceof Error ? methods.message : null}
    />
  );
}
