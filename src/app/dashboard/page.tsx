import { createClient } from '@/lib/supabase/server';
import DashboardTopbar from '@/components/DashboardTopbar';
import StatCard from '@/components/StatCard';
import DashboardCharts from '@/components/DashboardCharts';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { DollarSign, TrendingUp, Eye, Zap, Wallet, Clock, BarChart3, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Earnings: today vs yesterday (real change %)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
  const todayIso = todayStart.toISOString();
  const yesterdayIso = yesterdayStart.toISOString();

  const [{ data: todayEarnings }, { data: yesterdayEarnings }, { data: weekEarnings }] = await Promise.all([
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', todayIso),
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', yesterdayIso).lt('created_at', todayIso),
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
  ]);

  const todayTotal = todayEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const yesterdayTotal = yesterdayEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const weekTotal = weekEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;

  const todayChange = yesterdayTotal > 0 ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100 : 0;
  const todayChangeLabel = todayTotal === 0 && yesterdayTotal === 0
    ? 'No earnings yet'
    : `${todayChange >= 0 ? '+' : ''}${todayChange.toFixed(1)}% vs yesterday`;

  const validRate = profile?.total_views ? Math.round(((profile.valid_views || 0) / profile.total_views) * 100) : 0;

  // Real average CPM from the most recent valid views.
  const { data: recentCpm } = await supabase
    .from('views')
    .select('cpm_rate')
    .eq('creator_id', user.id)
    .eq('status', 'valid')
    .order('created_at', { ascending: false })
    .limit(50);
  const avgCpm = recentCpm && recentCpm.length
    ? recentCpm.reduce((s, v) => s + Number(v.cpm_rate || 0), 0) / recentCpm.length
    : null;

  // Week view trend (real)
  const priorWeekStart = new Date(Date.now() - 14 * 86400_000).toISOString();
  const weekStart = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ count: priorWeek }, { count: currentWeek }] = await Promise.all([
    supabase.from('views').select('id', { count: 'exact', head: true }).eq('creator_id', user.id).gte('created_at', priorWeekStart).lt('created_at', weekStart),
    supabase.from('views').select('id', { count: 'exact', head: true }).eq('creator_id', user.id).gte('created_at', weekStart),
  ]);
  const viewTrend = priorWeek && priorWeek > 0 ? (((currentWeek ?? 0) - priorWeek) / priorWeek) * 100 : 0;

  // Recent campaigns
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .eq('creator_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  // Recent activity (latest earnings)
  const { data: recent } = await supabase
    .from('earnings')
    .select('*, campaign:campaigns(name)')
    .eq('creator_id', user.id)
    .order('created_at', { ascending: false })
    .limit(6);

  return (
    <>
      <DashboardTopbar
        title="Dashboard"
        subtitle={`Welcome back, ${profile?.full_name || 'creator'}. Here's your overview.`}
        fullName={profile?.full_name}
        email={profile?.email}
      />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Earnings" value={formatCurrency(profile?.total_earnings || 0)} change={`Week: ${formatCurrency(weekTotal)}`} icon={DollarSign} color="purple" />
          <StatCard label="Today's Earnings" value={formatCurrency(todayTotal)} change={todayChangeLabel} icon={TrendingUp} color="blue" />
          <StatCard label="Valid Views" value={formatNumber(profile?.valid_views || 0)} change={`${validRate}% valid rate`} icon={Eye} color="green" />
          <StatCard label="Avg CPM" value={avgCpm ? `$${avgCpm.toFixed(2)}` : '$0.00'} change={`${profile?.level || 'bronze'} tier`} icon={Zap} color="pink" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Balance" value={formatCurrency(profile?.available_balance || 0)} change="Available" icon={Wallet} color="yellow" />
          <StatCard label="Pending" value={formatCurrency(profile?.pending_earnings || 0)} change="Holding period" icon={Clock} color="orange" />
          <StatCard label="Total Views" value={formatNumber(profile?.total_views || 0)} change={`${viewTrend >= 0 ? '+' : ''}${viewTrend.toFixed(1)}% this week`} icon={BarChart3} color="cyan" />
          <StatCard label="Referral Earnings" value={formatCurrency(profile?.referral_earnings || 0)} change="Lifetime" icon={Users} color="purple" />
        </div>

        <DashboardCharts />

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Campaigns</h3>
            <a href="/dashboard/campaigns" className="text-xs text-purple-400">View all →</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">Campaign</th>
                  <th className="text-left py-2 font-medium">Views</th>
                  <th className="text-left py-2 font-medium">Valid</th>
                  <th className="text-left py-2 font-medium">Earnings</th>
                  <th className="text-left py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns?.map((c: any) => (
                  <tr key={c.id} className="border-b border-white/5 table-row">
                    <td className="py-3 font-medium">{c.name}</td>
                    <td className="py-3">{formatNumber(c.total_views)}</td>
                    <td className="py-3">{formatNumber(c.valid_views)}</td>
                    <td className="py-3 text-green-400">{formatCurrency(c.total_earnings)}</td>
                    <td className="py-3"><span className={`badge status-${c.status}`}>{c.status}</span></td>
                  </tr>
                ))}
                {!campaigns?.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-gray-500 text-sm">No campaigns yet. <a href="/dashboard/create-campaign" className="text-purple-400">Create one →</a></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recent?.map((r: any) => (
              <div key={r.id} className="flex items-start gap-3 p-3 glass rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center text-lg flex-shrink-0">💸</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <strong className="text-green-400">+{formatCurrency(r.amount)}</strong> earned from <strong>{r.campaign?.name || 'campaign'}</strong>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{new Date(r.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
            {!recent?.length && <p className="text-sm text-gray-500 text-center py-4">No recent activity</p>}
          </div>
        </div>
      </div>
    </>
  );
}
