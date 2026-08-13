'use client';
import { useEffect, useState } from 'react';
import { localDayKey, daysAgoStart } from '@/lib/utils';
// Chart.js is loaded on demand (see components/charts/LazyChart) so the
// charting runtime stays out of the analytics page's first-load JavaScript.
import { Line, Bar } from '@/components/charts/LazyChart';

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

type ViewRow = { created_at: string; status: string };

/**
 * Rows arrive from the server component, which already queried this creator's
 * views for the surrounding period. Bucketing stays on the client because the
 * day/hour keys are computed in the visitor's local timezone.
 */
export default function AnalyticsCharts({ views }: { views: ViewRow[] }) {
  const [daily, setDaily] = useState<{ labels: string[]; valid: number[]; invalid: number[] }>({ labels: [], valid: [], invalid: [] });
  const [hourly, setHourly] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });

  useEffect(() => {
    const load = async () => {
      // Build daily (last 14 days, local timezone)
      const dayMap: Record<string, { valid: number; invalid: number }> = {};
      for (let i = 13; i >= 0; i--) {
        const d = localDayKey(daysAgoStart(i));
        dayMap[d] = { valid: 0, invalid: 0 };
      }
      (views || []).forEach((v: any) => {
        const d = localDayKey(v.created_at);
        if (dayMap[d]) {
          if (v.status === 'valid') dayMap[d].valid++;
          else if (v.status === 'invalid') dayMap[d].invalid++;
        }
      });
      const dayLabels = Object.keys(dayMap);
      setDaily({
        labels: dayLabels.map(d => d.substring(5)),
        valid: dayLabels.map(d => dayMap[d].valid),
        invalid: dayLabels.map(d => dayMap[d].invalid),
      });

      // Build hourly (last 24h)
      const hourMap: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourMap[h] = 0;
      (views || []).forEach((v: any) => {
        const h = new Date(v.created_at).getHours();
        hourMap[h] = (hourMap[h] || 0) + 1;
      });
      setHourly({
        labels: Object.keys(hourMap).map(h => `${h}h`),
        data: Object.values(hourMap),
      });
    };
    load();
  }, [views]);

  const trafficData = {
    labels: daily.labels,
    datasets: [
      { label: 'Valid', data: daily.valid, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
      { label: 'Invalid', data: daily.invalid, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4, borderWidth: 2 },
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