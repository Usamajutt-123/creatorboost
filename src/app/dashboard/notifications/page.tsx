import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { ADMIN_SENT_NOTIFICATION_TYPE } from '@/lib/notification-policy';
import DashboardTopbar from '@/components/DashboardTopbar';
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  const [{ data: notifs, error }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, title, message, link, read, created_at, metadata')
      .eq('user_id', user.id)
      .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
      .eq('read', false),
  ]);

  const unread = unreadCount ?? (notifs || []).filter(n => !n.read).length;

  return (
    <>
      <DashboardTopbar title="Notifications" subtitle={error ? 'Could not load notifications' : `${unread} unread`} userId={user.id} unreadCount={unread} />
      <NotificationsClient
        initial={notifs || []}
        loadError={error ? 'Notifications could not be loaded. Please try again.' : null}
      />
    </>
  );
}
