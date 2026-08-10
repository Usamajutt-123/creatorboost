'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, CheckCircle, XCircle, Clock } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

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

export default function WithdrawPage() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('paypal');
  const [account, setAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [minWithdraw, setMinWithdraw] = useState(10);
  const [methods, setMethods] = useState<MethodConfig[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(p);
      const { data: w } = await supabase.from('withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      setHistory(w || []);
      const { data: settings } = await supabase.from('platform_settings').select('min_withdrawal').single();
      if (settings) setMinWithdraw(settings.min_withdrawal);
      // Only show enabled methods
      const { data: m } = await supabase
        .from('withdrawal_method_config')
        .select('*')
        .eq('enabled', true)
        .order('sort_order');
      setMethods((m || []) as MethodConfig[]);
      if (m && m.length > 0) setMethod(m[0].method);
    };
    load();
  }, []);

  const selectedMethodConfig = methods.find(m => m.method === method);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt < minWithdraw) { toast.error(`Minimum withdrawal is $${minWithdraw}`); return; }
    if (amt > (profile?.available_balance || 0)) { toast.error('Insufficient balance'); return; }
    if (!account.trim()) { toast.error('Please enter your account details'); return; }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('request_withdrawal', {
      p_user_id: profile.id,
      p_amount: amt,
      p_method: method,
      p_account_details: { account },
    });

    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (data && !data.success) { toast.error(data.error || 'Failed'); return; }
    toast.success('Withdrawal request submitted!');
    setAmount(''); setAccount('');
    const { data: w } = await supabase.from('withdrawals').select('*').eq('user_id', profile.id).order('created_at', { ascending: false });
    setHistory(w || []);
    const { data: p } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
    setProfile(p);
    router.refresh();
  };

  return (
    <>
      <DashboardTopbar title="Withdraw" subtitle={`Minimum withdrawal: ${formatCurrency(minWithdraw)}`} />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-strong rounded-2xl p-6">
            <h3 className="font-semibold mb-4">Request Withdrawal</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Amount (USD)</label>
                <input type="number" step="0.01" min={minWithdraw} value={amount} onChange={e => setAmount(e.target.value)} className="input-field" placeholder="Enter amount" />
                <p className="text-xs text-gray-500 mt-1">Available: <span className="text-white font-semibold">{formatCurrency(profile?.available_balance || 0)}</span></p>
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
                    Min: ${selectedMethodConfig.min_amount} Â· Max: ${selectedMethodConfig.max_amount}
                    {selectedMethodConfig.fee_percentage > 0 && ` Â· Fee: ${selectedMethodConfig.fee_percentage}%`}
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
              <div className="text-xs text-gray-400 mb-1">Pending</div>
              <div className="text-3xl font-bold text-yellow-400">{formatCurrency(profile?.pending_balance || 0)}</div>
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