'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Zap, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
    toast.success('Reset link sent!');
  };

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
        <div className="glass-strong rounded-2xl p-8 card-glow text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h2 className="font-display text-2xl font-bold mb-2">Forgot password?</h2>
          <p className="text-sm text-gray-400 mb-6">Enter your email and we&apos;ll send you a reset link.</p>
          {sent ? (
            <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-300">
              ✓ Check your email for the reset link
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="you@example.com" />
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          )}
          <p className="text-sm text-gray-400 mt-6"><Link href="/login" className="text-purple-400">← Back to sign in</Link></p>
        </div>
      </div>
    </div>
  );
}
