'use client';
import { useState } from 'react';
// Chart.js is loaded on demand (see components/charts/LazyChart) so the
// charting runtime stays out of the admin dashboard's first-load JavaScript.
import { Line, Doughnut, Bar } from '@/components/charts/LazyChart';

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

const COUNTRY_COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#f59e0b', '#10b981'];

type RevRow = {
  revenue_date: string;
  network: string;
  revenue: number;
  source: string;
};

/**
 * All chart data arrives from the server component that rendered the admin
 * dashboard: the same bounded window queries the charts used to fire from the
 * browser (earnings 7d, revenue ledger ≥ first day of the 6-month window,
 * views 7d, creator signups) are fetched once on the server, alongside the
 * stat-card queries, and passed down as props. The aggregation math below is
 * unchanged.
 */
export default function AdminCharts({
  earningsRows,
  revenueRows,
  viewRows,
  creatorRows,
}: {
  earningsRows: Array<{ amount: number | string | null; created_at: string }>;
  revenueRows: RevRow[];
  viewRows: Array<{ country_code: string | null; created_at: string }>;
  creatorRows: Array<{ created_at: string }>;
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
    revenueRows.forEach((r) => {
      const d = new Date(r.revenue_date + 'T00:00:00Z');
      const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      if (monthMap[key]) monthMap[key].rev += Number(r.revenue) || 0;
    });
    earningsRows.forEach((e) => {
      const d = new Date(e.created_at);
      const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      if (monthMap[key]) monthMap[key].pay += Number(e.amount);
    });
    const monthKeys = Object.keys(monthMap);
    return {
      labels: monthKeys,
      revenue: monthKeys.map(k => Math.round((monthMap[k].rev + Number.EPSILON) * 100) / 100),
      payouts: monthKeys.map(k => Math.round((monthMap[k].pay + Number.EPSILON) * 100) / 100),
    };
  });

  const [netDist] = useState<{ labels: string[]; data: number[] }>(() => {
    // Network distribution by RECORDED revenue (not weights, not guesses)
    const netMap: Record<string, number> = {};
    revenueRows.forEach(r => { netMap[r.network] = (netMap[r.network] || 0) + Number(r.revenue) || 0; });
    const nets = Object.entries(netMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { labels: nets.map(([n]) => n), data: nets.map(([, v]) => Math.round(v * 100) / 100) };
  });

  const [topCountries] = useState<{ labels: string[]; data: number[] }>(() => {
    // Top countries from views (7d, real)
    const cMap: Record<string, number> = {};
    viewRows.forEach((v) => {
      const c = v.country_code || 'XX';
      cMap[c] = (cMap[c] || 0) + 1;
    });
    const topC = Object.entries(cMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      labels: topC.map(([c]) => {
        const flag = String.fromCodePoint(...c.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
        return `${flag} ${c}`;
      }),
      data: topC.map(([, n]) => n),
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
    creatorRows.forEach((c) => {
      const d = new Date(c.created_at);
      const key = monthNames[d.getMonth()];
      if (growthMap[key] !== undefined) growthMap[key]++;
    });
    const gKeys = Object.keys(growthMap);
    let cum = 0;
    const cumulative = gKeys.map(k => { cum += growthMap[k]; return cum; });
    return { labels: gKeys, data: cumulative };
  });

  const hasRevenue = revenueRows.length > 0;

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
    labels: topCountries.labels,
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
