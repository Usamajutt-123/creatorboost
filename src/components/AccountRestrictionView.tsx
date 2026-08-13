'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, LifeBuoy, Lock, LogOut, Zap } from 'lucide-react';
import { signOutClient } from '@/lib/supabase/sign-out';

type AccountRestrictionViewProps = {
  variant: 'suspended' | 'banned';
  reason?: string | null;
  supportHref?: string | null;
};

export default function AccountRestrictionView({
  variant,
  reason,
  supportHref,
}: AccountRestrictionViewProps) {
  const router = useRouter();
  const banned = variant === 'banned';

  const handleLogout = async () => {
    await signOutClient();
    router.push('/');
    router.refresh();
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <span className="font-display text-2xl font-bold">
              Creator<span className="gradient-text">Boost</span>
            </span>
          </Link>
        </div>

        <section
          className="glass-strong rounded-2xl p-6 sm:p-8"
          aria-labelledby="account-status-heading"
        >
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
              banned
                ? 'bg-red-500/15 border border-red-500/30'
                : 'bg-amber-500/15 border border-amber-500/30'
            }`}
          >
            {banned ? (
              <Ban className="w-7 h-7 text-red-300" aria-hidden="true" />
            ) : (
              <Lock className="w-7 h-7 text-amber-300" aria-hidden="true" />
            )}
          </div>

          <h1 id="account-status-heading" className="font-display text-2xl font-bold text-center mb-2">
            {banned ? 'Account Permanently Banned' : 'Account Suspended'}
          </h1>
          <p className="text-sm text-gray-300 text-center mb-2">
            {banned
              ? 'Your account has been permanently banned.'
              : 'Your account has been suspended.'}
          </p>
          <p className="text-sm text-gray-400 text-center mb-6">
            {banned
              ? 'This account can no longer access CreatorBoost. Dashboard, campaigns, earnings, and withdrawals are closed.'
              : 'Access to CreatorBoost has been temporarily restricted. You cannot open your dashboard, campaigns, earnings, or withdrawals until access is restored.'}
          </p>

          {reason ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 mb-6">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Reason</p>
              <p className="text-sm text-gray-200 break-words">{reason}</p>
            </div>
          ) : null}

          <div className="space-y-3">
            {supportHref ? (
              <Link
                href={supportHref}
                className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white gap-2"
              >
                <LifeBuoy className="w-4 h-4" aria-hidden="true" />
                Contact Support
              </Link>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              className="btn-ghost w-full py-3 rounded-xl text-sm font-medium gap-2"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
