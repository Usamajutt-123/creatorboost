'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, CheckCircle, XCircle, Clock } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { requestWithdrawalAction } from '@/lib/withdraw-actions';
import { computeWithdrawalFee } from '@/lib/finance';

type MethodConfig = {
  id: number;
  method: string;
  label: string;
  icon: string;
  enabled: boolean;
  min_amount: number;
  max_amount: number;
  fee_percentage: number;
};

const PROFILE_COLUMNS = 'id, available_balance, pending_earnings';
const WITHDRAWAL_COLUMNS = 'id, amount, method, status, created_at';

/**
 * Initial balance/history/methods are server-rendered (see page.tsx); the form
 * and post-submit refresh keep the exact queries and validation they had.
 */
export default function WithdrawClient({
  initialProfile,
  initialHistory,
  initialMinWithdraw,
  initialMethods,
  userId,
  unreadCount,
}: {
  initialProfile: { id: string; available_balance: number; pending_earnings: number } | null;
  initialHistory: Array<{ id: string; amount: number; method: string; status: string; created_at: string }>;
  initialMinWithdraw: number;
  initialMethods: MethodConfig[];
  userId: string;
  unreadCount: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(initialMethods.length > 0 ? initialMethods[0].method : 'paypal');
  const [account, setAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(initialProfile);
  const [history, setHistory] = useState<any[]>(initialHistory);
  const [minWithdraw, setMinWithdraw] = useState(initialMinWithdraw);
  const [methods, setMethods] = useState<MethodConfig[]>(initialMethods);

  const selectedMethodConfig = methods.find(m => m.method === method);

  const feePct = selectedMethodConfig?.fee_percentage || 0;
  const amtNum = parseFloat(amount) || 0;
  const feePreview = computeWithdrawalFee(amtNum, feePct);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt < minWithdraw) { toast.error(`Minimum withdrawal is $${minWithdraw}`); return; }
    if (!selectedMethodConfig) { toast.error('Choose an available payment method'); return; }
    if (amt < Number(selectedMethodConfig.min_amount)) { toast.error(`Minimum for ${selectedMethodConfig.label} is $${selectedMethodConfig.min_amount}`); return; }
    if (amt > Number(selectedMethodConfig.max_amount)) { toast.error(`Maximum for ${selectedMethodConfig.label} is $${selectedMethodConfig.max_amount}`); return; }
    if (!Number.isInteger(amt * 100)) { toast.error('Use no more than two decimal places'); return; }
    const total = amt + computeWithdrawalFee(amt, feePct);
    if (total > (profile?.available_balance || 0)) { toast.error(`Insufficient balance (${formatCurrency(total)} incl. fee)`); return; }
    if (!account.trim()) { toast.error('Please enter your account details'); return; }

    setLoading(true);
    // Server action -> RPC (auth.uid() enforced in DB) + notification email.
    const res = await requestWithdrawalAction({ amount: amt, method, account });

    setLoading(false);
    if (!res.success) { toast.error(res.error || 'Failed'); return; }
    toast.success('Withdrawal request submitted!');
    setAmount(''); setAccount('');
    const supabase = createClient();
    const [{ data: w }, { data: p }] = await Promise.all([
      supabase.from('withdrawals').select(WITHDRAWAL_COLUMNS).eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', profile.id).single(),
    ]);
    setHistory(w || []);
    setProfile(p);
    router.refresh();
  };

  return (
    <>
      <DashboardTopbar title="Withdraw" subtitle={`Minimum withdrawal: ${formatCurrency(minWithdraw)}`} userId={userId} unreadCount={unreadCount} />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-strong rounded-2xl p-6">
            <h3 className="font-semibold mb-4">Request Withdrawal</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Amount (USD)</label>
                <input type="number" step="0.01" min={minWithdraw} value={amount} onChange={e => setAmount(e.target.value)} className="input-field" placeholder="Enter amount" />
                <p className="text-xs text-gray-500 mt-1">
                  Available: <span className="text-white font-semibold">{formatCurrency(profile?.available_balance || 0)}</span>
                  {feePreview > 0 && amtNum > 0 && (
                    <span className="block mt-0.5">Fee: <span className="text-yellow-300">{formatCurrency(feePreview)}</span> · Total deducted: {formatCurrency(amtNum + feePreview)}</span>
                  )}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-3">Payment Method</label>
                {methods.length === 0 ? (
                  <div className="glass rounded-xl p-6 text-center">
                    <p className="text-sm text-gray-400">No withdrawal methods are currently available.</p>
                    <p className="text-xs text-gray-500 mt-1">Please check back later.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {methods.map(m => (
                      <label key={m.id} className={`glass rounded-xl p-3 flex flex-col items-center gap-1 cursor-pointer transition ${method === m.method ? 'ring-2 ring-purple-500 bg-purple-500/10' : 'hover:bg-white/5'}`}>
                        <input type="radio" name="pm" value={m.method} checked={method === m.method} onChange={() => setMethod(m.method)} className="sr-only" />
                        <span className="text-2xl">{m.icon}</span>
                        <span className="text-xs font-medium text-center">{m.label}</span>
                        {m.fee_percentage > 0 && <span className="text-[10px] text-gray-500">{m.fee_percentage}% fee</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Account Details</label>
                <input value={account} onChange={e => setAccount(e.target.value)} className="input-field" placeholder={method === 'usdt' ? 'TRC20 wallet address' : 'Your account email / phone / number'} />
                {selectedMethodConfig && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    Min: ${selectedMethodConfig.min_amount} · Max: ${selectedMethodConfig.max_amount}
                    {selectedMethodConfig.fee_percentage > 0 && ` · Fee: ${selectedMethodConfig.fee_percentage}%`}
                  </p>
                )}
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
                {loading ? 'Submitting...' : 'Request Withdrawal'}
              </button>
            </form>
          </div>
          <div className="space-y-4">
            <div className="glass rounded-2xl p-5">
              <div className="text-xs text-gray-400 mb-1">Available</div>
              <div className="text-3xl font-bold gradient-text">{formatCurrency(profile?.available_balance || 0)}</div>
            </div>
            <div className="glass rounded-2xl p-5">
              <div className="text-xs text-gray-400 mb-1">Pending (holding period)</div>
              <div className="text-3xl font-bold text-yellow-400">{formatCurrency(profile?.pending_earnings || 0)}</div>
            </div>
            <div className="glass rounded-2xl p-5">
              <div className="text-xs text-gray-400 mb-1">Total Withdrawn</div>
              <div className="text-3xl font-bold">
                {formatCurrency(history.filter(h => h.status === 'paid').reduce((s, h) => s + Number(h.amount), 0))}
              </div>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Withdraw History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Amount</th>
                  <th className="text-left py-2 font-medium">Method</th>
                  <th className="text-left py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-white/5 table-row">
                    <td className="py-3">{new Date(h.created_at).toLocaleDateString()}</td>
                    <td className="py-3 font-semibold">{formatCurrency(h.amount)}</td>
                    <td className="py-3 capitalize">{h.method}</td>
                    <td className="py-3"><span className={`badge status-${h.status}`}>{h.status}</span></td>
                  </tr>
                ))}
                {!history.length && (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-500 text-sm">No withdrawals yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
