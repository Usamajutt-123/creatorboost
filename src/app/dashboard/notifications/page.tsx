import { createClient } from '@/lib/supabase/server';
import DashboardTopbar from '@/components/DashboardTopbar';
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: notifs, error } = await supabase
    .from('notifications')
    .select('id, type, title, message, link, read, created_at, metadata')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const unread = (notifs || []).filter(n => !n.read).length;

  return (
    <>
      <DashboardTopbar title="Notifications" subtitle={error ? 'Could not load notifications' : `${unread} unread`} />
      <NotificationsClient
        initial={notifs || []}
        loadError={error ? 'Notifications could not be loaded. Please try again.' : null}
      />
    </>
  );
}
