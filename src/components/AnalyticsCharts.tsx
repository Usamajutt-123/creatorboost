'use client';
import { useMemo } from 'react';
import { localDayKey, daysAgoStart } from '@/lib/utils';
// Chart.js is loaded on demand (see components/charts/LazyChart) so the
// charting runtime stays out of the analytics page's first-load JavaScript.
import { Line, Bar } from '@/components/charts/LazyChart';

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

/**
 * Only earning-eligible views reach this component. The server component
 * filters `status = 'valid'` before rendering, so no anti-fraud outcome
 * (duplicate, bot, proxy, rate-limited) is ever plotted on a creator chart.
 */
type ViewRow = { created_at: string };

/**
 * Rows arrive from the server component, which already queried this creator's
 * views for the surrounding period. Bucketing stays on the client because the
 * day/hour keys are computed in the visitor's local timezone.
 *
 * The two buckets used to be built inside a mount `useEffect` that started from
 * empty state and then called `setDaily` **and** `setHourly` — so every load
 * rendered once with empty charts and then re-rendered twice more for data that
 * was already available synchronously in props. Deriving them with `useMemo`
 * produces the same values in a single render pass. The charts themselves are
 * still lazily mounted, so the rendered output is unchanged.
 */
export default function AnalyticsCharts({ views }: { views: ViewRow[] }) {
  const { daily, hourly } = useMemo(() => {
    // Build daily (last 14 days, local timezone)
    const dayMap: Record<string, { valid: number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = localDayKey(daysAgoStart(i));
      dayMap[d] = { valid: 0 };
    }
    (views || []).forEach((v: any) => {
      const d = localDayKey(v.created_at);
      if (dayMap[d]) dayMap[d].valid++;
    });
    const dayLabels = Object.keys(dayMap);

    // Build hourly (last 24h)
    const hourMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourMap[h] = 0;
    (views || []).forEach((v: any) => {
      const h = new Date(v.created_at).getHours();
      hourMap[h] = (hourMap[h] || 0) + 1;
    });

    return {
      daily: {
        labels: dayLabels.map(d => d.substring(5)),
        valid: dayLabels.map(d => dayMap[d].valid),
      },
      hourly: {
        labels: Object.keys(hourMap).map(h => `${h}h`),
        data: Object.values(hourMap),
      },
    };
  }, [views]);

  const trafficData = {
    labels: daily.labels,
    datasets: [
      { label: 'Valid Views', data: daily.valid, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
    ],
  };

  const hourlyData = {
    labels: hourly.labels,
    datasets: [{ label: 'Views', data: hourly.data, backgroundColor: (ctx: any) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, '#8b5cf6'); g.addColorStop(1, '#3b82f6'); return g; }, borderRadius: 4 }],
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold mb-1">Traffic Over Time</h3>
        <p className="text-xs text-gray-500 mb-4">Last 14 days · real data</p>
        <div className="h-64 sm:h-72">
          <Line data={trafficData} options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: tickColor, font: fontOpts, usePointStyle: true } } },
            scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts }, beginAtZero: true } },
          }} />
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold mb-1">Hourly Performance</h3>
        <p className="text-xs text-gray-500 mb-4">Last 24 hours · real data</p>
        <div className="h-64 sm:h-72">
          <Bar data={hourlyData} options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts }, beginAtZero: true } },
          }} />
        </div>
      </div>
    </div>
  );
}