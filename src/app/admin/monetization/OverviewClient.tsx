'use client';

import { Eye, CheckCircle2, DollarSign, HandCoins, TrendingUp, Percent, Route } from 'lucide-react';
import StatCard from '@/components/StatCard';
import { Bar, Line, Doughnut } from '@/components/charts/LazyChart';
import { formatCurrency, formatNumber } from '@/lib/utils';

type OverviewData = Record<string, unknown> | null;
type FunnelRow = { stage: string; count: number };
type DailyRow = { day: string; flow_starts: number; destinations: number; qualified: number; creator_payout: number; gross_revenue: number };
type CountryRow = { country_code: string; events: number; qualified: number };
type CreatorRow = { creator_id: string; username: string; qualified: number; payout: number };
type CampaignRow = { campaign_id: string; campaign_name: string; slug: string; qualified: number; payout: number };

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

const FUNNEL_LABELS: Record<string, string> = {
  task_start: 'Link clicks',
  task_complete: 'Tasks completed',
  unlock: 'Unlocks',
  flow_start: 'Flow starts',
  step_start: 'Step views',
  step_complete: 'Steps completed',
  destination_visit: 'Destination visits',
  qualified: 'Qualified views',
};

function section(sectionKey: string, overview: OverviewData): Record<string, number> {
  // Every key the UI reads is defaulted to 0, so a missing/partial overview
  // (fresh database, failed RPC, un-migrated schema) can never crash the
  // page through an undefined number.
  const out: Record<string, number> = {
    flowStarts: 0,
    destinations: 0,
    qualified: 0,
    creatorPayout: 0,
    grossRevenue: 0,
    stepsCompleted: 0,
  };
  const value = overview?.[sectionKey];
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

export default function OverviewClient({
  overview,
  funnel,
  daily,
  countries,
  topCreators,
  topCampaigns,
  schemaMissing,
}: {
  overview: OverviewData;
  funnel: FunnelRow[];
  daily: DailyRow[];
  countries: CountryRow[];
  topCreators: CreatorRow[];
  topCampaigns: CampaignRow[];
  /** True when the analytics RPCs are unavailable (schema not migrated). */
  schemaMissing?: boolean;
}) {
  const today = section('today', overview);
  const d7 = section('d7', overview);
  const d30 = section('d30', overview);
  const completionRate = Number(overview?.completionRate ?? 0);

  const todayPlatform = Math.max(0, today.grossRevenue - today.creatorPayout);
  const d7Platform = Math.max(0, d7.grossRevenue - d7.creatorPayout);
  const d30Platform = Math.max(0, d30.grossRevenue - d30.creatorPayout);

  const funnelChart = {
    labels: funnel.map(f => FUNNEL_LABELS[f.stage] || f.stage),
    datasets: [{
      data: funnel.map(f => f.count),
      backgroundColor: ['#8b5cf6', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#22d3ee', '#10b981', '#34d399'],
      borderRadius: 6,
    }],
  };

  const dailyLabels = daily.map(d => String(d.day).slice(5));
  const revenueChart = {
    labels: dailyLabels,
    datasets: [
      {
        label: 'Gross revenue',
        data: daily.map(d => d.gross_revenue),
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167,139,250,0.12)',
        fill: true,
        tension: 0.35,
      },
      {
        label: 'Creator payout',
        data: daily.map(d => d.creator_payout),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34,211,238,0.08)',
        fill: true,
        tension: 0.35,
      },
    ],
  };

  const countryChart = {
    labels: countries.map(c => c.country_code),
    datasets: [{
      data: countries.map(c => c.events),
      backgroundColor: ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#10b981', '#f59e0b'],
      borderWidth: 0,
    }],
  };

  return (
    <div>
      {schemaMissing && (
        <div className="mb-5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 leading-relaxed">
          <strong className="font-semibold">Monetization analytics unavailable.</strong> The database schema for this section
          is missing — apply <code className="text-amber-300">supabase/migrations/0022_monetization_flow.sql</code> (and the
          following migrations) to your Supabase project, then reload. Until then this page shows zeros and never affects
          the live unlock flow.
        </div>
      )}

      {/* Today's numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Today's Views" value={formatNumber(today.flowStarts)} change={`${formatNumber(today.destinations)} reached destination`} icon={Eye} color="purple" />
        <StatCard label="Qualified Views" value={formatNumber(today.qualified)} change="Flow completions" icon={CheckCircle2} color="green" />
        <StatCard label="Today's Revenue" value={formatCurrency(today.grossRevenue)} change="Manual ad revenue ledger" icon={DollarSign} color="cyan" />
        <StatCard label="Creator Payout" value={formatCurrency(today.creatorPayout)} change="Qualified flow earnings" icon={HandCoins} color="blue" />
        <StatCard label="Platform Revenue" value={formatCurrency(todayPlatform)} change="Gross − creator payout" icon={TrendingUp} color="pink" />
      </div>

      {/* Period totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">7-Day Revenue</div>
          <div className="text-xl font-bold text-white">{formatCurrency(d7.grossRevenue)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Payout {formatCurrency(d7.creatorPayout)} · Platform {formatCurrency(d7Platform)}</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">30-Day Revenue</div>
          <div className="text-xl font-bold text-white">{formatCurrency(d30.grossRevenue)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Payout {formatCurrency(d30.creatorPayout)} · Platform {formatCurrency(d30Platform)}</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Percent className="w-3.5 h-3.5" /> Completion Rate (30d)</div>
          <div className="text-xl font-bold text-white">{completionRate.toFixed(1)}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{formatNumber(d30.destinations)} of {formatNumber(d30.flowStarts)} flow starts</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Route className="w-3.5 h-3.5" /> Avg Steps Completed (30d)</div>
          <div className="text-xl font-bold text-white">
            {d30.flowStarts > 0 ? (d30.stepsCompleted / d30.flowStarts).toFixed(1) : '0.0'}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Per started flow</div>
        </div>
      </div>

      {/* Revenue + funnel charts */}
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Revenue — last 14 days</h3>
          <div className="h-56">
            <Line data={revenueChart} options={baseOpts} />
          </div>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Conversion funnel — last 30 days</h3>
          <div className="h-56">
            <Bar
              data={funnelChart}
              options={{
                ...baseOpts,
                indexAxis: 'y' as const,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx: unknown) => `${formatNumber((ctx as { parsed: { x: number | null } }).parsed?.x ?? 0)} visitors`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* Geo + leaders */}
      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Top GEOs — 7 days</h3>
          <div className="h-48">
            <Doughnut
              data={countryChart}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right' as const, labels: { color: tickColor, font: { size: 10 }, boxWidth: 10 } } },
              }}
            />
          </div>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Top Creators — 30 days</h3>
          {topCreators.length === 0 && <p className="text-xs text-gray-500 py-8 text-center">No flow traffic yet.</p>}
          <div className="space-y-2.5">
            {topCreators.map(c => (
              <div key={c.creator_id} className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {(c.username || '?')[0]?.toUpperCase()}
                </span>
                <span className="text-sm text-gray-300 truncate flex-1">{c.username}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{formatNumber(c.qualified)} qualified</span>
                <span className="text-xs font-semibold text-green-300 w-16 text-right">{formatCurrency(c.payout)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Top Links — 30 days</h3>
          {topCampaigns.length === 0 && <p className="text-xs text-gray-500 py-8 text-center">No flow traffic yet.</p>}
          <div className="space-y-2.5">
            {topCampaigns.map(c => (
              <div key={c.campaign_id} className="flex items-center gap-3">
                <span className="text-xs text-purple-300 truncate flex-1">{c.campaign_name}</span>
                <span className="text-[11px] text-gray-600 whitespace-nowrap">/unlock/{c.slug}</span>
                <span className="text-xs font-semibold text-green-300 w-16 text-right">{formatCurrency(c.payout)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}