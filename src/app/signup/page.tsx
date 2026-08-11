'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, Mail, Lock, User, Globe2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

function SignupContent() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get('ref');

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', country: 'US' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: `${form.firstName} ${form.lastName}`,
          username: form.email.split('@')[0],
          country_code: form.country,
          referral_code: ref,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Account created! Please verify your email.');
    router.push('/verify-email');
  };

  const handleGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 relative py-12">
      <div className="blob w-96 h-96 bg-purple-600/30 -top-20 -right-20 animate-float" />
      <div className="blob w-96 h-96 bg-pink-500/20 -bottom-20 -left-20 animate-float" style={{ animationDelay: '-2s' }} />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
          </Link>
        </div>
        <div className="glass-strong rounded-2xl p-8 card-glow">
          <h2 className="font-display text-2xl font-bold mb-1">Create your account</h2>
          <p className="text-sm text-gray-400 mb-6">Start earning in less than 2 minutes</p>
          {ref && (
            <div className="mb-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-300">
              🎁 You were referred! You&apos;ll get bonus benefits.
            </div>
          )}
          <button onClick={handleGoogle} className="w-full btn-ghost py-3 rounded-xl flex items-center justify-center gap-2 mb-4 text-sm font-medium">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign up with Google
          </button>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-gray-500">OR</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">First name</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} className="input-field pl-10" placeholder="John" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Last name</label>
                <input required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className="input-field" placeholder="Doe" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-field pl-10" placeholder="you@example.com" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Country</label>
              <div className="relative">
                <Globe2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="input-field pl-10 appearance-none">
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="PK">Pakistan</option>
                  <option value="IN">India</option>
                  <option value="DE">Germany</option>
                  <option value="CA">Canada</option>
                  <option value="AU">Australia</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="password" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="input-field pl-10" placeholder="At least 8 characters" />
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs text-gray-400">
              <input type="checkbox" required className="mt-0.5 rounded" />
              <span>I agree to the <Link href="/terms" className="text-purple-400">Terms</Link> and <Link href="/privacy" className="text-purple-400">Privacy Policy</Link></span>
            </label>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-sm text-gray-400 mt-6">Already have an account? <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium">Sign in</Link></p>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupContent />
    </Suspense>
  );
}
