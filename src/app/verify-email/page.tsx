'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, Mail, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);

  const handleResend = async () => {
    if (!email) { toast.error('Enter your email first'); return; }
    setResending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Confirmation email re-sent!');
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="glass-strong rounded-2xl p-8 card-glow">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-white" />
          </div>
          <h2 className="font-display text-2xl font-bold mb-2">Confirm your email</h2>
          <p className="text-sm text-gray-400 mb-6">
            We sent you a confirmation link. Open it to activate your account, then sign in.
          </p>

          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input-field mb-4"
          />
          <button onClick={handleResend} disabled={resending}
                  className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
            {resending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : 'Resend confirmation email'}
          </button>
          <button onClick={() => router.push('/login')}
                  className="btn-ghost w-full py-3 rounded-xl text-sm mt-3">
            I&apos;ve confirmed — go to sign in
          </button>
          <p className="text-xs text-gray-500 mt-4">Didn&apos;t get it? Check your spam folder.</p>
        </div>
        <div className="mt-4">
          <Link href="/" className="text-purple-400 text-sm">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
