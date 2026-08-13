'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Loader2, Lock, Shield, Unlock, AlertCircle } from 'lucide-react';
import type { TaskMetadata } from '@/lib/tasks';
import { FLOW_LABEL, FLOW_MULTIPLIER, type FlowType } from '@/lib/flow';

type PublicPage = {
  position: number;
  title: string;
  description: string | null;
  image_url: string | null;
  button_text: string | null;
};

type PublicCampaign = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  banner_url?: string | null;
  thumbnail_url?: string | null;
  tasks: string[];
  task_metadata?: TaskMetadata | null;
  flow_type: FlowType;
  pages: PublicPage[];
};

type Step = 'flow' | 'submitting' | 'complete' | 'error';

/**
 * Public custom-page flow renderer. Every page transition is confirmed by
 * the server (`/api/flow/step`) so a visitor who tampers with the URL,
 * refreshes on page 4, or POSTs `page=5` can never earn the multiplier.
 */
export default function FlowClient({ campaign }: { campaign: PublicCampaign }) {
  const router = useRouter();
  const pages = useMemo(() => [...campaign.pages].sort((a, b) => a.position - b.position), [campaign.pages]);
  const total = pages.length;
  const [currentIndex, setCurrentIndex] = useState(0); // 0-based
  const [advancing, setAdvancing] = useState(false);
  const [step, setStep] = useState<Step>('flow');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const currentPage = pages[currentIndex];

  useEffect(() => {
    // Ask the server to open a fresh flow session (issues the step-0 cookie).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/flow/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: campaign.id, action: 'start' }),
        });
        if (!res.ok) throw new Error('flow_start_failed');
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) {
          setError('Flow could not be started. Please refresh and try again.');
          setStep('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [campaign.id]);

  const advance = async () => {
    if (advancing || !ready) return;
    setAdvancing(true);
    try {
      const nextStep = currentIndex + 1;
      const res = await fetch('/api/flow/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, action: 'advance', step: nextStep }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not advance to the next page.');
        setStep('error');
        return;
      }
      if (body.done) {
        setStep('submitting');
        setProgress(0);
        const interval = window.setInterval(() => setProgress(v => Math.min(v + 8, 90)), 180);
        try {
          const requestKey = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
          const fingerprint = `${navigator.userAgent}-${navigator.language}-${screen.width}x${screen.height}`;
          const record = await fetch('/api/views/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignId: campaign.id,
              deviceFingerprint: fingerprint,
              userAgent: navigator.userAgent,
              // Every configured task is auto-satisfied by completing the flow;
              // the server re-verifies the flow completion token.
              tasksCompleted: campaign.tasks,
              idempotencyKey: requestKey,
            }),
          });
          window.clearInterval(interval);
          setProgress(100);
          const data = await record.json().catch(() => ({}));
          if (!record.ok || !data.unlocked) {
            setError(data.error || 'Could not unlock the destination.');
            setStep('error');
            return;
          }
          setStep('complete');
          window.setTimeout(() => router.push(`/destination/${campaign.slug}`), 1_500);
        } catch {
          window.clearInterval(interval);
          setError('Network error. Please try again.');
          setStep('error');
        }
        return;
      }
      setCurrentIndex(nextStep);
    } catch {
      setError('Network error. Please try again.');
      setStep('error');
    } finally {
      setAdvancing(false);
    }
  };

  const progressPct = total > 0 ? Math.round(((currentIndex) / total) * 100) : 0;
  const multiplier = FLOW_MULTIPLIER[campaign.flow_type];

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 py-12 relative">
      <div className="blob w-96 h-96 bg-purple-600/30 -top-20 -left-20 animate-float" aria-hidden="true" />
      <div className="blob w-96 h-96 bg-blue-600/30 -bottom-20 -right-20 animate-float" style={{ animationDelay: '-3s' }} aria-hidden="true" />
      <main className="relative w-full max-w-2xl">
        <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="CreatorBoost home">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center"><Unlock className="w-6 h-6 text-white" /></span>
          <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
        </Link>

        <div className="glass-strong rounded-2xl overflow-hidden card-glow shadow-2xl">
          {campaign.banner_url && (
            <div className="relative h-40 sm:h-48 bg-gradient-to-br from-purple-900/30 to-blue-900/30 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={campaign.banner_url} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" />
            </div>
          )}
          <div className="p-5 sm:p-7">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-5">
              {campaign.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={campaign.thumbnail_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover flex-shrink-0 border border-white/10" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold mb-1 leading-tight">{campaign.name}</h1>
                {campaign.description && <p className="text-xs sm:text-sm text-gray-400">{campaign.description}</p>}
                <p className="text-[11px] mt-2 text-purple-300">{FLOW_LABEL[campaign.flow_type]} · verified {multiplier.toFixed(2)}× flow</p>
              </div>
            </div>

            <div className="mb-5" aria-label={`Flow progress: ${currentIndex + 1} of ${total}`}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-400">Progress</span>
                <span className="font-semibold text-purple-300">Page {Math.min(currentIndex + 1, total)} / {total}</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {step === 'flow' && currentPage && (
              <>
                <div className="mb-4 p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-start gap-2 text-xs sm:text-sm text-purple-200">
                  <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Complete every page in order to unlock the destination. Skipping pages is not allowed.</span>
                </div>

                <article className="glass rounded-xl p-5 space-y-4">
                  <header className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500/40 to-blue-500/40 flex items-center justify-center text-sm font-semibold">{currentPage.position}</span>
                    <h2 className="text-lg font-semibold flex-1 min-w-0 break-words">{currentPage.title}</h2>
                  </header>
                  {currentPage.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentPage.image_url} alt="" className="w-full max-h-64 object-cover rounded-lg border border-white/10" />
                  )}
                  {currentPage.description && (
                    <p className="text-sm text-gray-300 whitespace-pre-line break-words">{currentPage.description}</p>
                  )}
                  <button
                    type="button"
                    onClick={advance}
                    disabled={advancing || !ready}
                    className="btn-primary w-full py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {advancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    {currentPage.button_text?.trim() || (currentIndex + 1 === total ? 'Unlock destination' : 'Continue')}
                  </button>
                </article>

                <p className="mt-4 flex items-start justify-center gap-2 text-xs text-gray-500 text-center">
                  <Shield className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  Page progression is verified server-side. Traffic eligibility is decided independently.
                </p>
              </>
            )}

            {step === 'submitting' && (
              <div className="text-center py-8">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-purple-400 animate-spin" />
                <h2 className="font-semibold mb-2">Preparing your unlock…</h2>
                <p className="text-sm text-gray-400 mb-6">Verifying flow completion</p>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {step === 'complete' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                  <Check className="w-8 h-8 text-white" />
                </div>
                <h2 className="font-semibold text-xl mb-2 text-green-400">Destination unlocked</h2>
                <p className="text-sm text-gray-400">Redirecting…</p>
              </div>
            )}

            {step === 'error' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h2 className="font-semibold text-xl mb-2 text-red-400">Could not unlock yet</h2>
                <p className="text-sm text-gray-400 mb-6">{error}</p>
                <button
                  type="button"
                  onClick={() => { setStep('flow'); setError(''); setCurrentIndex(0); setReady(false); setTimeout(() => window.location.reload(), 200); }}
                  className="btn-ghost px-5 py-2.5 rounded-xl text-sm"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-gray-500 mt-4">Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</Link></p>
      </main>
    </div>
  );
}
