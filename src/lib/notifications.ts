import { cache as reactCache } from 'react';
import { createAdminClient, createClient } from '@/lib/supabase/server';

// See session.ts: `cache` is provided by the Next.js server runtime; fall back
// to the identity so this module also loads under plain Node (unit tests).
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : ((fn: unknown) => fn) as never;

export type NotificationType = 'earning' | 'withdrawal' | 'campaign' | 'referral' | 'system' | 'announcement';

export type NotificationPayload = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
};

function safeLink(link?: string | null): string | null {
  if (!link || typeof link !== 'string') return null;
  return link.startsWith('/') && !link.startsWith('//') ? link.slice(0, 300) : null;
}

/** Store an in-app notification. Never throws — callers must not fail money movements. */
export async function createNotification(payload: NotificationPayload): Promise<{ id: string | null }> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('create_notification', {
      p_user_id: payload.userId,
      p_type: payload.type,
      p_title: payload.title.slice(0, 200),
      p_message: payload.message.slice(0, 2000),
      p_link: safeLink(payload.link),
      p_metadata: payload.metadata || {},
    });
    if (error) {
      const { data: inserted, error: insertError } = await supabase
        .from('notifications')
        .insert({
          user_id: payload.userId,
          type: payload.type,
          title: payload.title.slice(0, 200),
          message: payload.message.slice(0, 2000),
          link: safeLink(payload.link),
          metadata: payload.metadata || {},
        })
        .select('id')
        .maybeSingle();
      if (insertError) {
        console.error('[notifications] create failed', insertError);
        return { id: null };
      }
      return { id: inserted?.id ?? null };
    }
    return { id: (data as string) || null };
  } catch (e) {
    console.error('[notifications] create failed', e);
    return { id: null };
  }
}

export async function notifyAdmins(input: Omit<NotificationPayload, 'userId'>): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc('notify_admins', {
      p_type: input.type,
      p_title: input.title,
      p_message: input.message,
      p_link: safeLink(input.link),
      p_metadata: input.metadata || {},
    });
    if (error) {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['admin', 'super_admin'])
        .eq('status', 'active');
      for (const admin of admins || []) {
        await createNotification({ ...input, userId: admin.id });
      }
    }
  } catch (e) {
    console.error('[notifications] notifyAdmins failed', e);
  }
}

export function canUserAccessNotification(ownerId: string, actorId: string): boolean {
  return Boolean(ownerId) && ownerId === actorId;
}

/**
 * Server-side unread notification count for a session-verified user.
 *
 * Used by dashboard/admin layouts and pages so the topbar bell renders its
 * badge with the real count during SSR instead of firing a separate server
 * action + auth round-trip after hydration. The user id must come from the
 * already-verified session; row access is still enforced by RLS through the
 * user-scoped client. `cache()` dedupes the query across layout + page in the
 * same request. Realtime updates still flow through the bell's subscription.
 */
export const getUnreadNotificationCount = cache(async (userId: string): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
});
