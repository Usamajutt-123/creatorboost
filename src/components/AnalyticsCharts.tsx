'use client';
import { useEffect, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler, Legend } from 'chart.js';
import { createClient } from '@/lib/supabase/client';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler, Legend);

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

export default function AnalyticsCharts() {
  const [daily, setDaily] = useState<{ labels: string[]; valid: number[]; invalid: number[] }>({ labels: [], valid: [], invalid: [] });
  const [hourly, setHourly] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const { data: views } = await supabase
        .from('views')
        .select('created_at, status')
        .eq('creator_id', user.id)
        .gte('created_at', since);

      // Build daily (last 14 days)
      const dayMap: Record<string, { valid: number; invalid: number }> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000).toISOString().substring(0, 10);
        dayMap[d] = { valid: 0, invalid: 0 };
      }
      (views || []).forEach((v: any) => {
        const d = new Date(v.created_at).toISOString().substring(0, 10);
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
  }, []);

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
        <p className="text-xs text-gray-500 mb-4">Last 14 days Â· real data</p>
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
        <p className="text-xs text-gray-500 mb-4">Last 24 hours Â· real data</p>
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