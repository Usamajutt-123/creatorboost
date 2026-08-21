'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Loader2, Lock, Shield, Unlock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { configuredTaskUrl, isTaskType, TASK_DETAILS, taskDisplayName, type TaskMetadata } from '@/lib/tasks';
import { PlatformBannerAd, usePlatformPopunder } from '@/components/PlatformAdSlot';
import { MonetizationAds, useGestureAdTrigger } from '@/components/monetization/MonetizationAds';
import type { PublicPlatformAds } from '@/lib/platform-ads';
import type { PublicAdSlot } from '@/lib/monetization/ad-constants';

type Step = 'tasks' | 'verifying' | 'complete' | 'error';

type PublicCampaign = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  banner_url?: string | null;
  thumbnail_url?: string | null;
  tasks: string[];
  task_metadata?: TaskMetadata | null;
};

export default function UnlockClient({ campaign, platformAds, taskSession, monetizationAds }: {
  campaign: PublicCampaign;
  platformAds: PublicPlatformAds;
  /**
   * Short-lived, server-issued token binding this task list to this campaign
   * and this task configuration. The browser only relays it; it cannot mint
   * or alter one.
   */
  taskSession: string | null;
  /** Admin-configured monetization ad slots for the task page. */
  monetizationAds?: PublicAdSlot[];
}) {
  const router = useRouter();
  const tasks = useMemo(() => (campaign.tasks || []).filter(isTaskType), [campaign.tasks]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('tasks');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const triggerPopunder = usePlatformPopunder(platformAds.popunder);
  const triggerGestureAds = useGestureAdTrigger(monetizationAds || []);
  const ads = monetizationAds || [];
  // When this visitor started the flow. Sent as a timing hint the server may
  // use to LOWER trust (impossible completion speed); the server clock is
  // authoritative and an implausible value is simply discarded.
  const startedAtRef = useRef<number>(Date.now());

  // Funnel bookkeeping: this page load is a task-page visit ("link click").
  // Fire-and-forget, once per browser session, never blocks rendering.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('creatorboost_task_start_sent') === '1') return;
      window.sessionStorage.setItem('creatorboost_task_start_sent', '1');
      void fetch('/api/flow/task-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id }),
      }).catch(() => {});
    } catch {
      // Storage unavailable — the counter simply isn't recorded this session.
    }
  }, [campaign.id]);

  const totalSteps = tasks.length;
  const completedCount = completed.size;
  const allComplete = totalSteps > 0 && completedCount === totalSteps;
  const progressPct = totalSteps ? Math.round((completedCount / totalSteps) * 100) : 0;
  const configurationValid = totalSteps > 0 && tasks.every(task => configuredTaskUrl(campaign.task_metadata, task));

  const completeTask = (taskId: string) => {
    if (completed.has(taskId)) return;
    const url = configuredTaskUrl(campaign.task_metadata, taskId);
    if (!url) {
      setError('This task has no valid URL. Ask the creator to update the campaign.');
      return;
    }
    // A platform-owned popunder may run once from this visitor gesture. It is
    // independent of creator campaign data and cannot change task completion.
    triggerPopunder();
    // Monetized task-page gesture ads (popunder/onclick/vignette) run from
    // this same visitor gesture — optional, once per session, never required.
    triggerGestureAds();
    // This is intentionally the exact persisted creator URL. No platform
    // default, YouTube fallback, or search redirect is ever substituted.
    window.open(url, '_blank', 'noopener,noreferrer');
    setCompleted(previous => new Set([...previous, taskId]));
  };

  const requestUnlock = async () => {
    if (!allComplete || !configurationValid) return;
    setStep('verifying');
    setProgress(0);
    const interval = window.setInterval(() => setProgress(value => Math.min(value + 8, 90)), 180);

    try {
      const requestKey = idempotencyKey || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      if (!idempotencyKey) setIdempotencyKey(requestKey);
      const fingerprint = `${navigator.userAgent}-${navigator.language}-${screen.width}x${screen.height}`;
      const response = await fetch('/api/views/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          deviceFingerprint: fingerprint,
          tasksCompleted: tasks,
          idempotencyKey: requestKey,
          startedAt: startedAtRef.current,
          ...(taskSession ? { taskSession } : {}),
        }),
      });
      window.clearInterval(interval);
      setProgress(100);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.unlocked) {
        setError(data.error || 'We could not unlock this campaign. Please try again.');
        setStep('error');
        return;
      }

      // The server decides where the visitor goes next: the monetized flow
      // (/go/...) when enabled, the destination page otherwise. The path is
      // a server-issued relative route — the browser never composes it.
      const nextPath = typeof data.next === 'string' && /^\/(go|destination)\//.test(data.next)
        ? data.next
        : `/destination/${campaign.slug}`;

      setStep('complete');
      window.setTimeout(() => router.push(nextPath), 1_500);
    } catch {
      window.clearInterval(interval);
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    }
  };

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
          {campaign.banner_url && <div className="relative h-40 sm:h-48 bg-gradient-to-br from-purple-900/30 to-blue-900/30 overflow-hidden"><img src={campaign.banner_url} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" /></div>}
          <div className="p-5 sm:p-7">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-5">
              {campaign.thumbnail_url && <img src={campaign.thumbnail_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover flex-shrink-0 border border-white/10" />}
              <div className="flex-1 min-w-0"><h1 className="font-display text-xl sm:text-2xl font-bold mb-1 leading-tight">{campaign.name}</h1>{campaign.description && <p className="text-xs sm:text-sm text-gray-400">{campaign.description}</p>}</div>
            </div>

            <div className="mb-5" aria-label={`Task progress: ${completedCount} of ${totalSteps}`}>
              <div className="flex items-center justify-between text-xs mb-1.5"><span className="text-gray-400">Progress</span><span className="font-semibold text-purple-300">{completedCount} / {totalSteps} ({progressPct}%)</span></div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500" style={{ width: `${progressPct}%` }} /></div>
            </div>

            {step === 'tasks' && <>
              <div className="mb-4 p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-start gap-2 text-xs sm:text-sm text-purple-200"><Lock className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>Open every task in a new tab, then return here to unlock the destination.</span></div>
              {!configurationValid && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">This campaign is missing a task URL and cannot be unlocked until its creator fixes the configuration.</div>}
              <MonetizationAds slots={ads} position="top" />
              <div className="space-y-2.5 mb-5 mt-3">
                {tasks.map((task, index) => {
                  const done = completed.has(task);
                  const url = configuredTaskUrl(campaign.task_metadata, task);
                  const detail = TASK_DETAILS[task];
                  return <button key={task} onClick={() => completeTask(task)} disabled={!url} className={`w-full p-3 sm:p-4 rounded-xl flex items-center gap-3 transition border disabled:cursor-not-allowed ${done ? 'bg-green-500/10 border-green-500/40 text-green-300' : 'glass hover:bg-white/5 border-white/10 hover:border-purple-500/40 disabled:opacity-50'}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500' : 'bg-gradient-to-br from-purple-500/30 to-blue-500/30'}`}>{done ? <Check className="w-4 h-4 text-white" /> : <span className="text-sm font-semibold">{index + 1}</span>}</span>
                    <span className="text-xl" aria-hidden="true">{detail.icon}</span><span className="text-sm font-medium flex-1 text-left truncate">{taskDisplayName(campaign.task_metadata, task)}</span>
                    {done ? <span className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Opened</span> : <ExternalLink className="w-3.5 h-3.5 text-gray-500" />}
                  </button>;
                })}
              </div>
              <MonetizationAds slots={ads} position="middle" />
              <button onClick={requestUnlock} disabled={!allComplete || !configurationValid} className="btn-primary w-full py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"><Unlock className="w-4 h-4" />{allComplete ? 'Unlock now' : `Complete ${totalSteps - completedCount} more step${totalSteps - completedCount === 1 ? '' : 's'}`}</button>
              <MonetizationAds slots={ads} position="bottom" />
              <p className="mt-4 flex items-start justify-center gap-2 text-xs text-gray-500 text-center"><Shield className="w-3 h-3 flex-shrink-0 mt-0.5" />Third-party actions cannot be confirmed by CreatorBoost. Opening each configured URL is confirmed in this browser; traffic eligibility is checked separately for creator earnings.</p>
            </>}

            {step === 'verifying' && <div className="text-center py-8"><Loader2 className="w-12 h-12 mx-auto mb-4 text-purple-400 animate-spin" /><h2 className="font-semibold mb-2">Preparing your unlock…</h2><p className="text-sm text-gray-400 mb-6">Checking the campaign and traffic signals</p><div className="w-full h-2 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} /></div></div>}

            {step === 'complete' && <div className="text-center py-8"><div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-4 animate-pulse-glow"><Check className="w-8 h-8 text-white" /></div><h2 className="font-semibold text-xl mb-2 text-green-400">Destination unlocked</h2><p className="text-sm text-gray-400">Redirecting to the creator&apos;s destination…</p></div>}

            {step === 'error' && <div className="text-center py-8"><div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-8 h-8 text-red-400" /></div><h2 className="font-semibold text-xl mb-2 text-red-400">Could not unlock yet</h2><p className="text-sm text-gray-400 mb-6">{error}</p><button onClick={() => { setStep('tasks'); setError(''); }} className="btn-ghost px-5 py-2.5 rounded-xl text-sm">Try again</button></div>}
          </div>
        </div>
        <PlatformBannerAd ad={platformAds.banner} />
        <p className="text-center text-xs text-gray-500 mt-4">Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</Link></p>
      </main>
    </div>
  );
}
