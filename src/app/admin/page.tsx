import { createAdminClient } from '@/lib/supabase/server';
import StatCard from '@/components/StatCard';
import AdminCharts from '@/components/AdminCharts';
import { DollarSign, TrendingUp, Users, Megaphone, Clock, CheckCircle, Banknote, XCircle } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  const [
    { count: totalCreators },
    { count: activeCampaigns },
    { data: payouts },
    { data: adRevenue },
    { data: pendingW },
    { data: approvedW },
    { data: paidW },
    { data: rejectedW },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'creator'),
    supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('earnings').select('amount').eq('type', 'view_earning'),
    supabase.from('ad_networks').select('total_revenue, monthly_revenue'),
    supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('withdrawals').select('amount').eq('status', 'approved'),
    supabase.from('withdrawals').select('amount').eq('status', 'paid'),
    supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]);

  const totalPayouts = payouts?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const totalAdRev = adRevenue?.reduce((s, a) => s + Number(a.total_revenue), 0) ?? 0;
  const profit = totalAdRev - totalPayouts;
  const todayApproved = approvedW?.reduce((s, a) => s + Number(a.amount), 0) ?? 0;
  const todayPaid = paidW?.reduce((s, a) => s + Number(a.amount), 0) ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(totalAdRev)} change="Manual/estimated" icon={DollarSign} color="green" />
        <StatCard label="Platform Profit" value={formatCurrency(profit)} change="Est. after payouts" icon={TrendingUp} color="purple" />
        <StatCard label="Total Creators" value={formatNumber(totalCreators || 0)} change="All time" icon={Users} color="blue" />
        <StatCard label="Active Campaigns" value={formatNumber(activeCampaigns || 0)} change="Currently live" icon={Megaphone} color="pink" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Pending Withdraws" value={String(pendingW?.length || 0)} change="Need review" icon={Clock} color="yellow" />
        <StatCard label="Approved" value={String(approvedW?.length || 0)} change={`${formatCurrency(todayApproved)}`} icon={CheckCircle} color="blue" />
        <StatCard label="Paid" value={formatCurrency(todayPaid)} change="Total paid" icon={Banknote} color="green" />
        <StatCard label="Rejected" value={String(rejectedW?.length || 0)} change="All time" icon={XCircle} color="orange" />
      </div>

      <AdminCharts />
    </div>
  );
}
