'use client';
import { useState } from 'react';
import { Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend } from 'chart.js';
import { Calculator, Info, DollarSign, Users, TrendingUp } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend);

const tierCpm: Record<string, number> = {
  tier_1: 5,
  tier_2: 2.75,
  tier_3: 1,
  mixed: 2.83,
};

export default function CpmCalculator() {
  const [visitors, setVisitors] = useState(10000);
  const [tier, setTier] = useState('tier_1');
  const [level, setLevel] = useState(1.25);
  const [quality, setQuality] = useState(0.75);

  const baseCpm = tierCpm[tier] || 5;
  const validViews = Math.round(visitors * quality);
  const revenue = (validViews / 1000) * baseCpm * level;
  const creator = revenue * 0.7;
  const platform = revenue * 0.3;
  const effectiveCpm = visitors > 0 ? (revenue / visitors) * 1000 : 0;

  const presets = [1000, 5000, 10000, 50000, 100000];

  return (
    <section id="calculator" className="relative py-24 bg-gradient-to-b from-transparent via-purple-950/20 to-transparent scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">
            <Calculator className="w-3 h-3" /> CPM Calculator
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold mb-4">Estimate Your <span className="gradient-text">Earnings</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">See how much you can earn based on your traffic, country mix, and creator level. All rates are dynamic and configured by our team.</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="glass-strong rounded-2xl p-6 sm:p-8 space-y-5">
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-2">Visitors per month</label>
              <input type="number" value={visitors} min="0" onChange={e => setVisitors(parseInt(e.target.value) || 0)} className="input-field" />
              <div className="grid grid-cols-5 gap-2 mt-2">
                {presets.map(p => (
                  <button key={p} onClick={() => setVisitors(p)} className={`tab-btn ${visitors === p ? 'active' : ''}`}>{p >= 1000 ? `${p/1000}K` : p}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-300 block mb-2">Country Tier</label>
              <select value={tier} onChange={e => setTier(e.target.value)} className="input-field">
                <option value="tier_1">Tier 1 — USA, UK, Germany, Canada ($5/1K)</option>
                <option value="tier_2">Tier 2 — France, Italy, Spain, UAE ($2.75/1K)</option>
                <option value="tier_3">Tier 3 — India, Pakistan, Brazil, Mexico ($1/1K)</option>
                <option value="mixed">Mixed (40% T1, 35% T2, 25% T3)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-300 block mb-2">Creator Level</label>
              <select value={level} onChange={e => setLevel(parseFloat(e.target.value))} className="input-field">
                <option value="1.0">Bronze (1.0× multiplier)</option>
                <option value="1.1">Silver (1.1× multiplier)</option>
                <option value="1.25">Gold (1.25× multiplier)</option>
                <option value="1.5">Platinum (1.5× multiplier)</option>
                <option value="2.0">Diamond (2.0× multiplier)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-300 block mb-2">Traffic Quality</label>
              <div className="grid grid-cols-4 gap-2">
                {[0.6, 0.75, 0.9, 0.98].map(q => (
                  <button key={q} onClick={() => setQuality(q)} className={`tab-btn ${quality === q ? 'active' : ''}`}>{Math.round(q * 100)}%</button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">Higher = fewer bot/VPN/blocked views</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass-strong rounded-2xl p-6 bg-gradient-to-br from-purple-500/10 to-blue-500/10">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                <DollarSign className="w-3 h-3" /> Estimated Monthly Revenue
              </div>
              <div className="text-5xl font-bold gradient-text mb-2">${revenue.toFixed(2)}</div>
              <div className="text-xs text-gray-500">After traffic quality filter</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="glass rounded-2xl p-4">
                <div className="text-xs text-gray-400 mb-1">Your Earnings</div>
                <div className="text-2xl font-bold text-green-400">${creator.toFixed(2)}</div>
                <div className="text-xs text-gray-500 mt-1">70% payout share</div>
              </div>
              <div className="glass rounded-2xl p-4">
                <div className="text-xs text-gray-400 mb-1">Platform Profit</div>
                <div className="text-2xl font-bold text-blue-400">${platform.toFixed(2)}</div>
                <div className="text-xs text-gray-500 mt-1">30% platform cut</div>
              </div>
              <div className="glass rounded-2xl p-4">
                <div className="text-xs text-gray-400 mb-1">Effective CPM</div>
                <div className="text-2xl font-bold text-purple-300">${effectiveCpm.toFixed(3)}</div>
                <div className="text-xs text-gray-500 mt-1">Per 1,000 valid views</div>
              </div>
              <div className="glass rounded-2xl p-4">
                <div className="text-xs text-gray-400 mb-1">Valid Views</div>
                <div className="text-2xl font-bold text-white">{validViews.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-1">{Math.round(quality * 100)}% of total</div>
              </div>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Earnings breakdown</h4>
                <span className="text-xs text-gray-500">Per month</span>
              </div>
              <div className="h-40">
                <Doughnut
                  data={{
                    labels: ['You earn', 'Platform'],
                    datasets: [{ data: [creator || 0.01, platform || 0.01], backgroundColor: ['#10b981', '#3b82f6'], borderColor: '#0a0716', borderWidth: 3 }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false, cutout: '70%',
                    plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, usePointStyle: true, padding: 12 } } },
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 glass-strong rounded-2xl p-6 sm:p-8">
          <h3 className="font-semibold mb-2">Real-world examples</h3>
          <p className="text-xs text-gray-500 mb-5">Gold creator, Tier 1 traffic, 85% quality — projected monthly revenue</p>
          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { v: 1000, r: 5.31 },
              { v: 5000, r: 26.56 },
              { v: 10000, r: 53.13 },
              { v: 50000, r: 265.63 },
              { v: 100000, r: 531.25 },
            ].map(e => (
              <div key={e.v} className="glass rounded-xl p-4 text-center card-glow">
                <div className="text-xs text-gray-500 mb-1">{e.v.toLocaleString()} visitors</div>
                <div className="text-xl font-bold gradient-text">${e.r.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
