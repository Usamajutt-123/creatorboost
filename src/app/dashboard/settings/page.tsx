import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // Only the columns this form renders; avoids shipping the full profile row
  // (balances, referral data, admin fields) to the browser. Rendered on the
  // server so the form appears with the first paint instead of after a
  // post-hydration auth + profile round-trip.
  const [{ data: profile }, unreadCount] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, username, email, bio, country_code, level, created_at')
      .eq('id', user.id)
      .single(),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <SettingsClient
      initialProfile={(profile as never) ?? null}
      userId={user.id}
      unreadCount={unreadCount}
    />
  );
}
