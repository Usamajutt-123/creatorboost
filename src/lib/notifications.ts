import { cache as reactCache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_SENT_NOTIFICATION_TYPE } from '@/lib/notification-policy';

// See session.ts: `cache` is provided by the Next.js server runtime; fall back
// to the identity so this module also loads under plain Node (unit tests).
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : ((fn: unknown) => fn) as never;

export function canUserAccessNotification(ownerId: string, actorId: string): boolean {
  return Boolean(ownerId) && ownerId === actorId;
}

/**
 * Server-side unread count for manually sent Admin/Super Admin notifications.
 *
 * Campaign and other automatic notification types are deliberately excluded.
 * The database migration also blocks future automatic rows; this filter keeps
 * legacy automatic history out of the badge without deleting that history.
 */
export const getUnreadNotificationCount = cache(async (userId: string): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
    .eq('read', false);
  return count ?? 0;
});
