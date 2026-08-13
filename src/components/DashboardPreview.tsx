'use client';
// Chart.js is loaded on demand (see components/charts/LazyChart) so the
// charting runtime stays out of the home page's first-load JavaScript.
import { Line, Bar } from '@/components/charts/LazyChart';

export default function DashboardPreview() {
  return (
    <section className="relative py-16 sm:py-20 lg:py-24 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Creator Dashboard</div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold mb-4">A dashboard that <span className="gradient-text">just works</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">An illustrative preview of the creator dashboard. Signed-in dashboards load their campaign and earnings data from the database.</p>
        </div>
        <div className="relative">
          <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-3xl opacity-20 blur-2xl" />
          <div className="relative glass-strong rounded-2xl p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <div className="ml-2 text-xs text-gray-500 font-mono">Illustrative dashboard preview</div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {[
                { l: 'Total Earnings', v: '$12,847.32', c: '23.5%' },
                { l: 'Valid Views', v: '2.4M', c: '18.2%' },
                { l: 'CPM Rate', v: '$5.00', c: 'Gold tier' },
                { l: 'Balance', v: '$847.32', c: 'Available' },
              ].map(s => (
                <div key={s.l} className="glass rounded-xl p-4 stat-card">
                  <div className="text-xs text-gray-400 mb-1">{s.l}</div>
                  <div className="text-2xl font-bold text-white">{s.v}</div>
                  <div className="text-xs text-green-400 mt-1">↑ {s.c}</div>
                </div>
              ))}
            </div>
            <div className="grid lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 glass rounded-xl p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold">Earnings Overview</h4>
                  <span className="text-xs text-gray-500">Last 30 days</span>
                </div>
                <div className="lg:col-span-2 glass rounded-xl p-4 overflow-hidden">
                  <Line
                    data={{
                      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
                      datasets: [{
                        data: [24, 31, 28, 36, 42, 39, 48, 45, 52, 49, 58, 62, 56, 65, 61, 70, 68, 74, 71, 79, 76, 83, 80, 88, 85, 91, 89, 96, 93, 100],
                        borderColor: '#8b5cf6',
                        backgroundColor: (ctx: any) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, 'rgba(139,92,246,0.4)'); g.addColorStop(1, 'rgba(139,92,246,0)'); return g; },
                        fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0,
                      }],
                    }}
                    options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }}
                  />
                </div>
              </div>
              <div className="glass rounded-xl p-4 overflow-hidden">
                <h4 className="text-sm font-semibold mb-3">Top Countries</h4>
                <div className="h-48 sm:h-56">
                  <Bar
                    data={{
                      labels: ['USA', 'UK', 'DE', 'FR', 'IN', 'BR'],
                      datasets: [{ data: [812, 389, 274, 168, 461, 174], backgroundColor: ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#a855f7', '#ec4899'], borderRadius: 4 }],
                    }}
                    options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
