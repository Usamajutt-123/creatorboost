'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Copy, DollarSign, MousePointerClick, Users } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { type ReferralDashboardData } from '@/lib/referral-actions';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import StatCard from '@/components/StatCard';

/**
 * The referral dashboard is server-rendered (see page.tsx); `initial` arrives
 * with the first paint instead of a post-hydration server-action round-trip.
 */
export default function ReferralsClient({
  initial,
  initialError,
  userId,
  unreadCount,
  origin,
}: {
  initial: ReferralDashboardData | null;
  initialError: string | null;
  userId: string;
  unreadCount: number;
  /** Request origin resolved server-side (matches window.location.origin). */
  origin: string;
}) {
  const [data] = useState<ReferralDashboardData | null>(initial);
  const [loading] = useState(initial == null && initialError == null);
  // The origin comes from the server render (same value the browser would
  // have built from `window.location`), so the link is correct in the first
  // paint with no window access during SSR.
  const [referralLink] = useState(() => (data && origin ? `${origin}/signup?ref=${data.referralCode}` : ''));

  useEffect(() => {
    if (!initialError) return;
    toast.error(initialError);
  }, [initialError]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success('Referral link copied');
    } catch {
      toast.error('Could not copy the referral link');
    }
  };

  const referrals = data?.referrals || [];
  const totalCommission = referrals.reduce((sum, referral) => sum + referral.commission, 0);

  return <>
    <DashboardTopbar title="Referral Program" subtitle={data ? `Earn ${data.commissionRate}% commission on eligible referred-creator earnings` : 'Loading your referral data'} userId={userId} unreadCount={unreadCount} />
    <div className="p-4 sm:p-6 space-y-6">
      {loading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(item => <div key={item} className="skeleton h-28 rounded-2xl" />)}</div> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Referrals" value={String(referrals.length)} change="All time" icon={Users} color="purple" />
          <StatCard label="Active" value={String(referrals.filter(referral => referral.status === 'active').length)} change="Eligible relationships" icon={CheckCircle} color="green" />
          <StatCard label="Link Clicks" value={String(data?.clicks || 0)} change="Recorded clicks" icon={MousePointerClick} color="blue" />
          <StatCard label="Referral Earnings" value={formatCurrency(data?.referralEarnings || totalCommission)} change="Ledger total" icon={DollarSign} color="pink" />
        </div>
        <div className="glass-strong rounded-2xl p-6"><h2 className="font-semibold mb-2">Your referral link</h2><p className="text-xs text-gray-500 mb-4">Referral commissions enter the same pending-to-available earning lifecycle as view earnings.</p><div className="flex flex-col sm:flex-row gap-2"><input readOnly value={referralLink} className="input-field flex-1 font-mono text-xs" aria-label="Referral link" /><button onClick={copyLink} className="btn-primary px-5 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Copy</button></div></div>
        <div className="glass rounded-2xl p-5"><h2 className="font-semibold mb-4">Your referrals</h2><div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]"><thead><tr className="text-xs text-gray-500 border-b border-white/5"><th className="text-left py-2 font-medium">Creator</th><th className="text-left py-2 font-medium">Joined</th><th className="text-left py-2 font-medium">Your commission</th><th className="text-left py-2 font-medium">Status</th></tr></thead><tbody>{referrals.map(referral => <tr key={referral.id} className="border-b border-white/5 table-row"><td className="py-3 font-medium">{referral.name}</td><td className="py-3">{new Date(referral.joinedAt).toLocaleDateString()}</td><td className="py-3 text-green-400 font-semibold">{formatCurrency(referral.commission)}</td><td className="py-3"><span className={`badge status-${referral.status === 'active' ? 'active' : 'expired'}`}>{referral.status}</span></td></tr>)}{!referrals.length && <tr><td colSpan={4} className="py-6 text-center text-gray-500 text-sm">No referrals yet — share your link to start earning.</td></tr>}</tbody></table></div></div>
      </>}
    </div>
  </>;
}
