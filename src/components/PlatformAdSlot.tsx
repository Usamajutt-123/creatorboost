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

function AdFrame({
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
 * Appends trusted, administrator-configured popunder markup only after the
 * visitor begins the first task. Re-creating script nodes makes standard ad
 * network snippets execute; `dangerouslySetInnerHTML` would leave scripts
 * inert. This is intentionally reserved for platform-admin code, never
 * campaign data.
 */
function mountTrustedPopunderMarkup(markup: string): () => void {
  const host = document.createElement('div');
  host.hidden = true;
  host.dataset.creatorboostPlatformAd = 'popunder';

  const template = document.createElement('template');
  template.innerHTML = markup;
  host.append(template.content.cloneNode(true));

  // Scripts inserted via template/innerHTML do not execute. Replacing each
  // one with a newly created script preserves network attributes and allows
  // the configured provider's approved snippet to run from the click event.
  for (const oldScript of Array.from(host.querySelectorAll('script'))) {
    const script = document.createElement('script');
    for (const attribute of oldScript.getAttributeNames()) {
      script.setAttribute(attribute, oldScript.getAttribute(attribute) || '');
    }
    if (!oldScript.src) script.text = oldScript.text || oldScript.textContent || '';
    oldScript.replaceWith(script);
  }

  document.body.append(host);
  return () => host.remove();
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
        cleanupRef.current = mountTrustedPopunderMarkup(placement.code);
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
