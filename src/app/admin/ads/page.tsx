'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { Power, Settings } from 'lucide-react';

export default function AdminAdsPage() {
  const [networks, setNetworks] = useState<any[]>([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('ad_networks').select('*').order('total_revenue', { ascending: false });
    setNetworks(data || []);
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const supabase = createClient();
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await supabase.from('ad_networks').update({ status: newStatus }).eq('id', id);
    toast.success(`Network ${newStatus}`);
    load();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h2 className="font-display text-2xl font-bold">Ad Networks</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {networks.map(n => (
          <div key={n.id} className="glass-strong rounded-2xl p-5 card-glow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">{n.name}</h3>
              <span className={`badge status-${n.status === 'active' ? 'active' : 'paused'}`}>{n.status}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Total Revenue</span><span className="font-semibold text-green-400">{formatCurrency(n.total_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">This Month</span><span>{formatCurrency(n.monthly_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Avg CPM</span><span>${n.avg_cpm}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Fill Rate</span><span>{n.fill_rate}%</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Weight</span><span>{n.weight}%</span></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => toggleStatus(n.id, n.status)} className="btn-ghost flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1">
                <Power className="w-3 h-3" /> {n.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              <button onClick={() => toast.info('Configuration UI coming soon')} className="btn-primary flex-1 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1">
                <Settings className="w-3 h-3" /> Configure
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
