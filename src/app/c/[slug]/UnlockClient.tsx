'use client';
import { useState, useEffect, useCallback } from 'react';
import { Check, Lock, Unlock, Loader2, AlertCircle, Shield, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getTaskUrl, getTaskName, getTaskHostname, TASK_DEFINITIONS, type ViewCheckCategory } from '@/lib/tasks';

type Step = 'tasks' | 'verifying' | 'complete' | 'error';

/**
 * Persistent per-device identifier.
 *
 * The previous implementation derived the "fingerprint" from
 * userAgent + language + screen size, which is identical for many real
 * visitors — so two different people on the same browser/language/screen
 * collided and the second one was wrongly rejected as a "duplicate
 * device". A random per-browser id (kept in localStorage) makes the
 * signal actually device-specific. The server still treats it as an
 * untrusted signal only: earnings, caps, IP checks and idempotency are
 * all decided server-side.
 */
function getDeviceId(): string {
  try {
    const KEY = 'cb_device_id';
    const existing = window.localStorage.getItem(KEY);
    if (existing && existing.length >= 16) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private mode etc.) — fall back to a
    // per-page random id; server-side IP checks still apply.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Client-safe, honest copy for the outcome of the server-side traffic check. */
const CHECK_NOTES: Partial<Record<ViewCheckCategory, string>> = {
  duplicate: 'This visit was already counted. Your reward is unlocked — the creator earns once per verified visit.',
  traffic: 'Your reward is unlocked. Note: our automated traffic check did not credit this visit for earnings (common with VPNs, repeat visits from one network, or automated browsers).',
};

export default function UnlockClient({ campaign }: { campaign: any }) {
  const router = useRouter();
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('tasks');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // One idempotency key per page load -> a replayed request cannot create
  // a second earning.
  useEffect(() => {
    setIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
  }, []);

  const taskMetadata = campaign.task_metadata || {};

  const tasks: string[] = campaign.tasks || ['website_visit'];
  const totalSteps = tasks.length;
  const completedCount = completed.size;
  const allComplete = completedCount === totalSteps;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  // The task destination comes EXCLUSIVELY from the campaign row the
  // creator saved in Supabase (campaigns.task_metadata[taskId].url).
  // There is deliberately NO fallback URL: no YouTube, no Google search,
  // no default destination. If a legacy task has no stored URL it is
  // completed in place without opening anything.
  const getTaskUrlFor = useCallback(
    (taskId: string): string => getTaskUrl(taskId, taskMetadata),
    [taskMetadata],
  );

  const completeTask = (task: string) => {
    if (completed.has(task)) return;
    const url = getTaskUrlFor(task);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setCompleted(prev => new Set([...prev, task]));
  };

  const requestUnlock = async () => {
    if (!allComplete) return;
    setStep('verifying');
    setProgress(0);

    const interval = setInterval(() => {
      setProgress(p => Math.min(p + 8, 90));
    }, 200);

    try {
      // NOTE: the client sends only campaignId + non-financial signals.
      // creatorId, country, CPM, fraud score and the valid/invalid decision
      // are all determined server-side.
      const res = await fetch('/api/views/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          deviceFingerprint: getDeviceId(),
          userAgent: navigator.userAgent,
          tasksCompleted: Array.from(completed),
          idempotencyKey: idempotencyKey || undefined,
        }),
      });

      clearInterval(interval);
      setProgress(100);
      let data: any = {};
      try { data = await res.json(); } catch { /* ignore */ }

      // Real request failures (rate limited, campaign gone, server error)
      // are genuine errors and keep the error state.
      if (!res.ok) {
        setError(data.error || 'Could not complete the request. Please try again.');
        setStep('error');
        return;
      }

      // The unlock contract: the visitor opened every configured task URL
      // (confirmed in the browser, per product design). The server-side
      // traffic check decides EARNINGS only — a flagged visit is recorded
      // honestly as invalid and never credited, but it does not fake or
      // block the reward, and it never shows a false "Verification
      // Failed" for a visitor who completed legitimate tasks.
      const check: ViewCheckCategory = data.check || 'error';
      if (check === 'campaign' || check === 'error') {
        setError(
          check === 'campaign'
            ? 'This campaign is no longer available.'
            : 'We could not verify this visit. Please try again.',
        );
        setStep('error');
        return;
      }

      setNotice(CHECK_NOTES[check] || '');
      setStep('complete');
      setTimeout(() => {
        router.push(`/destination/${campaign.slug || campaign.id}`);
      }, 1600);
    } catch {
      clearInterval(interval);
      setError('Network error. Please try again.');
      setStep('error');
    }
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 py-12 relative">
      <div className="blob w-96 h-96 bg-purple-600/30 -top-20 -left-20 animate-float" />
      <div className="blob w-96 h-96 bg-blue-600/30 -bottom-20 -right-20 animate-float" style={{ animationDelay: '-3s' }} />

      <div className="relative w-full max-w-2xl">
        <div className="text-center mb-6">
          <a href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Unlock className="w-6 h-6 text-white" />
            </div>
            <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
          </a>
        </div>

        <div className="glass-strong rounded-2xl overflow-hidden card-glow shadow-2xl">
          {campaign.banner_url && (
            <div className="relative h-40 sm:h-48 bg-gradient-to-br from-purple-900/30 to-blue-900/30 overflow-hidden">
              <img src={campaign.banner_url} alt={campaign.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" />
            </div>
          )}

          <div className="p-5 sm:p-7">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-5">
              {campaign.thumbnail_url && (
                <img src={campaign.thumbnail_url} alt={campaign.name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover flex-shrink-0 border border-white/10" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold mb-1 leading-tight">{campaign.name}</h1>
                {campaign.description && <p className="text-xs sm:text-sm text-gray-400">{campaign.description}</p>}
              </div>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-400">Progress</span>
                <span className="font-semibold text-purple-300">{completedCount} / {totalSteps} ({progressPct}%)</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {step === 'tasks' && (
              <>
                <div className="mb-4 p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center gap-2 text-xs sm:text-sm text-purple-300">
                  <Lock className="w-4 h-4 flex-shrink-0" />
                  <span>Complete each task (opens in a new tab) to unlock the content.</span>
                </div>
                <div className="space-y-2.5 mb-5">
                  {tasks.map((t, i) => {
                    const done = completed.has(t);
                    const taskName = getTaskName(t, taskMetadata);
                    const taskUrl = getTaskUrlFor(t);
                    const hostname = getTaskHostname(taskUrl);
                    return (
                      <button
                        key={`${t}-${i}`}
                        onClick={() => completeTask(t)}
                        className={`w-full p-3 sm:p-4 rounded-xl flex items-center gap-3 transition border ${
                          done
                            ? 'bg-green-500/10 border-green-500/40 text-green-300'
                            : 'glass hover:bg-white/5 border-white/10 hover:border-purple-500/40'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          done ? 'bg-green-500' : 'bg-gradient-to-br from-purple-500/30 to-blue-500/30'
                        }`}>
                          {done ? <Check className="w-4 h-4 text-white" /> : <span className="text-sm font-semibold">{i + 1}</span>}
                        </div>
                        <span className="text-xl flex-shrink-0">{TASK_DEFINITIONS[t]?.icon || '⚙️'}</span>
                        <span className="flex-1 min-w-0 text-left">
                          <span className="text-sm font-medium block truncate">{taskName}</span>
                          {hostname && !done && (
                            <span className="text-[11px] text-gray-500 block truncate">{hostname}</span>
                          )}
                        </span>
                        {done ? (
                          <span className="text-xs text-green-400 flex items-center gap-1 flex-shrink-0">
                            <Check className="w-3 h-3" /> Done
                          </span>
                        ) : taskUrl ? (
                          <ExternalLink className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={requestUnlock}
                  disabled={!allComplete}
                  className="btn-primary w-full py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Unlock className="w-4 h-4" />
                  {allComplete ? 'Unlock Now' : `Complete ${totalSteps - completedCount} more step${totalSteps - completedCount > 1 ? 's' : ''}`}
                </button>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <Shield className="w-3 h-3" />
                  Task clicks are confirmed in your browser. Views are checked on our servers for earnings.
                </div>
              </>
            )}

            {step === 'verifying' && (
              <div className="text-center py-8">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-purple-400 animate-spin" />
                <h3 className="font-semibold mb-2">Verifying your view...</h3>
                <p className="text-sm text-gray-400 mb-6">Please wait while we check the traffic</p>
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
                <h3 className="font-semibold text-xl mb-2 text-green-400">Unlocked! 🎉</h3>
                <p className="text-sm text-gray-400 mb-6">Redirecting to your reward...</p>
                {notice && (
                  <div className="mx-auto max-w-md p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300/90 text-left">
                    {notice}
                  </div>
                )}
              </div>
            )}

            {step === 'error' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="font-semibold text-xl mb-2 text-red-400">Unable to Unlock</h3>
                <p className="text-sm text-gray-400 mb-6">{error}</p>
                <button onClick={() => { setStep('tasks'); setError(''); }} className="btn-ghost px-5 py-2.5 rounded-xl text-sm">
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Powered by <a href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</a>
        </p>
      </div>
    </div>
  );
}
