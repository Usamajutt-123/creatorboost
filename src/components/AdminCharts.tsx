'use client';
import { useState } from 'react';
import { countryFlagLabel, type ChartSeries, type CompactEarning } from '@/lib/chart-data';
// Chart.js is loaded on demand (see components/charts/LazyChart) so the
// charting runtime stays out of the admin dashboard's first-load JavaScript.
import { Line, Doughnut, Bar } from '@/components/charts/LazyChart';

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

const COUNTRY_COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#f59e0b', '#10b981'];

/** Only the two fields the local-month revenue bucketing actually reads. */
export type CompactRevenue = [revenueDate: string, revenue: number];

/**
 * All chart data arrives from the server component that rendered the admin
 * dashboard: the same bounded window queries the charts used to fire from the
 * browser (earnings 7d, revenue ledger ≥ first day of the 6-month window,
 * views 7d, creator signups) are fetched once on the server, alongside the
 * stat-card queries.
 *
 * Aggregations that do not depend on the viewer's timezone — the top-8 country
 * breakdown and the per-network revenue split — are now performed on the server
 * (see `lib/chart-data`), so only the resulting numbers are serialised into the
 * RSC payload instead of every raw view/revenue row. The per-local-month
 * buckets (revenue vs payouts, cumulative growth) still run here because their
 * keys depend on the viewer's local calendar; their inputs travel in compact
 * tuple form. The aggregation math itself is unchanged.
 */
export default function AdminCharts({
  earningsRows,
  revenueRows,
  hasRevenue,
  netDist,
  topCountries,
  creatorRows,
}: {
  /** Compact `[amount, epochMs]` tuples — bucketed per *local* month below. */
  earningsRows: CompactEarning[];
  /** Compact `[revenue_date, revenue]` tuples — bucketed per *local* month. */
  revenueRows: CompactRevenue[];
  /** Whether the revenue ledger has any rows at all (was `revenueRows.length > 0`). */
  hasRevenue: boolean;
  /** Server-aggregated per-network recorded revenue (top 6). */
  netDist: ChartSeries;
  /** Server-aggregated top-8 country view counts (labels already flagged). */
  topCountries: ChartSeries;
  /** Creator signup timestamps as epoch ms — bucketed per *local* month. */
  creatorRows: number[];
}) {
  const [monthly] = useState<{ labels: string[]; revenue: number[]; payouts: number[] }>(() => {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthNow = new Date();
    const monthMap: Record<string, { rev: number; pay: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(monthNow.getFullYear(), monthNow.getMonth() - i, 1);
      const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      monthMap[key] = { rev: 0, pay: 0 };
    }
    revenueRows.forEach(([revenueDate, revenue]) => {
      const d = new Date(revenueDate + 'T00:00:00Z');
      const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      if (monthMap[key]) monthMap[key].rev += Number(revenue) || 0;
    });
    earningsRows.forEach(([amount, at]) => {
      const d = new Date(at);
      const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      if (monthMap[key]) monthMap[key].pay += amount;
    });
    const monthKeys = Object.keys(monthMap);
    return {
      labels: monthKeys,
      revenue: monthKeys.map(k => Math.round((monthMap[k].rev + Number.EPSILON) * 100) / 100),
      payouts: monthKeys.map(k => Math.round((monthMap[k].pay + Number.EPSILON) * 100) / 100),
    };
  });

  const [growth] = useState<{ labels: string[]; data: number[] }>(() => {
    // Growth: cumulative creators over last 6 months (real)
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthNow = new Date();
    const growthMap: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(monthNow.getFullYear(), monthNow.getMonth() - i, 1);
      growthMap[monthNames[d.getMonth()]] = 0;
    }
    creatorRows.forEach((at) => {
      const d = new Date(at);
      const key = monthNames[d.getMonth()];
      if (growthMap[key] !== undefined) growthMap[key]++;
    });
    const gKeys = Object.keys(growthMap);
    let cum = 0;
    const cumulative = gKeys.map(k => { cum += growthMap[k]; return cum; });
    return { labels: gKeys, data: cumulative };
  });

  const revenueData = {
    labels: monthly.labels,
    datasets: [
      { label: 'Recorded revenue', data: monthly.revenue, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
      { label: 'Creator payouts', data: monthly.payouts, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
    ],
  };

  const netData = {
    labels: netDist.labels,
    datasets: [{ data: netDist.data, backgroundColor: ['#8b5cf6', '#3b82f6', '#10b981', '#ec4899', '#f59e0b', '#06b6d4'].slice(0, netDist.data.length), borderColor: '#0a0716', borderWidth: 3 }],
  };

  const countryData = {
    labels: topCountries.labels.map(countryFlagLabel),
    datasets: [{
      data: topCountries.data,
      backgroundColor: COUNTRY_COLORS.slice(0, topCountries.data.length),
      borderRadius: 6,
    }],
  };

  const growthData = {
    labels: growth.labels,
    datasets: [{
      label: 'Creators',
      data: growth.data,
      borderColor: '#a78bfa',
      backgroundColor: 'rgba(167,139,250,0.2)',
      fill: true, tension: 0.4, borderWidth: 2,
    }],
  };

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Recorded Revenue vs Payouts</h3>
          <p className="text-xs text-gray-500 mb-4">
            {hasRevenue
              ? 'Last 6 months · from the revenue ledger (real/manual imports, never estimated)'
              : 'Revenue integration not configured — no revenue ledger entries yet'}
          </p>
          <div className="h-64 sm:h-72">
            {hasRevenue ? (
              <Line data={revenueData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: tickColor, font: fontOpts, usePointStyle: true } } },
                scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts, callback: (v: any) => '$' + v }, beginAtZero: true } },
              }} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">
                No revenue data — connect an ad-network provider or import a manual payout report.
              </div>
            )}
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Revenue by Network</h3>
          <p className="text-xs text-gray-500 mb-4">Recorded revenue only</p>
          <div className="h-64 sm:h-72">
            {netDist.data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No revenue recorded</div>
            ) : (
              <Doughnut data={netData} options={{
                responsive: true, maintainAspectRatio: false, cutout: '70%',
                plugins: { legend: { position: 'bottom' as const, labels: { color: tickColor, font: fontOpts, padding: 12, usePointStyle: true } } },
              }} />
            )}
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Traffic by Country (7d)</h3>
          <p className="text-xs text-gray-500 mb-4">Real visitor data</p>
          <div className="h-64 sm:h-72">
            {topCountries.data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No traffic yet</div>
            ) : (
              <Bar data={countryData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts }, beginAtZero: true } },
              }} />
            )}
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Platform Growth</h3>
          <p className="text-xs text-gray-500 mb-4">Cumulative creator signups</p>
          <div className="h-64 sm:h-72">
            <Line data={growthData} options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts }, beginAtZero: true } },
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
