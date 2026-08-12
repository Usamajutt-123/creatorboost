'use server';

/**
 * Server-side withdrawal request.
 *
 * The money movement is still performed by the `request_withdrawal` RPC,
 * which enforces auth.uid() == p_user_id, account status, method limits,
 * fees, single-pending-withdrawal and balance in the database. This action
 * exists so we can (a) keep the client free of financial logic and
 * (b) send the "withdrawal requested" email server-side, gracefully.
 */

import { createClient } from '@/lib/supabase/server';
import { sendTemplateEmail } from '@/lib/email';

export type WithdrawalRequestInput = {
  amount: number;
  method: string;
  account: string;
};

export async function requestWithdrawalAction(input: WithdrawalRequestInput): Promise<{
  success: boolean;
  error?: string;
  withdrawalId?: string;
  fee?: number;
  total?: number;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Invalid amount' };
  const method = String(input.method || '').trim();
  const account = String(input.account || '').trim();
  if (!method || !account) return { success: false, error: 'Missing method or account details' };
  if (account.length > 500) return { success: false, error: 'Account details too long' };

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_user_id: user.id,
    p_amount: amount,
    p_method: method,
    p_account_details: { account },
  });

  if (error) return { success: false, error: error.message };
  if (!data || data.success !== true) {
    return { success: false, error: data?.error || 'Withdrawal could not be processed' };
  }

  // Notification email — graceful: never fail the withdrawal if email fails.
  try {
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).maybeSingle();
    if (profile?.email) {
      await sendTemplateEmail('withdrawal_requested', profile.email, {
        amount: amount.toFixed(2),
        method,
      });
    }
  } catch (e) {
    console.error('[withdraw] notification email failed', e);
  }

  return {
    success: true,
    withdrawalId: data.withdrawal_id as string | undefined,
    fee: Number(data.fee) || 0,
    total: Number(data.total) || amount,
  };
}
