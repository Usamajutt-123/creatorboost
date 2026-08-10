'use client';
import { useEffect, useState } from 'react';
import { Copy, Users, CheckCircle, MousePointerClick, DollarSign } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import StatCard from '@/components/StatCard';

export default function ReferralsPage() {
  const [profile, setProfile] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [clicks, setClicks] = useState(0);
  const [commissionRate, setCommissionRate] = useState(10);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(p);
      const { data: refs } = await supabase
        .from('referrals')
        .select('referred:referred_id(full_name, email, total_earnings, created_at), total_commission, status')
        .eq('referrer_id', user.id);
      setReferrals(refs || []);
      const { count } = await supabase
        .from('referral_clicks')
        .select('*', { count: 'exact', head: true })
        .eq('referral_code', p?.referral_code);
      setClicks(count || 0);
      const { data: settings } = await supabase.from('platform_settings').select('referral_percentage').single();
      if (settings) setCommissionRate(settings.referral_percentage);
    };
    load();
  }, []);

  const referralLink = profile ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${profile.referral_code}` : '';

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success('Referral link copied!');
  };

  const totalCommission = referrals.reduce((s, r) => s + Number(r.total_commission || 0), 0);

  return (
    <>
      <DashboardTopbar title="Referral Program" subtitle={`Earn ${commissionRate}% commission on every friend's earnings`} />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Referrals" value={String(referrals.length)} change="All time" icon={Users} color="purple" />
          <StatCard label="Active" value={String(referrals.filter(r => r.status === 'active').length)} change="Earning" icon={CheckCircle} color="green" />
          <StatCard label="Link Clicks" value={String(clicks)} change="Total" icon={MousePointerClick} color="blue" />
          <StatCard label="Earnings" value={formatCurrency(totalCommission)} change="Lifetime" icon={DollarSign} color="pink" />
        </div>

        <div className="glass-strong rounded-2xl p-6">
          <h3 className="font-semibold mb-2">Your Referral Link</h3>
          <p className="text-xs text-gray-500 mb-4">Share this link and earn {commissionRate}% lifetime commission on their earnings</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input readOnly value={referralLink} className="input-field flex-1 font-mono text-xs" />
            <button onClick={copyLink} className="btn-primary px-5 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2">
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Your Referrals</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">User</th>
                  <th className="text-left py-2 font-medium">Joined</th>
                  <th className="text-left py-2 font-medium">Their Earnings</th>
                  <th className="text-left py-2 font-medium">Your Commission</th>
                  <th className="text-left py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r, i) => (
                  <tr key={i} className="border-b border-white/5 table-row">
                    <td className="py-3">
                      <div className="font-medium">{r.referred?.full_name || '—'}</div>
                      <div className="text-xs text-gray-500">{r.referred?.email}</div>
                    </td>
                    <td className="py-3">{new Date(r.referred?.created_at).toLocaleDateString()}</td>
                    <td className="py-3">{formatCurrency(r.referred?.total_earnings || 0)}</td>
                    <td className="py-3 text-green-400 font-semibold">{formatCurrency(r.total_commission || 0)}</td>
                    <td className="py-3"><span className={`badge status-${r.status === 'active' ? 'active' : 'expired'}`}>{r.status}</span></td>
                  </tr>
                ))}
                {!referrals.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-gray-500 text-sm">No referrals yet — share your link to start earning</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
