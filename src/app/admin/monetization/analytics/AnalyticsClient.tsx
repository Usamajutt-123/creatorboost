'use client';

import { Bar } from '@/components/charts/LazyChart';
import { formatCurrency, formatNumber, getCountryFlag } from '@/lib/utils';

type FunnelRow = { stage: string; count: number };
type StepRow = { step: number; started: number; completed: number };
type DailyRow = { day: string; flow_starts: number; destinations: number; qualified: number; creator_payout: number; gross_revenue: number };
type CountryRow = { country_code: string; events: number; qualified: number };
type DeviceRow = { device: string; events: number };
type RevenueRow = { id: number; revenue_date: string; network: string; impressions: number; clicks: number; revenue: number; source: string };

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

export default function AnalyticsClient({
  funnel,
  stepStats,
  daily,
  countries,
  devices,
  revenue,
}: {
  funnel: FunnelRow[];
  stepStats: StepRow[];
  daily: DailyRow[];
  countries: CountryRow[];
  devices: DeviceRow[];
  revenue: RevenueRow[];
}) {
  // ---- Aggregates --------------------------------------------------------
  const flowStarts = funnel.find(f => f.stage === 'flow_start')?.count ?? 0;
  const destinations = funnel.find(f => f.stage === 'destination_visit')?.count ?? 0;
  const qualified = funnel.find(f => f.stage === 'qualified')?.count ?? 0;
  const stepCompletes = funnel.find(f => f.stage === 'step_complete')?.count ?? 0;

  const completionRate = flowStarts > 0 ? (destinations / flowStarts) * 100 : 0;
  const qualifiedRate = flowStarts > 0 ? (qualified / flowStarts) * 100 : 0;
  const avgSteps = flowStarts > 0 ? stepCompletes / flowStarts : 0;

  const totalPayout = daily.reduce((s, d) => s + Number(d.creator_payout) || 0, 0);
  const totalGross = revenue.reduce((s, r) => s + Number(r.revenue) || 0, 0);
  const byNetwork = new Map<string, number>();
  for (const r of revenue) byNetwork.set(r.network, (byNetwork.get(r.network) || 0) + Number(r.revenue) || 0);
  const adsterraRevenue = byNetwork.get('adsterra') || 0;
  const monetagRevenue = byNetwork.get('monetag') || 0;
  const otherRevenue = byNetwork.get('other') || 0;
  const platformGross = Math.max(0, totalGross - totalPayout);
  const platformMargin = totalGross > 0 ? (platformGross / totalGross) * 100 : 0;
  const revenuePerThousand = qualified > 0 ? (totalGross / qualified) * 1000 : 0;

  // ---- Funnel chart with dropoff ----------------------------------------
  const funnelChart = {
    labels: funnel.map(f => FUNNEL_LABELS[f.stage] || f.stage),
    datasets: [{
      data: funnel.map(f => f.count),
      backgroundColor: funnel.map(f => (f.stage === 'qualified' ? '#34d399' : '#8b5cf6')),
      borderRadius: 6,
    }],
  };

  // ---- Step dropoff -------------------------------------------------------
  const maxSteps = Math.max(1, stepStats.length);
  const stepLabels = Array.from({ length: maxSteps }, (_, i) => `Step ${i + 1}`);
  const stepChart = {
    labels: stepLabels,
    datasets: [
      { label: 'Started', data: stepLabels.map((_, i) => stepStats.find(s => s.step === i + 1)?.started ?? 0), backgroundColor: '#6366f1', borderRadius: 6 },
      { label: 'Completed', data: stepLabels.map((_, i) => stepStats.find(s => s.step === i + 1)?.completed ?? 0), backgroundColor: '#22d3ee', borderRadius: 6 },
    ],
  };

  const deviceTotal = devices.reduce((s, d) => s + d.events, 0) || 1;
  const devicePct = (device: string) => Math.round(((devices.find(d => d.device === device)?.events ?? 0) / deviceTotal) * 100);

  const countryEventsTotal = countries.reduce((s, c) => s + c.events, 0) || 1;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">Total Traffic (30d)</div>
          <div className="text-xl font-bold text-white">{formatNumber(flowStarts)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Flow starts</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">Qualified Traffic</div>
          <div className="text-xl font-bold text-white">{formatNumber(qualified)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{qualifiedRate.toFixed(1)}% of flow starts</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">Completion Rate</div>
          <div className="text-xl font-bold text-white">{completionRate.toFixed(1)}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{avgSteps.toFixed(1)} avg steps completed</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">Revenue / 1,000 Qualified</div>
          <div className="text-xl font-bold text-white">{formatCurrency(revenuePerThousand)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Gross ÷ qualified views</div>
        </div>
      </div>

      {/* Funnel */}
      <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-1">Funnel — where visitors leave</h3>
        <p className="text-xs text-gray-500 mb-3">Link click → tasks → unlock → each shortener step → destination.</p>
        <div className="h-64">
          <Bar
            data={funnelChart}
            options={{
              ...baseOpts,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx: unknown) => `${formatNumber((ctx as { parsed: { y: number | null } }).parsed?.y ?? 0)} visitors`,
                  },
                },
              },
            }}
          />
        </div>
      </div>

      {/* Step dropoff */}
      <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-1">Step-by-step dropoff</h3>
        <p className="text-xs text-gray-500 mb-3">Started vs completed per shortener step — identifies the page visitors leave from.</p>
        <div className="h-56">
          <Bar
            data={stepChart}
            options={{
              ...baseOpts,
              plugins: { legend: { position: 'top' as const, labels: { color: tickColor, font: { size: 10 }, boxWidth: 10 } } },
            }}
          />
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-2 pr-4 font-semibold">Step</th>
                <th className="text-right py-2 pr-4 font-semibold">Started</th>
                <th className="text-right py-2 pr-4 font-semibold">Completed</th>
                <th className="text-right py-2 font-semibold">Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {stepLabels.map((label, i) => {
                const row = stepStats.find(s => s.step === i + 1);
                const started = row?.started ?? 0;
                const completed = row?.completed ?? 0;
                const drop = started > 0 ? Math.max(0, ((started - completed) / started) * 100) : 0;
                return (
                  <tr key={label} className="border-b border-white/5">
                    <td className="py-2 pr-4 text-gray-300">{label}</td>
                    <td className="py-2 pr-4 text-right text-gray-300">{formatNumber(started)}</td>
                    <td className="py-2 pr-4 text-right text-gray-300">{formatNumber(completed)}</td>
                    <td className="py-2 text-right text-gray-400">{drop.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Countries + devices */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Country breakdown — 30 days</h3>
          <div className="space-y-2">
            {countries.length === 0 && <p className="text-xs text-gray-500 py-6 text-center">No traffic yet.</p>}
            {countries.map(c => (
              <div key={c.country_code} className="flex items-center gap-3">
                <span className="text-base w-7 text-center flex-shrink-0">{getCountryFlag(c.country_code)}</span>
                <span className="text-xs text-gray-300 flex-1">{c.country_code}</span>
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500" style={{ width: `${(c.events / countryEventsTotal) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-16 text-right whitespace-nowrap">{formatNumber(c.events)}</span>
                <span className="text-xs text-green-300 w-14 text-right whitespace-nowrap">{formatNumber(c.qualified)} Q</span>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">Device breakdown — 30 days</h3>
          <div className="grid grid-cols-3 gap-3">
            {(['mobile', 'desktop', 'tablet'] as const).map(device => {
              const count = devices.find(d => d.device === device)?.events ?? 0;
              return (
                <div key={device} className="glass rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-white">{devicePct(device)}%</div>
                  <div className="text-xs text-gray-400 mt-1 capitalize">{device}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{formatNumber(count)} events</div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-600 mt-3">Most short-link traffic is mobile — the flow pages are mobile-first and ads never overlap the Continue button.</p>
        </div>
      </div>

      {/* Revenue breakdown */}
      <div className="glass-strong rounded-2xl p-4 sm:p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-1">Revenue breakdown</h3>
        <p className="text-xs text-gray-500 mb-4">
          Gross ad revenue comes from the revenue ledger (manual entries are labeled MANUAL until a provider API is connected).
          Creator payout comes from the earnings ledger. Nothing is estimated.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Adsterra Revenue</div>
            <div className="text-lg font-bold text-white">{formatCurrency(adsterraRevenue)}</div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-1">Manual data</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Monetag Revenue</div>
            <div className="text-lg font-bold text-white">{formatCurrency(monetagRevenue)}</div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-1">Manual data</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Other Revenue</div>
            <div className="text-lg font-bold text-white">{formatCurrency(otherRevenue)}</div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-1">Manual data</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Total Gross Revenue</div>
            <div className="text-lg font-bold text-white">{formatCurrency(totalGross)}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Creator Payouts (30d)</div>
            <div className="text-lg font-bold text-green-300">{formatCurrency(totalPayout)}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Platform Gross / Margin</div>
            <div className="text-lg font-bold text-white">{formatCurrency(platformGross)}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{platformMargin.toFixed(1)}% margin on gross</div>
          </div>
        </div>
      </div>
    </div>
  );
}
