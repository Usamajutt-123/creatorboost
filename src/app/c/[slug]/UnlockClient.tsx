'use client';
import { useState, useEffect } from 'react';
import { Check, Lock, Unlock, Loader2, AlertCircle, Shield, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';

const TASK_LABELS: Record<string, { name: string; icon: string; url: string }> = {
  youtube_subscribe: { name: 'Subscribe to YouTube channel', icon: '▶️', url: 'https://youtube.com/' },
  youtube_like: { name: 'Like the YouTube video', icon: '👍', url: 'https://youtube.com/' },
  youtube_comment: { name: 'Comment on the YouTube video', icon: '💬', url: 'https://youtube.com/' },
  watch_video: { name: 'Watch the full YouTube video', icon: '🎬', url: 'https://youtube.com/' },
  instagram_follow: { name: 'Follow on Instagram', icon: '📷', url: 'https://instagram.com/' },
  tiktok_follow: { name: 'Follow on TikTok', icon: '🎵', url: 'https://tiktok.com/' },
  telegram_join: { name: 'Join Telegram channel', icon: '✈️', url: 'https://t.me/' },
  discord_join: { name: 'Join Discord server', icon: '🎮', url: 'https://discord.gg/' },
  facebook_follow: { name: 'Follow on Facebook', icon: '📘', url: 'https://facebook.com/' },
  twitter_follow: { name: 'Follow on X (Twitter)', icon: '🐦', url: 'https://x.com/' },
  website_visit: { name: 'Visit the website', icon: '🌐', url: '' },
  file_download: { name: 'Download the app', icon: '📥', url: '' },
  custom: { name: 'Complete custom task', icon: '⚙️', url: '' },
};

type Step = 'tasks' | 'verifying' | 'complete' | 'error';

export default function UnlockClient({ campaign }: { campaign: any }) {
  const router = useRouter();
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('tasks');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // One idempotency key per page load -> a replayed request cannot create
  // a second earning.
  useEffect(() => {
    setIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
  }, []);

  const tasks: string[] = campaign.tasks || ['website_visit'];
  const totalSteps = tasks.length;
  const completedCount = completed.size;
  const allComplete = completedCount === totalSteps;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const getTaskUrl = (taskId: string): string => {
    if (taskId === 'custom') {
      const meta = campaign.task_metadata?.custom;
      return meta?.url || '';
    }
    return TASK_LABELS[taskId]?.url || '';
  };

  const getTaskName = (taskId: string): string => {
    if (taskId === 'custom') {
      const meta = campaign.task_metadata?.custom;
      return meta?.title || 'Complete custom task';
    }
    return TASK_LABELS[taskId]?.name || taskId;
  };

  const completeTask = (task: string) => {
    if (completed.has(task)) return;
    const url = getTaskUrl(task);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(campaign.name)}`;
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
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
      const fp = `${navigator.userAgent}-${navigator.language}-${screen.width}x${screen.height}`;

      // NOTE: the client sends only campaignId + non-financial signals.
      // creatorId, country, CPM, fraud score and the valid/invalid decision
      // are all determined server-side.
      const res = await fetch('/api/views/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          deviceFingerprint: fp,
          userAgent: navigator.userAgent,
          tasksCompleted: Array.from(completed),
          idempotencyKey: idempotencyKey || undefined,
        }),
      });

      clearInterval(interval);
      setProgress(100);
      let data: any = {};
      try { data = await res.json(); } catch { /* ignore */ }

      if (!res.ok) { setError(data.error || 'Verification failed'); setStep('error'); return; }

      if (data.valid) {
        setStep('complete');
        setTimeout(() => {
          router.push(`/destination/${campaign.slug || campaign.id}`);
        }, 1200);
      } else {
        setError(
          data.duplicate
            ? 'This visit was already counted. You can still proceed to the reward.'
            : `This visit could not be verified. Please try again from a different network.`
        );
        setStep('error');
      }
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
                    const taskName = getTaskName(t);
                    const taskUrl = getTaskUrl(t);
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
                        <span className="text-xl flex-shrink-0">{TASK_LABELS[t]?.icon || '⚙️'}</span>
                        <span className="text-sm font-medium flex-1 text-left truncate">{taskName}</span>
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
                  Tasks are confirmed in your browser. Traffic is verified on our servers before a reward is unlocked.
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
                <p className="text-sm text-gray-400">Redirecting to your reward...</p>
              </div>
            )}

            {step === 'error' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="font-semibold text-xl mb-2 text-red-400">Verification Failed</h3>
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
