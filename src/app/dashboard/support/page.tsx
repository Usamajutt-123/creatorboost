import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import SupportClient from './SupportClient';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // The user's own tickets (RLS-scoped through the user's server session),
  // rendered with the first paint instead of a post-hydration fetch.
  const [{ data: tickets }, unreadCount] = await Promise.all([
    supabase
      .from('support_tickets')
      .select('id, subject, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <SupportClient
      initialTickets={(tickets || []) as never[]}
      userId={user.id}
      unreadCount={unreadCount}
    />
  );
}
