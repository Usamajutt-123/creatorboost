import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getDashboardProfile, getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import DashboardTopbar from '@/components/DashboardTopbar';
import StatCard from '@/components/StatCard';
import DashboardCharts from '@/components/DashboardCharts';
import { aggregateViewCountries, aggregateViewDevices, compactEarnings } from '@/lib/chart-data';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { sanitizeCountryCode } from '@/lib/geo';
import { resolveCreatorCpm } from '@/lib/cpm';
import { DollarSign, TrendingUp, Eye, Zap, Wallet, Clock, BarChart3, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // Earnings: today vs yesterday (real change %)
  const currentTime = new Date();
  const nowMs = currentTime.getTime();
  const todayStart = new Date(currentTime); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
  const todayIso = todayStart.toISOString();
  const yesterdayIso = yesterdayStart.toISOString();
  const priorWeekStart = new Date(nowMs - 14 * 86400_000).toISOString();
  const weekStart = new Date(nowMs - 7 * 86400_000).toISOString();
  const chartSince = new Date(nowMs - 30 * 86400_000).toISOString();

  // Every query below is independent, so they all run in one round-trip batch
  // instead of three sequential waves. The profile row is the request-scoped
  // one already loaded by the dashboard layout, so it is not fetched twice.
  // `chartEarnings`/`chartViews` feed the charts: the same two 30-day queries
  // DashboardCharts used to fire from the browser after hydration, moved here
  // so the charts paint without any client-side Supabase round-trip.
  const profilePromise = getDashboardProfile();
  const creatorCountry = sanitizeCountryCode((await profilePromise)?.country_code);
  const [
    profile,
    { data: todayEarnings },
    { data: yesterdayEarnings },
    { data: weekEarnings },
    { data: publicCpm },
    { data: countryCpmRow },
    { count: priorWeek },
    { count: currentWeek },
    { data: campaigns },
    { data: recent },
    { data: chartEarnings },
    { data: chartViews },
    unreadCount,
  ] = await Promise.all([
    profilePromise,
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', todayIso),
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', yesterdayIso).lt('created_at', todayIso),
    supabase.from('earnings').select('amount').eq('creator_id', user.id).gte('created_at', weekStart),
    // Live platform CPM (same source the earning engine uses).
    supabase.from('public_cpm').select('cpm').maybeSingle(),
    creatorCountry
      ? supabase.from('country_tiers').select('cpm_default, active').eq('country_code', creatorCountry).maybeSingle()
      : Promise.resolve({ data: null }),
    // Week view trend (real)
    supabase.from('views').select('id', { count: 'exact', head: true }).eq('creator_id', user.id).gte('created_at', priorWeekStart).lt('created_at', weekStart),
    supabase.from('views').select('id', { count: 'exact', head: true }).eq('creator_id', user.id).gte('created_at', weekStart),
    // Recent campaigns — only the columns this table renders.
    supabase
      .from('campaigns')
      .select('id, name, status, total_views, valid_views, total_earnings')
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
    // Recent activity (latest earnings) — only the columns this list renders.
    supabase
      .from('earnings')
      .select('id, amount, created_at, campaign:campaigns(name)')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6),
    // Chart inputs (30 days).
    supabase.from('earnings').select('amount, created_at').eq('creator_id', user.id).gte('created_at', chartSince),
    supabase.from('views').select('country_code, user_agent').eq('creator_id', user.id).gte('created_at', chartSince),
    getUnreadNotificationCount(user.id),
  ]);

  const todayTotal = todayEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const yesterdayTotal = yesterdayEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const weekTotal = weekEarnings?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;

  const todayChange = yesterdayTotal > 0 ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100 : 0;
  const todayChangeLabel = todayTotal === 0 && yesterdayTotal === 0
    ? 'No earnings yet'
    : `${todayChange >= 0 ? '+' : ''}${todayChange.toFixed(1)}% vs yesterday`;

  const validRate = profile?.total_views ? Math.round(((profile.valid_views || 0) / profile.total_views) * 100) : 0;

  const globalCpm = publicCpm?.cpm != null ? Number(publicCpm.cpm) : null;
  const resolvedCpm = resolveCreatorCpm(globalCpm ?? 0, countryCpmRow);
  const currentCpm = globalCpm != null || resolvedCpm.source === 'country' ? resolvedCpm.cpm : null;

  const viewTrend = priorWeek && priorWeek > 0 ? (((currentWeek ?? 0) - priorWeek) / priorWeek) * 100 : 0;

  return (
    <>
      <DashboardTopbar
        title="Dashboard"
        subtitle={`Welcome back, ${profile?.full_name || 'creator'}. Here's your overview.`}
        fullName={profile?.full_name ?? undefined}
        email={profile?.email}
        userId={user.id}
        unreadCount={unreadCount}
      />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Earnings" value={formatCurrency(profile?.total_earnings || 0)} change={`Week: ${formatCurrency(weekTotal)}`} icon={DollarSign} color="purple" />
          <StatCard label="Today's Earnings" value={formatCurrency(todayTotal)} change={todayChangeLabel} icon={TrendingUp} color="blue" />
          <StatCard label="Valid Views" value={formatNumber(profile?.valid_views || 0)} change={`${validRate}% valid rate`} icon={Eye} color="green" />
          <StatCard label="Current CPM" value={currentCpm != null ? `$${currentCpm.toFixed(2)}` : '—'} change="Per 1000 valid views" icon={Zap} color="pink" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Balance" value={formatCurrency(profile?.available_balance || 0)} change="Available" icon={Wallet} color="yellow" />
          <StatCard label="Pending" value={formatCurrency(profile?.pending_earnings || 0)} change="Holding period" icon={Clock} color="orange" />
          <StatCard label="Total Views" value={formatNumber(profile?.total_views || 0)} change={`${viewTrend >= 0 ? '+' : ''}${viewTrend.toFixed(1)}% this week`} icon={BarChart3} color="cyan" />
          <StatCard label="Referral Earnings" value={formatCurrency(profile?.referral_earnings || 0)} change="Lifetime" icon={Users} color="purple" />
        </div>

        {/*
          The country/device breakdowns are reduced here on the server instead
          of shipping 30 days of raw view rows into the RSC payload (that used
          to make this document ~982 KB and cost ~450 ms of main-thread parse).
          The aggregation code is the same; only where it runs changed.
          Earnings stay client-bucketed (local-timezone days) but travel as
          compact [amount, epochMs] tuples.
        */}
        <DashboardCharts
          level={profile?.level || 'bronze'}
          earningsRows={compactEarnings(chartEarnings)}
          country={aggregateViewCountries(chartViews)}
          devices={aggregateViewDevices(chartViews)}
        />

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Campaigns</h3>
            <Link href="/dashboard/campaigns" className="text-xs text-purple-400">View all →</Link>
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
                  <tr><td colSpan={5} className="py-6 text-center text-gray-500 text-sm">No campaigns yet. <Link href="/dashboard/create-campaign" className="text-purple-400">Create one →</Link></td></tr>
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
