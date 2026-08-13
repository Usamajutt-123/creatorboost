import { adminListWithdrawals } from '@/lib/admin-server';
import AdminWithdrawalsClient from './WithdrawalsClient';

export const dynamic = 'force-dynamic';

export default async function AdminWithdrawalsPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of a post-hydration server-action round-trip.
  const withdrawals = await adminListWithdrawals().catch((e: Error) => e);

  return (
    <AdminWithdrawalsClient
      initialWithdrawals={(Array.isArray(withdrawals) ? withdrawals : []) as never[]}
      initialError={withdrawals instanceof Error ? withdrawals.message : null}
    />
  );
}
