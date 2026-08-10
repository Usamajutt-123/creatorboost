'use client';
import { Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend } from 'chart.js';
import { DollarSign, TrendingUp, Users, Megaphone, Check, X } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend);

const tickColor = '#94a3b8';
const gridColor = 'rgba(255,255,255,0.06)';
const fontOpts = { family: 'Inter', size: 11 };

export default function AdminPreview() {
  return (
    <section className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/20 to-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-red-300 mb-3">Admin Panel</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Powerful tools for <span className="gradient-text">platform owners</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Manage users, campaigns, CPM rates, ad networks, and more — all from a single dashboard.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
          {[
            { l: 'Total Revenue', v: '$847,290', c: '18.4%', icon: DollarSign, color: 'green' },
            { l: 'Platform Profit', v: '$214,580', c: '22.1%', icon: TrendingUp, color: 'purple' },
            { l: 'Total Creators', v: '12,847', c: '432 this week', icon: Users, color: 'blue' },
            { l: 'Active Campaigns', v: '3,429', c: '8.7%', icon: Megaphone, color: 'pink' },
          ].map(s => (
            <div key={s.l} className="glass rounded-2xl p-4 sm:p-5 stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] sm:text-xs text-gray-400">{s.l}</div>
                <s.icon className="w-4 h-4 sm:w-5 sm:h-5 opacity-70" />
              </div>
              <div className="text-xl sm:text-2xl lg:text-3xl font-bold">{s.v}</div>
              <div className="text-[10px] sm:text-xs text-green-400 mt-0.5 sm:mt-1">↑ {s.c}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
          <div className="lg:col-span-2 glass-strong rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-xs sm:text-sm mb-3 sm:mb-4">Platform Revenue &amp; Profit</h3>
            <div className="h-56 sm:h-64">
              <Line
                data={{
                  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
                  datasets: [
                    { label: 'Revenue', data: [120, 145, 178, 220, 268, 312, 387], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
                    { label: 'Profit', data: [30, 38, 48, 62, 78, 92, 124], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.2)', fill: true, tension: 0.4, borderWidth: 2 },
                  ],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: tickColor, font: fontOpts, usePointStyle: true } } },
                  scales: { x: { grid: { display: false }, ticks: { color: tickColor, font: fontOpts } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, font: fontOpts, callback: (v: any) => '$' + v + 'K' } } },
                }}
              />
            </div>
          </div>
          <div className="glass-strong rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-xs sm:text-sm mb-3 sm:mb-4">Ad Network Distribution</h3>
            <div className="h-56 sm:h-64">
              <Doughnut
                data={{
                  labels: ['Monetag', 'Adsterra', 'AdSense', 'Other'],
                  datasets: [{ data: [38, 26, 22, 14], backgroundColor: ['#8b5cf6', '#3b82f6', '#10b981', '#ec4899'], borderColor: '#0a0716', borderWidth: 3 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: '70%',
                  plugins: { legend: { position: 'bottom', labels: { color: tickColor, font: fontOpts, padding: 10, usePointStyle: true } } },
                }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">x
          <div className="glass-strong rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-xs sm:text-sm mb-3">Pending Withdrawals</h3>
            <div className="space-y-2">
              {[
                { user: 'Alex Morgan', method: 'USDT', time: '2h ago', amount: 250 },
                { user: 'Sarah Khan', method: 'PayPal', time: '5h ago', amount: 1500 },
                { user: 'James Wilson', method: 'Binance', time: '1d ago', amount: 500 },
              ].map((w, i) => (
                <div key={i} className="p-3 glass rounded-xl flex items-center justify-between">
                  <div>
                    <div className="font-medium text-xs sm:text-sm">{w.user}</div>
                    <div className="text-[10px] sm:text-xs text-gray-500">{w.method} • {w.time}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs sm:text-sm font-semibold text-green-400">${w.amount.toLocaleString()}</div>
                    <div className="flex gap-2 mt-1 justify-end">
                      <button className="text-[10px] sm:text-xs text-green-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Approve</button>
                      <button className="text-[10px] sm:text-xs text-red-400 inline-flex items-center gap-1"><X className="w-3 h-3" /> Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-strong rounded-2xl p-4 sm:p-5">
            <h3 className="font-semibold text-xs sm:text-sm mb-3">Recent Activity</h3>
            <div className="space-y-2">
              {[
                { icon: '✓', color: 'green', title: 'Withdrawal approved', desc: '$1,500 to Sarah Khan', time: '5m' },
                { icon: 'U', color: 'purple', title: 'New creator', desc: 'mike.chen@example.com', time: '12m' },
                { icon: '!', color: 'red', title: 'Fraud alert', desc: '892 bot views blocked', time: '1h' },
                { icon: 'A', color: 'blue', title: 'CPM updated', desc: 'USA: $4.50 → $5.00', time: '3h' },
              ].map((a, i) => (
                <div key={i} className="p-3 glass rounded-xl flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg bg-${a.color}-500/15 flex items-center justify-center text-${a.color}-400 text-sm flex-shrink-0`}>{a.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs sm:text-sm font-medium truncate">{a.title}</div>
                    <div className="text-[10px] sm:text-xs text-gray-500 truncate">{a.desc}</div>
                  </div>
                  <div className="text-[10px] sm:text-xs text-gray-500 flex-shrink-0">{a.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
