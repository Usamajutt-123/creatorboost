import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Copy, ExternalLink, Eye, DollarSign, BarChart3, Users, Calendar, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import StatCard from '@/components/StatCard';
import { formatNumber, formatCurrency, timeAgo, localDayKey, daysAgoStart } from '@/lib/utils';
import CopyLinkButton from './CopyLinkButton';

export const dynamic = 'force-dynamic';

export default async function CampaignStatsPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('creator_id', user.id)
    .single();

  if (!campaign) notFound();

  // Server-side aggregation (never relies on the first N views).
  const [{ data: summary }, { data: dailyRows }, { data: countryRows }, { data: recentViews }] = await Promise.all([
    supabase.from('campaign_summary').select('*').eq('campaign_id', params.id).maybeSingle(),
    supabase.from('campaign_daily_stats').select('*').eq('campaign_id', params.id),
    supabase.from('campaign_country_stats').select('*').eq('campaign_id', params.id).order('views', { ascending: false }),
    supabase.from('views').select('id, status, country_code, is_vpn, created_at').eq('campaign_id', params.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const totalViews = Number(summary?.total_views ?? campaign.total_views ?? 0);
  const validViews = Number(summary?.valid_views ?? campaign.valid_views ?? 0);
  const invalidViews = Number(summary?.invalid_views ?? campaign.invalid_views ?? 0);
  const totalEarnings = Number(summary?.total_earnings ?? campaign.total_earnings ?? 0);
  const views24h = Number(summary?.views_24h ?? 0);
  const views7d = Number(summary?.views_7d ?? 0);
  const views30d = Number(summary?.views_30d ?? 0);
  const validityRate = totalViews > 0 ? (validViews / totalViews) * 100 : 0;

  // Daily buckets (last 14 days, local timezone)
  const days: Record<string, { views: number; valid: number; earnings: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = localDayKey(daysAgoStart(i));
    days[d] = { views: 0, valid: 0, earnings: 0 };
  }
  (dailyRows || []).forEach((r: any) => {
    const d = localDayKey(r.day);
    if (days[d]) {
      days[d].views += Number(r.views) || 0;
      days[d].valid += Number(r.valid) || 0;
      days[d].earnings += Number(r.earnings) || 0;
    }
  });
  const maxDayViews = Math.max(1, ...Object.values(days).map(d => d.views));

  const topCountries = (countryRows || []).slice(0, 8);
  const maxCountry = Math.max(1, ...topCountries.map((c: any) => Number(c.views) || 0));

  return (
    <>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <Link href={`/dashboard/campaigns/${campaign.id}/edit`} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
            <Edit className="w-3.5 h-3.5" /> Edit
          </Link>
          <CopyLinkButton slug={campaign.slug} />
          <a href={`/c/${campaign.slug}`} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Open Public Page
          </a>
        </div>

        <div>
          <h1 className="font-display text-2xl font-bold">{campaign.name}</h1>
          <p className="text-sm text-gray-500">Campaign statistics · created {timeAgo(campaign.created_at)}</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Views" value={formatNumber(totalViews)} change="All time" icon={Eye} color="purple" />
          <StatCard label="Valid Views" value={formatNumber(validViews)} change="Valid views" icon={Users} color="green" />
          <StatCard label="Invalid Views" value={formatNumber(invalidViews)} change="Invalid views" icon={Eye} color="red" />
          <StatCard label="Total Earnings" value={formatCurrency(totalEarnings)} change="All time" icon={DollarSign} color="yellow" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Today" value={formatNumber(views24h)} change="Last 24h" icon={Calendar} color="blue" />
          <StatCard label="This Week" value={formatNumber(views7d)} change="Last 7 days" icon={Calendar} color="cyan" />
          <StatCard label="This Month" value={formatNumber(views30d)} change="Last 30 days" icon={Calendar} color="purple" />
          <StatCard label="Valid Rate" value={`${validityRate.toFixed(1)}%`} change="Of all views" icon={BarChart3} color="pink" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Status" value={campaign.status} change="Current state" icon={BarChart3} color={campaign.status === 'active' ? 'green' : campaign.status === 'paused' ? 'yellow' : 'purple'} />
          <StatCard label="Category" value={campaign.category?.replace(/_/g, ' ') || '—'} change="Type" icon={BarChart3} color="blue" />
          <StatCard label="Avg CPM" value={validViews > 0 ? formatCurrency((totalEarnings / validViews) * 1000) : '$0.00'} change="Per 1000 views" icon={DollarSign} color="yellow" />
          <StatCard label="Tasks" value={String((campaign.tasks || []).length)} change="Required actions" icon={BarChart3} color="purple" />
        </div>

        {/* Daily views chart */}
        <div className="glass-strong rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Daily Views (last 14 days)</h3>
          <p className="text-xs text-gray-500 mb-4">Real data from your campaign</p>
          <div className="flex items-end gap-1.5 h-40 sm:h-48">
            {Object.entries(days).map(([date, data]) => {
              const heightPct = (data.views / maxDayViews) * 100;
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
                  <div className="relative w-full flex flex-col justify-end h-full">
                    <div
                      className="w-full bg-gradient-to-t from-purple-500 to-blue-500 rounded-t-md transition-all hover:opacity-80"
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                      title={`${date}: ${data.views} views (${data.valid} valid) · $${data.earnings.toFixed(4)}`}
                    />
                  </div>
                  <div className="text-[9px] text-gray-500 truncate w-full text-center">{date.substring(5)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Country breakdown */}
          <div className="glass-strong rounded-2xl p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Globe className="w-4 h-4" /> Top Countries</h3>
            <p className="text-xs text-gray-500 mb-4">Real visitor locations</p>
            {topCountries.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No country data yet</p>
            ) : (
              <div className="space-y-2.5">
                {topCountries.map((c: any) => {
                  const code = c.country_code || '??';
                  const flag = /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...code.split('').map((ch: string) => 127397 + ch.charCodeAt(0))) : '🌐';
                  return (
                    <div key={code} className="flex items-center gap-2">
                      <span className="text-lg w-7 text-center">{flag}</span>
                      <span className="text-xs font-mono w-8 text-gray-400">{code}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500" style={{ width: `${(Number(c.views) / maxCountry) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-300 w-12 text-right">{Number(c.views)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent views */}
          <div className="glass-strong rounded-2xl p-5">
            <h3 className="font-semibold mb-1">Recent Views</h3>
            <p className="text-xs text-gray-500 mb-4">Latest 20 recorded views</p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(recentViews || []).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between gap-2 p-2.5 glass rounded-lg text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${v.status === 'valid' ? 'bg-green-400' : v.status === 'invalid' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                    <span className="font-mono text-gray-400 truncate">{v.country_code || '??'}</span>
                    {v.is_vpn && <span className="text-[9px] text-orange-400">VPN</span>}
                  </div>
                  <span className={`badge status-${v.status === 'valid' ? 'active' : v.status === 'invalid' ? 'rejected' : 'pending'}`}>{v.status}</span>
                  <span className="text-gray-500 flex-shrink-0">{timeAgo(v.created_at)}</span>
                </div>
              ))}
              {!recentViews?.length && <p className="text-xs text-gray-500 text-center py-4">No views yet</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
