import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import CampaignsClient from './CampaignsClient';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // Server-rendered initial list (same columns the cards render, same RLS
  // scope as before — enforced by the user-scoped server client). The client
  // component receives it as props instead of fetching after hydration.
  const [{ data: campaigns }, unreadCount] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, slug, status, thumbnail_url, total_views, valid_views, total_earnings')
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    getUnreadNotificationCount(user.id),
  ]);

  return <CampaignsClient initial={(campaigns || []) as never[]} userId={user.id} unreadCount={unreadCount} />;
}
