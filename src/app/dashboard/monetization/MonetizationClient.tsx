'use client';

import Link from 'next/link';
import { Eye, CheckCircle2, Unlock, Route, DollarSign, TrendingUp, Globe, MonitorSmartphone } from 'lucide-react';
import StatCard from '@/components/StatCard';
import { Doughnut, Bar } from '@/components/charts/LazyChart';
import { formatCurrency, formatNumber, getCountryFlag } from '@/lib/utils';

type Summary = {
  taskStarts: number;
  taskCompletes: number;
  unlocks: number;
  flowStarts: number;
  stepCompletes: number;
  destinations: number;
  qualified: number;
  flowEarnings: number;
};

type CampaignRow = {
  campaign_id: string;
  campaign_name: string;
  slug: string;
  status: string;
  task_starts: number;
  task_completes: number;
  unlocks: number;
  flow_starts: number;
  step_completes: number;
  destinations: number;
  qualified: number;
  earnings: number;
};

type CountryRow = { country_code: string; events: number; qualified: number };
type DeviceRow = { device: string; events: number };

const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';
const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } },
    y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } },
  },
};

export default function MonetizationClient({
  summary,
  campaigns,
  countries,
  devices,
}: {
  summary: Summary;
  campaigns: CampaignRow[];
  countries: CountryRow[];
  devices: DeviceRow[];
}) {
  const completionRate = summary.flowStarts > 0 ? (summary.destinations / summary.flowStarts) * 100 : 0;
  const rpm = summary.qualified > 0 ? (summary.flowEarnings / summary.qualified) * 1000 : 0;
  const topGeo = [...countries].sort((a, b) => b.events - a.events)[0]?.country_code || '—';

  const countryChart = {
    labels: countries.map(c => c.country_code),
    datasets: [{
      data: countries.map(c => c.events),
      backgroundColor: ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#10b981', '#f59e0b'],
      borderWidth: 0,
    }],
  };

  const funnelChart = {
    labels: ['Clicks', 'Tasks done', 'Unlocks', 'Flow starts', 'Steps done', 'Destinations', 'Qualified'],
    datasets: [{
      data: [summary.taskStarts, summary.taskCompletes, summary.unlocks, summary.flowStarts, summary.stepCompletes, summary.destinations, summary.qualified],
      backgroundColor: '#8b5cf6',
      borderRadius: 6,
    }],
  };

  const deviceTotal = devices.reduce((s, d) => s + d.events, 0) || 1;
  const devicePct = (device: string) => Math.round(((devices.find(d => d.device === device)?.events ?? 0) / deviceTotal) * 100);

  return (
    <div className="mt-6 space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Qualified Views" value={formatNumber(summary.qualified)} change="Payout-eligible completions" icon={Eye} color="green" />
        <StatCard label="Estimated Earnings" value={formatCurrency(summary.flowEarnings)} change="From qualified flow views" icon={DollarSign} color="cyan" />
        <StatCard label="RPM" value={formatCurrency(rpm)} change="Per 1,000 qualified views" icon={TrendingUp} color="purple" />
        <StatCard label="Top GEO" value={topGeo} change="30 days" icon={Globe} color="blue" />
        <StatCard label="Completion Rate" value={`${completionRate.toFixed(1)}%`} change="Destinations ÷ flow starts" icon={CheckCircle2} color="pink" />
        <StatCard label="Flow Starts" value={formatNumber(summary.flowStarts)} change={`${formatNumber(summary.unlocks)} unlocks`} icon={Route} color="purple" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Your funnel</h3>
          <div className="h-56">
            <Bar
              data={funnelChart}
              options={{
                ...baseOpts,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (ctx: unknown) => `${formatNumber((ctx as { parsed: { y: number | null } }).parsed?.y ?? 0)} visitors` } },
                },
              }}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Globe className="w-4 h-4 text-purple-300" /> Top countries</h3>
            <div className="h-44">
              <Doughnut
                data={countryChart}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: 'right' as const, labels: { color: tickColor, font: { size: 10 }, boxWidth: 10 } } },
                }}
              />
            </div>
            {countries.length === 0 && <p className="text-xs text-gray-500 text-center mt-2">No flow traffic yet — share your unlock link to start.</p>}
          </div>
          <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-1.5"><MonitorSmartphone className="w-4 h-4 text-purple-300" /> Devices</h3>
            <div className="space-y-3">
              {(['mobile', 'desktop', 'tablet'] as const).map(device => (
                <div key={device}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400 capitalize">{device}</span>
                    <span className="text-gray-300">{devicePct(device)}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-cyan-400" style={{ width: `${devicePct(device)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 mt-4">Most short-link traffic is mobile — your unlock page and flow pages are mobile-first.</p>
          </div>
        </div>
      </div>

      {/* Link performance */}
      <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-1">Link Performance</h3>
        <p className="text-xs text-gray-500 mb-4">Every unlock link and its funnel — qualified views are the payout-eligible completions.</p>
        {campaigns.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-400 mb-3">No monetization data yet.</p>
            <Link href="/dashboard/create-campaign" className="btn-primary inline-flex px-5 py-2.5 rounded-xl text-sm">
              Create your first link
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2.5 pr-4 font-semibold">Link</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Clicks</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Tasks Completed</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Unlocks</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Shortener Starts</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Completed Flows</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Final Visits</th>
                  <th className="text-right py-2.5 pr-4 font-semibold">Qualified</th>
                  <th className="text-right py-2.5 font-semibold">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.campaign_id} className="border-b border-white/5">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'active' ? 'bg-green-400' : 'bg-gray-600'}`} />
                        <div className="min-w-0">
                          <div className="text-gray-200 font-medium truncate max-w-[180px]">{c.campaign_name}</div>
                          <div className="text-[10px] text-gray-600 truncate">/unlock/{c.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.task_starts)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.task_completes)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.unlocks)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.flow_starts)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.step_completes)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-300">{formatNumber(c.destinations)}</td>
                    <td className="py-2.5 pr-4 text-right text-green-300 font-semibold">{formatNumber(c.qualified)}</td>
                    <td className="py-2.5 text-right text-green-300 font-semibold">{formatCurrency(c.earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
