'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { Check, X, DollarSign } from 'lucide-react';

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('withdrawals')
      .select('*, user:profiles(full_name, email)')
      .order('created_at', { ascending: false });
    setWithdrawals(data || []);
  };

  useEffect(() => { load(); }, []);

  const approve = async (id: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.rpc('approve_withdrawal', { p_withdrawal_id: id, p_admin_id: user?.id });
    if (error) { toast.error(error.message); return; }
    toast.success('Approved');
    load();
  };

  const reject = async (id: string) => {
    const reason = prompt('Reason for rejection?');
    if (!reason) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.rpc('reject_withdrawal', { p_withdrawal_id: id, p_admin_id: user?.id, p_reason: reason });
    if (error) { toast.error(error.message); return; }
    toast.success('Rejected');
    load();
  };

  const pay = async (id: string) => {
    const tx = prompt('Transaction ID / hash:');
    if (!tx) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.rpc('pay_withdrawal', { p_withdrawal_id: id, p_admin_id: user?.id, p_tx_id: tx });
    if (error) { toast.error(error.message); return; }
    toast.success('Marked as paid');
    load();
  };

  const filtered = filter === 'all' ? withdrawals : withdrawals.filter(w => w.status === filter);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">Manage Withdrawals</h2>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input-field text-sm w-auto">
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div className="glass rounded-2xl p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                  <td className="py-3">
                    <div className="font-medium">{w.user?.full_name || '—'}</div>
                    <div className="text-xs text-gray-500">{w.user?.email}</div>
                  </td>
                  <td className="py-3 text-green-400 font-semibold">{formatCurrency(w.amount)}</td>
                  <td className="py-3 capitalize">{w.method}</td>
                  <td className="py-3 text-gray-400 text-xs font-mono max-w-[200px] truncate">{w.account_details?.account || '—'}</td>
                  <td className="py-3 text-gray-400">{new Date(w.created_at).toLocaleDateString()}</td>
                  <td className="py-3"><span className={`badge status-${w.status}`}>{w.status}</span></td>
                  <td className="py-3">
                    {w.status === 'pending' && (
                      <>
                        <button onClick={() => approve(w.id)} className="text-xs text-green-400 hover:text-green-300 mr-2 inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Approve
                        </button>
                        <button onClick={() => reject(w.id)} className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1">
                          <X className="w-3 h-3" /> Reject
                        </button>
                      </>
                    )}
                    {w.status === 'approved' && (
                      <button onClick={() => pay(w.id)} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> Mark Paid
                      </button>
                    )}
                    {w.status === 'rejected' && w.rejection_reason && (
                      <span className="text-xs text-gray-500 italic">{w.rejection_reason}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">No withdrawals found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
