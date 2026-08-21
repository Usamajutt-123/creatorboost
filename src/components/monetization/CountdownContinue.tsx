'use client';

/**
 * Countdown + Continue control for the monetized flow pages.
 *
 * The countdown shown here is UX only. The server re-validates the elapsed
 * time against the session's step start timestamp in /api/flow/advance, so
 * skipping ahead in the browser can never bypass the wait.
 *
 * The button is a legitimate CreatorBoost navigation action. Ads are never
 * a requirement and never a replacement for it.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock, Loader2 } from 'lucide-react';

export default function CountdownContinue({
  seconds,
  label,
  stepLabel,
  onContinue,
  busyLabel,
}: {
  seconds: number;
  label: string;
  /** e.g. "Step 1 of 4" */
  stepLabel: string;
  onContinue: () => void;
  busyLabel?: string;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(1, Math.min(Math.trunc(seconds), 120)));
  const [busy, setBusy] = useState(false);
  const endAtRef = useRef<number>(0);
  const startRef = useRef(false);

  useEffect(() => {
    if (startRef.current) return;
    startRef.current = true;
    const total = Math.max(1, Math.min(Math.trunc(seconds), 120));
    endAtRef.current = Date.now() + total * 1_000;
    const tick = () => {
      const left = Math.ceil((endAtRef.current - Date.now()) / 1_000);
      setRemaining(Math.max(0, left));
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [seconds]);

  const done = remaining <= 0;

  const handleClick = async () => {
    if (!done || busy) return;
    setBusy(true);
    try {
      await onContinue();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 p-4 sm:p-5 rounded-2xl glass border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{stepLabel}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          {done ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clock className="w-3.5 h-3.5" />}
          {done ? 'Ready' : `Please wait ${remaining} second${remaining === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={seconds} aria-valuenow={seconds - remaining}>
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all duration-300"
            style={{ width: `${((seconds - remaining) / Math.max(seconds, 1)) * 100}%` }}
          />
        </div>
        <span className="text-2xl font-bold font-display tabular-nums text-purple-300 w-10 text-center" aria-live="polite">
          {remaining}
        </span>
      </div>

      <button
        onClick={handleClick}
        disabled={!done || busy}
        className="btn-primary w-full py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {busyLabel || 'Please wait…'}
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>

      <p className="mt-3 text-center text-[11px] text-gray-600">
        Ads on this page are optional and never required to continue.
      </p>
    </div>
  );
}
