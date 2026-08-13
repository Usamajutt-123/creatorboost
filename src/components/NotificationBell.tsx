'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getUnreadNotificationCountAction } from '@/lib/notification-actions';

/**
 * `userId` is supplied by server components that already resolved the session,
 * which skips an extra `auth.getUser()` network round-trip before the realtime
 * subscription can start. Client-rendered screens that do not have it fall back
 * to resolving the user themselves.
 */
export default function NotificationBell({ userId }: { userId?: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const n = await getUnreadNotificationCountAction();
        if (!cancelled) setCount(n);
      } catch {
        if (!cancelled) setCount(0);
      }
    };
    void load();

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const id = userId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!id || cancelled) return;
      channel = supabase
        .channel(`notifications:${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` },
          () => { void load(); },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <Link href="/dashboard/notifications" aria-label="Open notifications" className="relative p-2 glass rounded-lg hover:bg-white/5">
      <Bell className="w-5 h-5 text-gray-300" />
      {count != null && count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-purple-500 text-[10px] font-bold text-white flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
