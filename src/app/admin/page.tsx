import { createAdminClient } from '@/lib/supabase/server';
import StatCard from '@/components/StatCard';
import AdminCharts from '@/components/AdminCharts';
import { DollarSign, Users, Megaphone, Clock, CheckCircle, Banknote, XCircle } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  // Chart data windows — identical to what AdminCharts used to fetch from the
  // browser; fetching them here removes four post-hydration client round-trips.
  const monthWindowStart = new Date();
  const since = new Date(monthWindowStart.getTime() - 7 * 86400_000).toISOString();
  const revenueSince = new Date(Date.UTC(monthWindowStart.getFullYear(), monthWindowStart.getMonth() - 5, 1))
    .toISOString()
    .slice(0, 10);

  const [
    { count: totalCreators },
    { count: activeCampaigns },
    { data: payouts },
    { data: revenueImports },
    { count: pendingW },
    { data: approvedW },
    { data: paidW },
    { count: rejectedW },
    { data: chartEarnings },
    { data: chartRevenue },
    { data: chartViews },
    { data: chartCreators },
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'creator'),
    supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('earnings').select('amount').eq('type', 'view_earning'),
    supabase.from('ad_revenue_imports').select('revenue, source'),
    supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('withdrawals').select('amount').eq('status', 'approved'),
    supabase.from('withdrawals').select('amount').eq('status', 'paid'),
    supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    supabase.from('earnings').select('amount, created_at').eq('type', 'view_earning').gte('created_at', since),
    // The revenue chart only renders the last 6 calendar months; rows older
    // than that were downloaded and then thrown away, so the query is bounded
    // by the same window.
    supabase.from('ad_revenue_imports').select('revenue_date, network, revenue, source').gte('revenue_date', revenueSince).limit(2000),
    supabase.from('views').select('country_code, created_at').gte('created_at', since),
    supabase.from('profiles').select('created_at').eq('role', 'creator'),
  ]);

  const totalPayouts = payouts?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const recordedRevenue = revenueImports?.reduce((s, a) => s + Number(a.revenue), 0) ?? 0;
  const todayApproved = approvedW?.reduce((s, a) => s + Number(a.amount), 0) ?? 0;
  const todayPaid = paidW?.reduce((s, a) => s + Number(a.amount), 0) ?? 0;
  const revenueConfigured = (revenueImports?.length ?? 0) > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={revenueConfigured ? 'Recorded Revenue' : 'Recorded Revenue'} value={formatCurrency(recordedRevenue)} change={revenueConfigured ? 'From revenue ledger (real + manual)' : 'Revenue integration not configured'} icon={DollarSign} color="green" />
        <StatCard label="Creator Payouts" value={formatCurrency(totalPayouts)} change="All-time earnings ledger" icon={DollarSign} color="purple" />
        <StatCard label="Total Creators" value={formatNumber(totalCreators || 0)} change="All time" icon={Users} color="blue" />
        <StatCard label="Active Campaigns" value={formatNumber(activeCampaigns || 0)} change="Currently live" icon={Megaphone} color="pink" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Pending Withdraws" value={String(pendingW || 0)} change="Need review" icon={Clock} color="yellow" />
        <StatCard label="Approved" value={String(approvedW?.length || 0)} change={`${formatCurrency(todayApproved)} total`} icon={CheckCircle} color="blue" />
        <StatCard label="Paid" value={formatCurrency(todayPaid)} change="Total paid" icon={Banknote} color="green" />
        <StatCard label="Rejected" value={String(rejectedW || 0)} change="All time" icon={XCircle} color="orange" />
      </div>

      {!revenueConfigured && (
        <div className="glass rounded-2xl p-4 flex items-start gap-3 text-xs text-gray-300">
          <span>ℹ️</span>
          <p>
            <strong className="text-white">Revenue integration not configured.</strong> No ad-network provider is
            connected and no manual revenue has been imported. All revenue figures shown reflect the revenue ledger
            only — the platform never displays estimated or fabricated revenue as real.
          </p>
        </div>
      )}

      <AdminCharts
        earningsRows={(chartEarnings || []).map((e: any) => ({ amount: e.amount, created_at: e.created_at }))}
        revenueRows={(chartRevenue || []).map((r: any) => ({ revenue_date: r.revenue_date, network: r.network, revenue: r.revenue, source: r.source }))}
        viewRows={(chartViews || []).map((v: any) => ({ country_code: v.country_code, created_at: v.created_at }))}
        creatorRows={(chartCreators || []).map((c: any) => ({ created_at: c.created_at }))}
      />
    </div>
  );
}
