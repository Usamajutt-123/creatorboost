'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Copy, ExternalLink, Eye, DollarSign, TrendingUp, BarChart3, Users, Calendar, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import DashboardTopbar from '@/components/DashboardTopbar';
import StatCard from '@/components/StatCard';
import { formatNumber, formatCurrency, timeAgo, localDayKey, daysAgoStart } from '@/lib/utils';
import { toast } from 'sonner';

export default function CampaignStatsPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [campaign, setCampaign] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [views, setViews] = useState<any[]>([]);
    const [earnings, setEarnings] = useState<any[]>([]);

    useEffect(() => {
        const load = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { router.push('/login'); return; }

            const { data: c } = await supabase
                .from('campaigns')
                .select('*')
                .eq('id', params.id)
                .eq('creator_id', user.id)
                .single();

            if (!c) { toast.error('Campaign not found'); router.push('/dashboard/campaigns'); return; }
            setCampaign(c);

            const { data: v } = await supabase
                .from('views')
                .select('*')
                .eq('campaign_id', params.id)
                .order('created_at', { ascending: false })
                .limit(200);
            setViews(v || []);

            const { data: e } = await supabase
                .from('earnings')
                .select('*')
                .eq('campaign_id', params.id)
                .order('created_at', { ascending: false })
                .limit(50);
            setEarnings(e || []);

            setLoading(false);
        };
        load();
    }, [params.id, router]);

    const copyLink = () => {
        if (!campaign) return;
        const url = `${window.location.origin}/c/${campaign.slug}`;
        navigator.clipboard.writeText(url);
        toast.success('Link copied!');
    };

    if (loading) {
        return (
            <>
                <DashboardTopbar title="Campaign Statistics" />
                <div className="p-6 flex items-center justify-center min-h-[60vh]">
                    <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                </div>
            </>
        );
    }

    if (!campaign) return null;

    // Compute real stats
    const now = Date.now();
    const dayMs = 86400_000;
    const today = views.filter(v => new Date(v.created_at).getTime() > now - dayMs);
    const week = views.filter(v => new Date(v.created_at).getTime() > now - 7 * dayMs);
    const month = views.filter(v => new Date(v.created_at).getTime() > now - 30 * dayMs);
    const validViews = views.filter(v => v.status === 'valid');
    // Note: without tracked destination clicks we cannot report a real CTR.
    // Show the validity rate (share of views that were valid) instead.
    const validityRate = views.length > 0 ? (validViews.length / views.length) * 100 : 0;

    // Group views by day (last 14 days, local timezone)
    const days: Record<string, { views: number; valid: number; earnings: number }> = {};
    for (let i = 13; i >= 0; i--) {
        const d = localDayKey(daysAgoStart(i));
        days[d] = { views: 0, valid: 0, earnings: 0 };
    }
    views.forEach(v => {
        const d = localDayKey(v.created_at);
        if (days[d]) {
            days[d].views += 1;
            if (v.status === 'valid') days[d].valid += 1;
            days[d].earnings += Number(v.earnings || 0);
        }
    });
    const maxDayViews = Math.max(1, ...Object.values(days).map(d => d.views));

    // Country breakdown
    const byCountry: Record<string, number> = {};
    views.forEach(v => {
        if (v.country_code) byCountry[v.country_code] = (byCountry[v.country_code] || 0) + 1;
    });
    const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxCountry = Math.max(1, ...topCountries.map(c => c[1]));

    return (
        <>
            <DashboardTopbar
                title={campaign.name}
                subtitle={`Campaign statistics Ā· created ${timeAgo(campaign.created_at)}`}
            />
            <div className="p-4 sm:p-6 space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/dashboard/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Link>
                    <Link href={`/dashboard/campaigns/${campaign.id}/edit`} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                        <Edit className="w-3.5 h-3.5" /> Edit
                    </Link>
                    <button onClick={copyLink} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                        <Copy className="w-3.5 h-3.5" /> Copy Link
                    </button>
                    <a href={`/c/${campaign.slug}`} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" /> Open Public Page
                    </a>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="Total Views"
                        value={formatNumber(campaign.total_views)}
                        change="All Time"
                        icon={Eye}
                        color="purple"
                    />
                    <StatCard label="Valid Views" value={formatNumber(campaign.valid_views)} change="Valid views" icon={Users} color="green" />
                    <StatCard label="Invalid Views" value={formatNumber(campaign.invalid_views)} change="Invalid views" icon={Eye} color="red" />
                    <StatCard label="Total Earnings" value={formatCurrency(campaign.total_earnings)} change="All time" icon={DollarSign} color="yellow" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Today" value={formatNumber(today.length)} change="Last 24h" icon={Calendar} color="blue" />
                    <StatCard label="This Week" value={formatNumber(week.length)} change="Last 7 days" icon={Calendar} color="cyan" />
                    <StatCard label="This Month" value={formatNumber(month.length)} change="Last 30 days" icon={Calendar} color="purple" />
                    <StatCard label="Valid Rate" value={`${validityRate.toFixed(1)}%`} change="Of all views" icon={TrendingUp} color="pink" />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Status" value={campaign.status} change="Current state" icon={BarChart3} color={campaign.status === 'active' ? 'green' : campaign.status === 'paused' ? 'yellow' : 'purple'} />
                    <StatCard label="Category" value={campaign.category?.replace(/_/g, ' ') || '—'} change="Type" icon={BarChart3} color="blue" />
                    <StatCard label="Avg CPM" value={validViews.length > 0 ? formatCurrency((Number(campaign.total_earnings) / validViews.length) * 1000) : '$0.00'} change="Per 1000 views" icon={DollarSign} color="yellow" />
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
                                            title={`${date}: ${data.views} views (${data.valid} valid) Ā· $${data.earnings.toFixed(4)}`}
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
                                {topCountries.map(([code, count]) => {
                                    const flag = String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
                                    return (
                                        <div key={code} className="flex items-center gap-2">
                                            <span className="text-lg w-7 text-center">{flag}</span>
                                            <span className="text-xs font-mono w-8 text-gray-400">{code}</span>
                                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500" style={{ width: `${(count / maxCountry) * 100}%` }} />
                                            </div>
                                            <span className="text-xs text-gray-300 w-12 text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Recent views */}
                    <div className="glass-strong rounded-2xl p-5">
                        <h3 className="font-semibold mb-1">Recent Views</h3>
                        <p className="text-xs text-gray-500 mb-4">Live from your campaign</p>
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {views.slice(0, 15).map(v => (
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
                            {!views.length && <p className="text-xs text-gray-500 text-center py-4">No views yet</p>}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}