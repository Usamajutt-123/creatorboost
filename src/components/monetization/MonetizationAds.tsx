'use client';

/**
 * Renders admin-configured monetization ad slots on the public task page and
 * flow step pages.
 *
 * RULES (mirrors the product's ad policy):
 *   - Ads are OPTIONAL and independent of task completion and navigation.
 *     No "click the ad to continue" text ever appears.
 *   - Display formats render in sandboxed iframes; gesture formats
 *     (popunder / onclick / vignette) run once from the visitor's own
 *     primary action (task click / Continue click) inside a sandboxed,
 *     opaque-origin frame.
 *   - Only the slots the server resolved for this page + device are loaded;
 *     no other network scripts are ever injected.
 *   - A failing ad can never block the page: every render path is guarded.
 *   - Test-mode placeholders are labeled boxes; no third-party code loads.
 */

import { useCallback, useRef } from 'react';
import { AdFrame, mountSandboxedPopunder } from '@/components/PlatformAdSlot';
import {
  isGestureFormat,
  AD_FORMAT_LABELS,
  type PublicAdSlot,
} from '@/lib/monetization/ad-constants';

const NETWORK_LABELS: Record<string, string> = {
  adsterra: 'Adsterra',
  monetag: 'Monetag',
  custom: 'Custom network',
  placeholder: 'Placeholder',
};

function seenKey(slot: PublicAdSlot): string {
  return `creatorboost_ad:${slot.key}`;
}

function wasShownThisSession(slot: PublicAdSlot): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(seenKey(slot)) === '1';
  } catch {
    return false;
  }
}

function markShownThisSession(slot: PublicAdSlot): void {
  try {
    window.sessionStorage.setItem(seenKey(slot), '1');
  } catch {
    // Storage unavailable — frequency capping degrades gracefully.
  }
}

function DisplaySlot({ slot }: { slot: PublicAdSlot }) {
  if (slot.placeholder) {
    return (
      <section className="glass rounded-2xl p-3 sm:p-4 mt-3 min-w-0 max-w-full overflow-hidden" aria-label="Test advertisement placeholder">
        <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Test advertisement</span>
          <span className="text-[10px] text-amber-400/80">Placeholder · no real ad loads</span>
        </div>
        <div className="h-[100px] sm:h-[120px] rounded-lg border border-dashed border-white/15 bg-black/20 flex flex-col items-center justify-center gap-1 text-center px-4">
          <span className="text-xs font-semibold text-gray-300">
            {NETWORK_LABELS[slot.network] || slot.network} — {AD_FORMAT_LABELS[slot.format] || slot.format}
          </span>
          <span className="text-[11px] text-gray-500">This box represents the ad placement in test mode.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl p-3 sm:p-4 mt-3 min-w-0 max-w-full overflow-hidden" aria-label="Advertisement">
      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Advertisement</span>
        <span className="text-[10px] text-gray-600 truncate">
          {NETWORK_LABELS[slot.network] || slot.network} · {AD_FORMAT_LABELS[slot.format] || slot.format}
        </span>
      </div>
      <AdFrame
        ad={{ code: slot.code, url: slot.url }}
        title={`${NETWORK_LABELS[slot.network] || 'Network'} advertisement`}
        allowPopups={false}
      />
    </section>
  );
}

/**
 * Renders the display slots for one vertical position on the page.
 */
export function MonetizationAds({
  slots,
  position,
}: {
  slots: PublicAdSlot[];
  position: 'top' | 'middle' | 'bottom';
}) {
  const visible = slots.filter(slot => !isGestureFormat(slot.format) && slot.placement === position);
  if (visible.length === 0) return null;
  return (
    <div className="min-w-0 max-w-full">
      {visible.map(slot => (
        <DisplaySlot key={slot.key} slot={slot} />
      ))}
    </div>
  );
}

/**
 * Returns a callback the caller MUST invoke from its primary visitor action
 * (opening a task, clicking Continue). It runs the page's gesture-format
 * slots (popunder / onclick / vignette) at most once per browser session
 * when frequency=once_per_session is configured. It never blocks the
 * caller's own action: ad code failures are swallowed.
 */
export function useGestureAdTrigger(slots: PublicAdSlot[]) {
  const gestureSlots = slots.filter(slot => isGestureFormat(slot.format));
  const firedRef = useRef<Set<string>>(new Set());

  return useCallback(() => {
    for (const slot of gestureSlots) {
      if (slot.frequency === 'once_per_session' && wasShownThisSession(slot)) continue;
      if (firedRef.current.has(slot.key)) continue;
      firedRef.current.add(slot.key);
      try {
        if (slot.placeholder) {
          // Test mode: gesture formats never open anything.
          markShownThisSession(slot);
          continue;
        }
        if (slot.code) {
          mountSandboxedPopunder(slot.code);
          markShownThisSession(slot);
          continue;
        }
        if (slot.url) {
          const popup = window.open(slot.url, '_blank', 'noopener,noreferrer');
          try {
            if (popup) popup.opener = null;
          } catch {
            // Cross-origin popup access is intentionally best-effort only.
          }
          markShownThisSession(slot);
        }
      } catch {
        // A third-party ad failure must never interrupt the visitor flow.
      }
    }
  }, [gestureSlots]);
}
