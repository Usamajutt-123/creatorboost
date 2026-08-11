'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Power, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { adminLoadAdNetworks, adminToggleAdNetwork } from '@/lib/admin-server';

export default function AdminAdsPage() {
  const [networks, setNetworks] = useState<any[]>([]);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const rows = await adminLoadAdNetworks();
      setNetworks(rows);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load ad networks');
    }
  };

  const toggle = async (id: number, current: string) => {
    const next = current === 'active' ? 'paused' : 'active';
    try { await adminToggleAdNetwork(id, next); toast.success(`Network ${next}`); load(); }
    catch (e: any) { toast.error(e.message || 'Action failed'); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Ad Networks</h2>
          <p className="text-sm text-gray-500">Revenue figures are entered manually until an API integration is configured.</p>
        </div>
        <button onClick={() => { load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>
      <div className="glass rounded-2xl p-4 flex items-start gap-3">
        <span className="text-sm">ℹ️</span>
        <p className="text-xs text-gray-300">
          <strong className="text-white">Manual revenue configuration:</strong> the platform does not yet integrate with live ad-network APIs.
          Reported revenue and profit are <strong>manual/estimated</strong> and should not be presented as audited financials.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {networks.map(n => (
          <div key={n.id} className="glass-strong rounded-2xl p-5 card-glow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">{n.name}</h3>
              <span className={`badge status-${n.status === 'active' ? 'active' : 'paused'}`}>{n.status}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Total Revenue (manual)</span><span className="font-semibold text-green-400">{formatCurrency(n.total_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">This Month</span><span>{formatCurrency(n.monthly_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Avg CPM</span><span>${n.avg_cpm}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Fill Rate</span><span>{n.fill_rate}%</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Weight</span><span>{n.weight}%</span></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => toggle(n.id, n.status)} className="btn-ghost flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1">
                <Power className="w-3 h-3" /> {n.status === 'active' ? 'Pause' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
