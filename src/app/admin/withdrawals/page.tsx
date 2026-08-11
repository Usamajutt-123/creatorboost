'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, X, DollarSign, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { adminListWithdrawals, adminApproveWithdrawal, adminRejectWithdrawal, adminPayWithdrawal } from '@/lib/admin-server';

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const rows = await adminListWithdrawals();
      setWithdrawals(rows);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<any>, id: string, ok: string) => {
    setBusy(id);
    try { await fn(); toast.success(ok); load(); }
    catch (e: any) { toast.error(e.message || 'Action failed'); }
    finally { setBusy(null); }
  };

  const filtered = filter === 'all' ? withdrawals : withdrawals.filter(w => w.status === filter);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">Manage Withdrawals</h2>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="input-field text-sm w-auto">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
          <button onClick={() => { setLoading(true); load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">User</th>
                  <th className="text-left py-2 font-medium">Amount</th>
                  <th className="text-left py-2 font-medium">Method</th>
                  <th className="text-left py-2 font-medium">Account</th>
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} className="border-b border-white/5 table-row">
                    <td className="py-3"><div className="font-medium">{w.user?.full_name || '—'}</div><div className="text-xs text-gray-500">{w.user?.email}</div></td>
                    <td className="py-3 text-green-400 font-semibold">{formatCurrency(w.amount)}</td>
                    <td className="py-3 capitalize">{w.method}</td>
                    <td className="py-3 text-gray-400 text-xs font-mono max-w-[200px] truncate">{w.account_details?.account || '—'}</td>
                    <td className="py-3 text-gray-400">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td className="py-3"><span className={`badge status-${w.status}`}>{w.status}</span></td>
                    <td className="py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {w.status === 'pending' && (
                          <>
                            <button onClick={() => run(() => adminApproveWithdrawal(w.id), w.id, 'Approved')} disabled={busy === w.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-green-400"><Check className="w-3 h-3" /> Approve</button>
                            <button onClick={() => { const reason = prompt('Reason for rejection?'); if (reason) run(() => adminRejectWithdrawal(w.id, reason), w.id, 'Rejected'); }} disabled={busy === w.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-red-400"><X className="w-3 h-3" /> Reject</button>
                          </>
                        )}
                        {w.status === 'approved' && (
                          <button onClick={() => { const tx = prompt('Transaction ID / hash:'); if (tx) run(() => adminPayWithdrawal(w.id, tx), w.id, 'Marked as paid'); }} disabled={busy === w.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-blue-400"><DollarSign className="w-3 h-3" /> Mark Paid</button>
                        )}
                        {w.status === 'rejected' && w.rejection_reason && <span className="text-xs text-gray-500 italic">{w.rejection_reason}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={7} className="py-12 text-center text-gray-500">No withdrawals found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
