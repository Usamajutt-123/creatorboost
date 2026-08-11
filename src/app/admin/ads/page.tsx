'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Power, RefreshCw, Trash2, Plus, Download } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { adminLoadAdNetworks, adminToggleAdNetwork, adminListAdRevenue, adminImportAdRevenue, adminDeleteAdRevenue } from '@/lib/admin-server';
import { revenueIntegrationStatus } from '@/lib/ad-revenue/provider';

type RevenueRow = {
  id: number;
  revenue_date: string;
  network: string;
  impressions: number;
  clicks: number | null;
  revenue: number;
  currency: string;
  country: string | null;
  source: string;
  imported_at: string;
};

export default function AdminAdsPage() {
  const [networks, setNetworks] = useState<any[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [status, setStatus] = useState({ configured: false, providers: [] as Array<{ id: string; label: string; configured: boolean }> });
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), network: '', impressions: '', clicks: '', revenue: '', country: '' });

  const load = async () => {
    try {
      const [rows, rev] = await Promise.all([adminLoadAdNetworks(), adminListAdRevenue()]);
      setNetworks(rows);
      setRevenue(rev);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load ad networks');
    }
  };
  const loadStatus = () => setStatus(revenueIntegrationStatus());

  useEffect(() => { load(); loadStatus(); }, []);

  const toggle = async (id: number, current: string) => {
    const next = current === 'active' ? 'paused' : 'active';
    try { await adminToggleAdNetwork(id, next); toast.success(`Network ${next}`); load(); }
    catch (e: any) { toast.error(e.message || 'Action failed'); }
  };

  const importManual = async () => {
    const rev = parseFloat(form.revenue);
    if (!form.network.trim()) { toast.error('Network name is required'); return; }
    if (!Number.isFinite(rev) || rev < 0) { toast.error('Revenue must be a positive number'); return; }
    setImporting(true);
    try {
      await adminImportAdRevenue([{
        date: form.date,
        network: form.network.trim(),
        impressions: parseInt(form.impressions) || 0,
        clicks: form.clicks ? parseInt(form.clicks) : null,
        revenue: rev,
        currency: 'USD',
        country: form.country.trim().toUpperCase() || null,
      }]);
      toast.success('Revenue recorded (source: manual)');
      setForm(f => ({ ...f, network: '', impressions: '', clicks: '', revenue: '', country: '' }));
      load();
    } catch (e: any) {
      toast.error(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const del = async (id: number) => {
    if (!confirm('Delete this revenue entry?')) return;
    try { await adminDeleteAdRevenue(id); toast.success('Deleted'); load(); }
    catch (e: any) { toast.error(e.message || 'Delete failed'); }
  };

  const totalRecorded = revenue.reduce((s, r) => s + Number(r.revenue), 0);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Ad Networks & Revenue</h2>
          <p className="text-sm text-gray-500">Manage networks and the real revenue ledger</p>
        </div>
        <button onClick={() => { load(); loadStatus(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {/* Revenue integration status */}
      <div className={`glass rounded-2xl p-4 flex items-start gap-3 ${status.configured ? '' : 'border border-yellow-500/30'}`}>
        <span className="text-sm">{status.configured ? '✅' : 'ℹ️'}</span>
        <div className="text-xs text-gray-300">
          {status.configured ? (
            <><strong className="text-white">REAL revenue integration configured.</strong> Revenue is imported automatically from a connected provider.</>
          ) : (
            <>
              <strong className="text-white">Revenue integration not configured.</strong> No provider API is connected. Revenue can only be
              recorded <strong>manually</strong> below (source: manual) and is always labeled <strong>MANUAL</strong>. The platform never
              displays estimated or fabricated revenue as real.
            </>
          )}
          {status.providers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {status.providers.map(p => (
                <span key={p.id} className={`badge ${p.configured ? 'status-active' : 'status-pending'}`}>{p.label}: {p.configured ? 'configured' : 'not configured'}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Manual import */}
      <div className="glass-strong rounded-2xl p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Download className="w-4 h-4" /> Record Manual Revenue</h3>
        <p className="text-xs text-gray-500 mb-3">Real revenue entered from a payout report — stored in the ledger as <strong>MANUAL</strong>.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-field text-sm py-2" aria-label="Revenue date" />
          <input value={form.network} onChange={e => setForm({ ...form, network: e.target.value })} className="input-field text-sm py-2" placeholder="Network (e.g. Adsterra)" aria-label="Network" />
          <input type="number" min="0" value={form.impressions} onChange={e => setForm({ ...form, impressions: e.target.value })} className="input-field text-sm py-2" placeholder="Impressions" aria-label="Impressions" />
          <input type="number" min="0" value={form.clicks} onChange={e => setForm({ ...form, clicks: e.target.value })} className="input-field text-sm py-2" placeholder="Clicks (optional)" aria-label="Clicks" />
          <input type="number" min="0" step="0.000001" value={form.revenue} onChange={e => setForm({ ...form, revenue: e.target.value })} className="input-field text-sm py-2" placeholder="Revenue (USD)" aria-label="Revenue" />
          <div className="flex gap-1">
            <button onClick={importManual} disabled={importing} className="btn-primary flex-1 py-2 rounded-lg text-xs font-semibold text-white"><Plus className="w-3.5 h-3.5 inline mr-1" />Record</button>
          </div>
        </div>
      </div>

      {/* Revenue ledger */}
      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between mb-3">
          <h3 className="font-semibold">Revenue Ledger <span className="text-xs text-gray-500 font-normal">· {formatCurrency(totalRecorded)} recorded</span></h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-white/5">
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Network</th>
                <th className="text-left py-2 font-medium">Impressions</th>
                <th className="text-left py-2 font-medium">Clicks</th>
                <th className="text-left py-2 font-medium">Revenue</th>
                <th className="text-left py-2 font-medium">Source</th>
                <th className="text-left py-2 font-medium">Imported</th>
                <th className="text-right py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {revenue.map(r => (
                <tr key={r.id} className="border-b border-white/5 table-row">
                  <td className="py-3">{r.revenue_date}</td>
                  <td className="py-3 font-medium">{r.network} {r.country && <span className="text-gray-500 text-xs">({r.country})</span>}</td>
                  <td className="py-3 text-gray-400">{Number(r.impressions).toLocaleString()}</td>
                  <td className="py-3 text-gray-400">{r.clicks != null ? Number(r.clicks).toLocaleString() : '—'}</td>
                  <td className="py-3 text-green-400 font-semibold">{formatCurrency(Number(r.revenue))}</td>
                  <td className="py-3">
                    <span className={`badge ${r.source === 'provider' ? 'status-active' : 'status-pending'}`}>
                      {r.source === 'provider' ? 'REAL' : 'MANUAL'}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400 text-xs">{new Date(r.imported_at).toLocaleString()}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => del(r.id)} className="btn-ghost px-2 py-1 rounded text-xs text-red-400" aria-label="Delete revenue entry">
                      <Trash2 className="w-3 h-3 inline" /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!revenue.length && (
                <tr><td colSpan={8} className="py-10 text-center text-gray-500 text-sm">No revenue recorded — integration not configured</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Network config cards */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-bold">Ad Network Configuration</h3>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {networks.map(n => (
          <div key={n.id} className="glass-strong rounded-2xl p-5 card-glow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">{n.name}</h3>
              <span className={`badge status-${n.status === 'active' ? 'active' : 'paused'}`}>{n.status}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Traffic Weight</span><span className="font-semibold">{n.weight}%</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Fill Rate</span><span>{n.fill_rate}%</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Avg CPM (config)</span><span>${n.avg_cpm}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Total Revenue (legacy field)</span><span>{formatCurrency(n.total_revenue)}</span></div>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
              The legacy total_revenue field is not used for reporting — see the revenue ledger above.
            </p>
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
