'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { Zap, Mail } from 'lucide-react';


export default function VerifyEmailPage() {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, v: string) => {
    if (v && i < 5) inputs.current[i + 1]?.focus();
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="glass-strong rounded-2xl p-8 card-glow">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-white" />
          </div>
          <h2 className="font-display text-2xl font-bold mb-2">Verify your email</h2>
          <p className="text-sm text-gray-400 mb-6">We&apos;ve sent a 6-digit code to your email. Enter it below to continue.</p>
          <div className="flex justify-center gap-2 mb-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <input
                key={i}
                ref={el => { inputs.current[i] = el; }}
                maxLength={1}
                onChange={e => handleChange(i, e.target.value)}
                className="input-field w-12 h-14 text-center text-2xl font-bold"
              />
            ))}
          </div>
          <Link href="/dashboard" className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white inline-block">
            Verify &amp; Continue
          </Link>
          <p className="text-xs text-gray-500 mt-4">Didn&apos;t receive the code? <a href="#" className="text-purple-400">Resend</a></p>
        </div>
      </div>
    </div>
  );
}
