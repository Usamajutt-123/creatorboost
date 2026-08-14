'use server';

import { createClient } from '@/lib/supabase/server';
import { ADMIN_SENT_NOTIFICATION_TYPE } from '@/lib/notification-policy';
import { revalidatePath } from 'next/cache';

export async function markNotificationReadAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invalid notification' };
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'Notification could not be updated' };
  if (!data) return { ok: false, error: 'Notification not found' };
  revalidatePath('/dashboard/notifications');
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
    .eq('read', false);
  if (error) return { ok: false, error: 'Notifications could not be updated' };
  revalidatePath('/dashboard/notifications');
  return { ok: true };
}

export async function getUnreadNotificationCountAction(): Promise<number> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', ADMIN_SENT_NOTIFICATION_TYPE)
    .eq('read', false);
  return count ?? 0;
}
