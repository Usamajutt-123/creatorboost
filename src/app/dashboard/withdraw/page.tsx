import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import WithdrawClient from './WithdrawClient';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS = 'id, available_balance, pending_earnings';
const WITHDRAWAL_COLUMNS = 'id, amount, method, status, created_at';

export default async function WithdrawPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // These four reads are independent, so they run in parallel instead of as a
  // four-request waterfall. They previously ran in the browser after
  // hydration (skeleton first, then values); rendering them on the server
  // removes that round-trip entirely. Same columns, same RLS scope.
  const [{ data: p }, { data: w }, { data: settings }, { data: m }, unreadCount] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).single(),
    supabase.from('withdrawals').select(WITHDRAWAL_COLUMNS).eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('public_platform_settings').select('min_withdrawal').single(),
    // Only show enabled methods
    supabase
      .from('withdrawal_method_config')
      .select('id, method, label, icon, enabled, min_amount, max_amount, fee_percentage')
      .eq('enabled', true)
      .order('sort_order'),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <WithdrawClient
      initialProfile={(p as { id: string; available_balance: number; pending_earnings: number } | null) ?? null}
      initialHistory={(w || []) as Array<{ id: string; amount: number; method: string; status: string; created_at: string }>}
      initialMinWithdraw={settings ? Number(settings.min_withdrawal) : 10}
      initialMethods={(m || []) as never[]}
      userId={user.id}
      unreadCount={unreadCount}
    />
  );
}
