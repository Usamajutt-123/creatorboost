import { createClient } from '@/lib/supabase/server';
import { getDashboardProfile, getSessionUser } from '@/lib/session';
import DashboardTopbar from '@/components/DashboardTopbar';
import StatCard from '@/components/StatCard';
import AnalyticsCharts from '@/components/AnalyticsCharts';
import { formatNumber, formatCurrency } from '@/lib/utils';
import { Eye, CheckCircle, XCircle, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // Last 30 days
  const nowMs = new Date().getTime();
  const since = new Date(nowMs - 30 * 86400_000).toISOString();

  // The profile row is the request-scoped one loaded by the dashboard layout,
  // and the views query no longer waits behind it.
  const [profile, { data: daily }] = await Promise.all([
    getDashboardProfile(),
    supabase
      .from('views')
      .select('created_at, status, country_code, earnings')
      .eq('creator_id', user.id)
      .gte('created_at', since),
  ]);

  // AnalyticsCharts only needs the last 14 days of (created_at, status), which
  // is a subset of the rows above. Passing it down removes a duplicate
  // client-side round-trip (auth.getUser + a second `views` query) that used to
  // re-download the same data after hydration.
  const chartSince = nowMs - 14 * 86400_000;
  const chartViews = (daily || [])
    .filter((v: any) => new Date(v.created_at).getTime() >= chartSince)
    .map((v: any) => ({ created_at: v.created_at as string, status: v.status as string }));

  // Country breakdown
  const countryMap = new Map<string, { total: number; valid: number; invalid: number; earned: number }>();
  daily?.forEach((v: any) => {
    const c = v.country_code || 'XX';
    const cur = countryMap.get(c) || { total: 0, valid: 0, invalid: 0, earned: 0 };
    cur.total++;
    if (v.status === 'valid') { cur.valid++; cur.earned += Number(v.earnings); }
    if (v.status === 'invalid') cur.invalid++;
    countryMap.set(c, cur);
  });

  const topCountries = Array.from(countryMap.entries())
    .sort((a, b) => b[1].valid - a[1].valid)
    .slice(0, 8);

  return (
    <>
      <DashboardTopbar title="Analytics" subtitle="Track your performance" />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Views" value={formatNumber(profile?.total_views || 0)} change="All time" icon={Eye} color="cyan" />
          <StatCard label="Valid Views" value={formatNumber(profile?.valid_views || 0)} change={`${Math.round(((profile?.valid_views || 0) / Math.max(profile?.total_views || 1, 1)) * 100)}% rate`} icon={CheckCircle} color="green" />
          <StatCard label="Invalid Views" value={formatNumber(profile?.invalid_views || 0)} change="Filtered" icon={XCircle} color="orange" />
          <StatCard label="Avg CPM" value={profile?.valid_views ? `$${((profile?.total_earnings || 0) / (profile?.valid_views / 1000)).toFixed(2)}` : '$0.00'} change="All time" icon={TrendingUp} color="blue" />
        </div>

        <AnalyticsCharts views={chartViews} />

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Top Countries Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">Country</th>
                  <th className="text-left py-2 font-medium">Views</th>
                  <th className="text-left py-2 font-medium">Valid</th>
                  <th className="text-left py-2 font-medium">Invalid</th>
                  <th className="text-left py-2 font-medium">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {topCountries.map(([code, stats]) => {
                  const flag = code.toUpperCase().split('').map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
                  return (
                    <tr key={code} className="border-b border-white/5 table-row">
                      <td className="py-3">{flag} {code}</td>
                      <td className="py-3">{formatNumber(stats.total)}</td>
                      <td className="py-3 text-green-400">{formatNumber(stats.valid)}</td>
                      <td className="py-3 text-red-400">{formatNumber(stats.invalid)}</td>
                      <td className="py-3 font-semibold">${stats.earned.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {!topCountries.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-gray-500 text-sm">No traffic data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}