'use client';
import { useEffect, useState } from 'react';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend } from 'chart.js';
import { createClient } from '@/lib/supabase/client';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend);

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';

const COUNTRY_COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#f59e0b', '#10b981'];

export default function AdminCharts() {
  const [monthly, setMonthly] = useState<{ labels: string[]; revenue: number[]; profit: number[] }>({ labels: [], revenue: [], profit: [] });
  const [adDist, setAdDist] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });
  const [topCountries, setTopCountries] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });
  const [growth, setGrowth] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();

      // Last 7 days revenue + payouts (for profit)
      const [{ data: earningsRows }, { data: adNetworks }, { data: views }, { data: creators }] = await Promise.all([
        supabase.from('earnings').select('amount, created_at').eq('type', 'view_earning').gte('created_at', since),
        supabase.from('ad_networks').select('name, total_revenue, weight').eq('status', 'active'),
        supabase.from('views').select('country_code, created_at').gte('created_at', since),
        supabase.from('profiles').select('created_at').eq('role', 'creator'),
      ]);

      // Monthly (last 7 months)
      const monthMap: Record<string, { rev: number; pay: number }> = {};
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthNow = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(monthNow.getFullYear(), monthNow.getMonth() - i, 1);
        const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
        monthMap[key] = { rev: 0, pay: 0 };
      }
      // Approximate revenue by prorating total ad revenue to last 7 months
      const totalAdRev = (adNetworks || []).reduce((s, a) => s + Number(a.total_revenue), 0);
      const avgMonthlyRev = totalAdRev / 7;
      (earningsRows || []).forEach((e: any) => {
        const d = new Date(e.created_at);
        const key = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
        if (monthMap[key]) monthMap[key].pay += Number(e.amount);
      });
      const monthKeys = Object.keys(monthMap);
      setMonthly({
        labels: monthKeys,
        revenue: monthKeys.map(k => Math.round(avgMonthlyRev + (monthMap[k].pay * 0.2))),
        profit: monthKeys.map(k => Math.max(0, monthMap[k].rev - monthMap[k].pay)),
      });

      // Ad distribution (by total revenue share)
      const totalWeight = (adNetworks || []).reduce((s, a) => s + a.weight, 0) || 1;
      setAdDist({
        labels: (adNetworks || []).map(a => a.name),
        data: (adNetworks || []).map(a => Math.round((a.weight / totalWeight) * 100)),
      });

      // Top countries from views
      const cMap: Record<string, number> = {};
      (views || []).forEach((v: any) => {
        const c = v.country_code || 'XX';
        cMap[c] = (cMap[c] || 0) + 1;
      });
      const topC = Object.entries(cMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
      setTopCountries({
        labels: topC.map(([c]) => {
          const flag = String.fromCodePoint(...c.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
          return `${flag} ${c}`;
        }),
        data: topC.map(([, n]) => n),
      });

      // Growth: cumulative creators over last 7 months
      const growthMap: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(monthNow.getFullYear(), monthNow.getMonth() - i, 1);
        const key = `${monthNames[d.getMonth()]}`;
        growthMap[key] = 0;
      }
      (creators || []).forEach((c: any) => {
        const d = new Date(c.created_at);
        const key = `${monthNames[d.getMonth()]}`;
        if (growthMap[key] !== undefined) growthMap[key]++;
      });
      // Build cumulative
      const gKeys = Object.keys(growthMap);
      let cum = 0;
      const cumulative = gKeys.map(k => { cum += growthMap[k]; return cum; });
      setGrowth({ labels: gKeys, data: cumulative });
    };
    load();
  }, []);

  const revenueData = {
    labels: monthly.labels,
    datasets: [
      { label: 'Revenue', data: monthly.revenue, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
      { label: 'Profit', data: monthly.profit, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
    ],
  };

  const adDistData = {
    labels: adDist.labels,
    datasets: [{ data: adDist.data, backgroundColor: ['#8b5cf6', '#3b82f6', '#10b981', '#ec4899', '#f59e0b', '#06b6d4'].slice(0, adDist.data.length), borderColor: '#0a0716', borderWidth: 3 }],
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
          <h3 className="font-semibold mb-1">Platform Revenue & Profit</h3>
          <p className="text-xs text-gray-500 mb-4">Last 7 months · Estimated (manual revenue)</p>
          <div className="h-64 sm:h-72">
            <Line data={revenueData} options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: tickColor, font: fontOpts, usePointStyle: true } } },
              scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts, callback: (v: any) => '$' + v }, beginAtZero: true } },
            }} />
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Ad Network Distribution</h3>
          <p className="text-xs text-gray-500 mb-4">By traffic weight</p>
          <div className="h-64 sm:h-72">
            {adDist.data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No ad networks configured</div>
            ) : (
              <Doughnut data={adDistData} options={{
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