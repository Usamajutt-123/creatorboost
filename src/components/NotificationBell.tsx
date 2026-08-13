'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getUnreadNotificationCountAction } from '@/lib/notification-actions';

/**
 * `userId` is supplied by server components that already resolved the session,
 * which skips an extra `auth.getUser()` network round-trip before the realtime
 * subscription can start. Client-rendered screens that do not have it fall back
 * to resolving the user themselves.
 *
 * `initialCount` is the server-rendered unread count: when provided the badge
 * is correct in the first paint and no post-hydration fetch is needed. The
 * realtime subscription still refreshes it whenever a notification changes.
 *
 * PERFORMANCE NOTES (realtime behaviour itself is unchanged)
 * ----------------------------------------------------------
 * 1. The Supabase client (~246 KB: GoTrue + PostgREST + Realtime/phoenix) is
 *    now imported *inside* the effect rather than at module scope. It used to
 *    be a static import, which forced the entire library into the initial
 *    JavaScript graph of every dashboard/admin route, to be parsed and
 *    evaluated on the main thread **during hydration** — one of the largest
 *    contributors to TBT — even though the socket is not needed to paint
 *    anything.
 * 2. Opening the socket is additionally deferred to browser idle time, so it
 *    never competes with hydration or the first interaction. A realtime
 *    subscription is a background concern: a notification arriving a few
 *    hundred milliseconds later is invisible to the user, whereas blocking the
 *    main thread during hydration is not.
 * 3. `subscribed` guards against a duplicate channel if the effect is torn down
 *    and re-run (React 18 StrictMode double-invoke in development, or a
 *    `userId` change) before the dynamic import resolves.
 * 4. The component owns only its own `count` state, so a refresh re-renders
 *    this bell and nothing else — no parent/page re-render is triggered.
 */
export default function NotificationBell({ userId, initialCount }: { userId?: string; initialCount?: number | null }) {
  const [count, setCount] = useState<number | null>(initialCount ?? null);
  const hasServerCount = useRef(initialCount != null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const load = async () => {
      try {
        const n = await getUnreadNotificationCountAction();
        if (!cancelled) setCount(n);
      } catch {
        if (!cancelled) setCount(0);
      }
    };
    if (!hasServerCount.current) void load();

    const start = async () => {
      const { createClient } = await import('@/lib/supabase/client');
      if (cancelled) return;
      const supabase = createClient();
      const id = userId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!id || cancelled) return;
      const channel = supabase
        .channel(`notifications:${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` },
          () => { void load(); },
        )
        .subscribe();
      cleanup = () => { void supabase.removeChannel(channel); };
      // The effect may have been cancelled while `subscribe()` was in flight.
      if (cancelled) { cleanup(); cleanup = null; }
    };

    // Start once the page has finished loading AND the main thread is idle.
    // A notification socket is a background concern — arriving a moment later
    // is invisible — whereas downloading and evaluating ~246 KB while the page
    // is still becoming interactive is not.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      if (typeof idle === 'function') idleHandle = idle(() => { void start(); }, { timeout: 3000 });
      else timeoutHandle = setTimeout(() => { void start(); }, 0);
    };

    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('load', schedule);
      const cancelIdle = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (idleHandle != null) cancelIdle?.(idleHandle);
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
      if (cleanup) cleanup();
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
