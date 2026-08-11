'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, Lock, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

/**
 * Password reset page. Supabase emails a link that carries a one-time
 * code; we exchange it for a session, then let the user set a new password.
 */
function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exchanging, setExchanging] = useState(true);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = params.get('code');
    const exchange = async () => {
      const supabase = createClient();
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          toast.error('This reset link is invalid or has expired.');
          setExchanging(false);
          return;
        }
      } else {
        // No code -> require an existing session (e.g. link already used).
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast.error('Invalid or missing reset token. Request a new reset link.');
          setExchanging(false);
          return;
        }
      }
      setExchanging(false);
      setReady(true);
    };
    exchange();
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password updated. Please sign in.');
    router.push('/login');
  };

  return (
    <div className="glass-strong rounded-2xl p-8 card-glow text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4">
        <Lock className="w-7 h-7 text-white" />
      </div>
      <h2 className="font-display text-2xl font-bold mb-2">Set a new password</h2>
      <p className="text-sm text-gray-400 mb-6">Enter your new password below.</p>

      {exchanging ? (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-6">
          <Loader2 className="w-5 h-5 animate-spin" /> Verifying your reset link...
        </div>
      ) : !ready ? (
        <div className="py-4">
          <p className="text-sm text-red-300 mb-4">We couldn&apos;t verify this reset link.</p>
          <Link href="/forgot-password" className="btn-primary inline-block px-5 py-3 rounded-xl text-sm font-semibold text-white">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                 className="input-field" placeholder="New password (min 8 characters)" />
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                 className="input-field" placeholder="Confirm new password" />
          <button type="submit" disabled={loading}
                  className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      )}
      <p className="text-sm text-gray-400 mt-6"><Link href="/login" className="text-purple-400">← Back to sign in</Link></p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
          </Link>
        </div>
        <Suspense fallback={<div className="glass-strong rounded-2xl p-8 text-center text-gray-400">Loading...</div>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
