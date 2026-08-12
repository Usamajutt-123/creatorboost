'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/lib/utils';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/lib/notification-actions';

const ICONS: Record<string, string> = {
  earning: '💰',
  withdrawal: '💸',
  campaign: '📢',
  referral: '👥',
  system: '⚙️',
  announcement: '📣',
};

type Item = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
};

export default function NotificationsClient({ initial, loadError }: { initial: Item[]; loadError: string | null }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState(loadError);
  const [pending, start] = useTransition();

  const unread = items.filter(n => !n.read).length;

  const markOne = (id: string) => {
    start(async () => {
      const res = await markNotificationReadAction(id);
      if (!res.ok) { setError(res.error || 'Could not mark as read'); return; }
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    });
  };

  const markAll = () => {
    start(async () => {
      const res = await markAllNotificationsReadAction();
      if (!res.ok) { setError(res.error || 'Could not mark all as read'); return; }
      setItems(prev => prev.map(n => ({ ...n, read: true })));
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{unread} unread</p>
        {unread > 0 && (
          <button onClick={markAll} disabled={pending} className="btn-ghost px-3 py-1.5 rounded-lg text-xs disabled:opacity-50">
            Mark all as read
          </button>
        )}
      </div>
      {error && <div className="glass rounded-xl p-4 text-sm text-red-400">{error}</div>}
      {items.map(n => {
        const icon = ICONS[n.type] || ICONS.system;
        const safeLink = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : null;
        const body = (
          <>
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-xl">{icon}</div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm">{n.title}</h4>
              <p className="text-xs text-gray-400 mt-0.5">{n.message}</p>
              <p className="text-xs text-gray-500 mt-1">{timeAgo(n.created_at)}</p>
            </div>
            {!n.read && (
              <button
                onClick={(e) => { e.preventDefault(); markOne(n.id); }}
                className="text-[10px] text-purple-300 flex-shrink-0"
              >
                Mark read
              </button>
            )}
          </>
        );
        const cls = `glass rounded-xl p-4 flex items-start gap-3 ${n.read ? 'opacity-70' : 'ring-1 ring-purple-500/30'}`;
        return safeLink ? (
          <Link key={n.id} href={safeLink} className={`${cls} hover:bg-white/5 transition`}>{body}</Link>
        ) : (
          <div key={n.id} className={cls}>{body}</div>
        );
      })}
      {!items.length && !error && (
        <div className="glass rounded-xl p-12 text-center">
          <div className="text-5xl mb-3">🔔</div>
          <h3 className="font-semibold mb-1">No notifications yet</h3>
          <p className="text-sm text-gray-500">You&apos;ll see updates here when something happens</p>
        </div>
      )}
    </div>
  );
}
