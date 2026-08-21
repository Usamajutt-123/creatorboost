'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PlatformAdPlacement } from '@/lib/platform-ads';

function adDocument(markup: string): string {
  // The banner is deliberately rendered in a sandboxed document. Platform ad
  // code can do the work an ad network requires without receiving access to
  // the unlock page DOM, task state, or visitor data held by the application.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; min-width: 0; max-width: 100%; overflow: hidden; background: transparent; }
      *, *::before, *::after { box-sizing: border-box; max-width: 100%; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

/**
 * Shared sandboxed renderer for admin-configured ad markup. Exported for the
 * monetized flow pages (/unlock, /go) which reuse the exact same isolation
 * model as the platform banner: opaque-origin iframe, no allow-same-origin,
 * popups permitted where the format requires them.
 */
export function AdFrame({
  ad,
  title,
  allowPopups = true,
}: {
  ad: PlatformAdPlacement;
  title: string;
  allowPopups?: boolean;
}) {
  const source = ad.code ? { srcDoc: adDocument(ad.code) } : { src: ad.url || undefined };

  return (
    <iframe
      {...source}
      title={title}
      sandbox={allowPopups ? 'allow-scripts allow-forms allow-popups' : 'allow-scripts allow-forms'}
      referrerPolicy="strict-origin-when-cross-origin"
      loading="eager"
      className="block w-full h-[100px] sm:h-[120px] max-w-full rounded-lg border-0 bg-transparent"
    />
  );
}

/** Visible, responsive banner placement for a server-resolved platform ad. */
export function PlatformBannerAd({ ad }: { ad: PlatformAdPlacement | null }) {
  if (!ad) return null;

  return (
    <section className="glass rounded-2xl p-3 sm:p-4 mt-4 min-w-0 max-w-full overflow-hidden" aria-label="Advertisement">
      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Advertisement</span>
        <span className="text-[10px] text-gray-600">Sponsored</span>
      </div>
      <AdFrame ad={ad} title="CreatorBoost advertisement" />
    </section>
  );
}

/**
 * Admin-only visual preview. It uses the same sandboxed renderer as the
 * public banner, but never creates a top-level popunder while an operator is
 * editing settings.
 */
export function PlatformAdPreview({
  ad,
  placement,
}: {
  ad: PlatformAdPlacement | null;
  placement: 'banner' | 'popunder';
}) {
  if (!ad) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-center text-xs text-gray-500">
        Add valid code or an http(s) URL to preview this placement.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-purple-500/25 bg-black/20 p-3 min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-300">Preview · {placement}</span>
        <span className="text-[10px] text-gray-500">Sandboxed</span>
      </div>
      <AdFrame ad={ad} title={`Preview of ${placement} advertisement`} allowPopups={false} />
      {placement === 'popunder' && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Popunder code is shown in an isolated frame here. On the unlock page it runs once when a visitor starts their first task.
        </p>
      )}
    </div>
  );
}

/**
 * Mounts administrator-configured popunder markup inside a SANDBOXED,
 * hidden iframe.
 *
 * WHAT CHANGED AND WHY
 * The previous implementation injected the configured markup into the unlock
 * page's own document and re-created every `<script>` node so it would
 * execute — on the MAIN ORIGIN, with full access to `document`, `cookie`,
 * `localStorage`, the visitor's session and the application's own fetch
 * origin. The banner placement was already sandboxed; the popunder was the
 * asymmetry. That meant an arbitrary third-party snippet (or a compromised /
 * careless admin settings value) could read creator campaign data off the
 * page, call the application's APIs with the visitor's cookies, or rewrite
 * the task links.
 *
 * The popunder now runs in the same isolation the banner already used:
 *
 *   * `srcdoc` iframe -> a unique opaque origin, so no access to the parent
 *     document, its cookies, its storage or its DOM,
 *   * `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`
 *     -> the snippet can still run and still open its popunder window, which
 *     is the entire required behaviour,
 *   * NO `allow-same-origin` -> this is what makes the isolation real.
 *
 * The advertising functionality is preserved: the frame is created from the
 * visitor's task click, so the browser still attributes the popup to a user
 * gesture, and popup policy applies exactly as before.
 */
/**
 * Mounts admin-configured ad markup inside a SANDBOXED hidden iframe (opaque
 * origin — no allow-same-origin) so popunder/onclick/vignette snippets can
 * run and open their windows without any access to the page DOM, cookies or
 * storage. Exported for the monetized flow pages.
 */
export function mountSandboxedPopunder(markup: string): () => void {
  const frame = document.createElement('iframe');
  frame.setAttribute(
    'sandbox',
    // Deliberately WITHOUT allow-same-origin: the frame must stay in an
    // opaque origin or the sandbox provides no isolation at all.
    'allow-scripts allow-popups allow-popups-to-escape-sandbox',
  );
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.creatorboostPlatformAd = 'popunder';
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px;';
  frame.srcdoc = adDocument(markup);

  document.body.append(frame);
  return () => frame.remove();
}

/**
 * Returns a callback for the normal task-click flow. It never changes task
 * completion or unlock behavior: a URL fallback opens first, and the task's
 * own URL is still opened by the caller immediately afterward.
 */
export function usePlatformPopunder(ad: PlatformAdPlacement | null) {
  const placementRef = useRef(ad);
  const openedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    placementRef.current = ad;
    openedRef.current = false;
    cleanupRef.current?.();
    cleanupRef.current = null;

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [ad]);

  return useCallback(() => {
    const placement = placementRef.current;
    if (!placement || openedRef.current || typeof window === 'undefined') return;

    openedRef.current = true;
    try {
      if (placement.code) {
        cleanupRef.current = mountSandboxedPopunder(placement.code);
        return;
      }

      if (placement.url) {
        // Opening before the task destination makes this a popunder in browsers
        // that focus the most recently opened task tab. Browser popup policy
        // still applies, but the call is made from the visitor's task click.
        const popunder = window.open(placement.url, '_blank', 'noopener,noreferrer');
        try {
          if (popunder) popunder.opener = null;
        } catch {
          // Cross-origin popup access is intentionally best-effort only.
        }
      }
    } catch {
      // A third-party ad failure must never interrupt the normal unlock task.
    }
  }, []);
}
