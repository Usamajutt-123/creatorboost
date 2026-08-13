import { headers } from 'next/headers';
import { loadReferralDashboardAction } from '@/lib/referral-actions';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import ReferralsClient from './ReferralsClient';

export const dynamic = 'force-dynamic';

export default async function ReferralsPage() {
  const user = await getSessionUser();
  if (!user) return null;

  // Same authorization + data path the client used to call on mount; running
  // it during render removes the post-hydration round-trip and renders the
  // referral stats with the first paint. The link origin is resolved from the
  // request so the server-rendered value matches what the browser would have
  // built from `window.location`.
  const [result, unreadCount, h] = await Promise.all([
    loadReferralDashboardAction(),
    getUnreadNotificationCount(user.id),
    headers(),
  ]);
  const host = h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'http';
  const origin = host ? `${proto}://${host}` : '';

  return (
    <ReferralsClient
      initial={result.success ? result.data : null}
      initialError={result.success ? null : result.error}
      userId={user.id}
      unreadCount={unreadCount}
      origin={origin}
    />
  );
}
