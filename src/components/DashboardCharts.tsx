'use client';
import { useEffect, useState } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Filler, Legend,
} from 'chart.js';
import { createClient } from '@/lib/supabase/client';
import { localDayKey, daysAgoStart } from '@/lib/utils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend);

const fontOpts = { family: 'Inter', size: 11 };
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#94a3b8';
const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: tickColor, font: fontOpts, usePointStyle: true } } },
};

const COUNTRY_COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899', '#10b981', '#f59e0b'];

export default function DashboardCharts() {
  const [earnings, setEarnings] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });
  const [country, setCountry] = useState<{ labels: string[]; data: number[] }>({ labels: [], data: [] });
  const [devices, setDevices] = useState<{ mobile: number; desktop: number; tablet: number }>({ mobile: 0, desktop: 0, tablet: 0 });
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const since = new Date(Date.now() - 30 * 86400_000).toISOString();

      const [{ data: p }, { data: earningsRows }, { data: views }] = await Promise.all([
        supabase.from('profiles').select('level, total_views').eq('id', user.id).single(),
        supabase.from('earnings').select('amount, created_at').eq('creator_id', user.id).gte('created_at', since),
        supabase.from('views').select('country_code, user_agent').eq('creator_id', user.id).gte('created_at', since),
      ]);

      setProfile(p);

      // Earnings per day (30 days, local timezone)
      const dayMap: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = localDayKey(daysAgoStart(i));
        dayMap[d] = 0;
      }
      (earningsRows || []).forEach((e: any) => {
        const d = localDayKey(e.created_at);
        if (dayMap[d] !== undefined) dayMap[d] += Number(e.amount);
      });
      const dayLabels = Object.keys(dayMap);
      setEarnings({
        labels: dayLabels.map(d => d.substring(5)),
        data: dayLabels.map(d => dayMap[d]),
      });

      // Country breakdown
      const cMap: Record<string, number> = {};
      (views || []).forEach((v: any) => {
        const c = v.country_code || 'XX';
        cMap[c] = (cMap[c] || 0) + 1;
      });
      const top = Object.entries(cMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
      setCountry({
        labels: top.map(([c]) => c),
        data: top.map(([, n]) => n),
      });

      // Devices
      let mobile = 0, desktop = 0, tablet = 0;
      (views || []).forEach((v: any) => {
        const ua = (v.user_agent || '').toLowerCase();
        if (ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) tablet++;
        else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) mobile++;
        else desktop++;
      });
      setDevices({ mobile, desktop, tablet });
    };
    load();
  }, []);

  const earningsData = {
    labels: earnings.labels,
    datasets: [{
      label: 'Earnings',
      data: earnings.data,
      borderColor: '#8b5cf6',
      backgroundColor: (ctx: any) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 250);
        g.addColorStop(0, 'rgba(139,92,246,0.4)');
        g.addColorStop(1, 'rgba(59,130,246,0)');
        return g;
      },
      fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
    }],
  };

  const countryData = {
    labels: country.labels.map(c => {
      const flag = String.fromCodePoint(...c.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
      return `${flag} ${c}`;
    }),
    datasets: [{ data: country.data, backgroundColor: COUNTRY_COLORS.slice(0, country.data.length), borderRadius: 6 }],
  };

  const deviceData = {
    labels: ['Mobile', 'Desktop', 'Tablet'],
    datasets: [{ data: [devices.mobile, devices.desktop, devices.tablet], backgroundColor: ['#8b5cf6', '#3b82f6', '#ec4899'], borderColor: '#0a0716', borderWidth: 3 }],
  };

  const levels = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  const currentLevelIdx = levels.indexOf(profile?.level || 'bronze');

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Earnings Overview</h3>
              <p className="text-xs text-gray-500">Last 30 days Â· real data</p>
            </div>
          </div>
          <div className="h-64 sm:h-72">
            <Line data={earningsData} options={{
              ...baseOpts, plugins: { ...baseOpts.plugins, legend: { display: false } },
              scales: {
                x: { grid: { color: gridColor, display: false }, ticks: { color: tickColor, font: fontOpts, maxTicksLimit: 8 } },
                y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts, callback: (v: any) => '$' + v.toFixed(2) }, beginAtZero: true },
              },
            }} />
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Top Countries</h3>
          <p className="text-xs text-gray-500 mb-4">Real visitor locations</p>
          <div className="h-64 sm:h-72">
            {country.data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No traffic data yet</div>
            ) : (
              <Bar data={countryData} options={{
                ...baseOpts, indexAxis: 'y',
                plugins: { ...baseOpts.plugins, legend: { display: false } },
                scales: {
                  x: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts }, beginAtZero: true },
                  y: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } },
                },
              }} />
            )}
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Devices</h3>
          <p className="text-xs text-gray-500 mb-4">Real user agents</p>
          <div className="h-56">
            {(devices.mobile + devices.desktop + devices.tablet) === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No data yet</div>
            ) : (
              <Doughnut data={deviceData} options={{
                ...baseOpts, cutout: '70%',
                plugins: { ...baseOpts.plugins, legend: { position: 'bottom' as const, labels: { color: tickColor, font: fontOpts, padding: 15, usePointStyle: true } } },
              }} />
            )}
          </div>
        </div>
        <div className="glass rounded-2xl p-5 lg:col-span-2">
          <h3 className="font-semibold mb-1">Level Progress</h3>
          <p className="text-xs text-gray-500 mb-4">Climb tiers to unlock higher CPM and more perks</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-6">
            {['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'].map((lvl, i) => {
              const colors = ['from-amber-700 to-amber-500', 'from-slate-500 to-slate-300', 'from-yellow-500 to-yellow-300', 'from-purple-500 to-purple-300', 'from-blue-500 to-cyan-300'];
              const isCurrent = i === currentLevelIdx;
              const isPast = i < currentLevelIdx;
              return (
                <div key={lvl} className={`p-3 rounded-xl bg-gradient-to-br ${colors[i]} ${isCurrent ? 'ring-2 ring-yellow-300 scale-105' : isPast ? 'opacity-80' : 'opacity-50'}`}>
                  <div className="text-2xl mb-1">{['ðŸ¥‰', 'ðŸ¥ˆ', 'ðŸ¥‡', 'ðŸ’Ž', 'ðŸ‘‘'][i]}</div>
                  <div className="text-xs font-bold text-white">{lvl}</div>
                  {isCurrent && <div className="text-[9px] text-white/90 mt-1">Current</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}