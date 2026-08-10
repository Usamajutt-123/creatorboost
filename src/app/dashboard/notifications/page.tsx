import { createClient } from '@/lib/supabase/server';
import DashboardTopbar from '@/components/DashboardTopbar';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, { icon: string; color: string }> = {
  earning: { icon: '💰', color: 'green' },
  withdrawal: { icon: '💸', color: 'blue' },
  campaign: { icon: '📢', color: 'purple' },
  referral: { icon: '👥', color: 'pink' },
  system: { icon: '⚙️', color: 'gray' },
  announcement: { icon: '📣', color: 'yellow' },
};

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: notifs } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  // Mark all as read
  await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);

  return (
    <>
      <DashboardTopbar title="Notifications" />
      <div className="p-4 sm:p-6 space-y-3">
        {notifs?.map(n => {
          const meta = ICONS[n.type] || ICONS.system;
          return (
            <div key={n.id} className="glass rounded-xl p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-xl">{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm">{n.title}</h4>
                <p className="text-xs text-gray-400 mt-0.5">{n.message}</p>
                <p className="text-xs text-gray-500 mt-1">{timeAgo(n.created_at)}</p>
              </div>
            </div>
          );
        })}
        {!notifs?.length && (
          <div className="glass rounded-xl p-12 text-center">
            <div className="text-5xl mb-3">🔔</div>
            <h3 className="font-semibold mb-1">No notifications yet</h3>
            <p className="text-sm text-gray-500">You&apos;ll see updates here when something happens</p>
          </div>
        )}
      </div>
    </>
  );
}
