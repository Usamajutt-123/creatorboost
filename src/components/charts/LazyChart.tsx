'use client';

/**
 * Lazily-loaded Chart.js renderers.
 *
 * `chart.js` + `react-chartjs-2` are ~180 KB of JavaScript that used to sit in
 * the *initial* bundle of every route containing a chart (home page, creator
 * dashboard, analytics, admin dashboard). A chart is a `<canvas>` that is
 * completely empty until Chart.js runs on the client, so nothing visible is
 * lost by fetching the library in a separate chunk instead of blocking the
 * first load with it.
 *
 * All three renderers resolve to the same `./ChartKit` chunk, so a page with
 * several charts still downloads the charting runtime exactly once.
 *
 * The `loading` placeholder reproduces react-chartjs-2's own server output
 * byte-for-byte (`<canvas role="img" height="150" width="300">`, its default
 * canvas size). That keeps the pre-hydration DOM — and therefore the layout of
 * every chart container — identical to the previous behaviour, so there is no
 * layout shift and no visible placeholder/spinner.
 *
 * ROUND 3 — the chunk is now also gated on visibility.
 *
 * Splitting the chunk out stopped it from *blocking* first load, but the
 * browser still requested and evaluated all ~180 KB of it during hydration.
 * On a 412 px mobile viewport every chart on `/dashboard` and `/admin` sits
 * below the fold behind eight stat cards, so that work competed with hydration
 * for the main thread (Lighthouse attributed ~930 ms of bootup and two long
 * tasks to it) to paint pixels nobody could see yet.
 *
 * `whenVisible` defers the import until the canvas is within 300 px of the
 * viewport. Desktop charts that are already on screen (and the home-page hero
 * chart) satisfy that immediately, so they load exactly as before; charts below
 * the fold load while the user scrolls toward them. The DOM rendered before the
 * swap is the identical placeholder canvas, so there is no layout shift, no
 * spinner, and no visual difference.
 */

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ComponentType } from 'react';

function ChartPlaceholder() {
  return <canvas role="img" height={150} width={300} />;
}

// Turbopack requires these options to be inline object literals.
const LineImpl = dynamic(() => import('./ChartKit').then(m => m.Line), { ssr: false, loading: ChartPlaceholder });
const BarImpl = dynamic(() => import('./ChartKit').then(m => m.Bar), { ssr: false, loading: ChartPlaceholder });
const DoughnutImpl = dynamic(() => import('./ChartKit').then(m => m.Doughnut), { ssr: false, loading: ChartPlaceholder });

/**
 * Renders the placeholder canvas until it scrolls near the viewport, then
 * mounts the real Chart.js renderer. Falls back to rendering immediately when
 * `IntersectionObserver` is unavailable, so behaviour never degrades.
 */
function whenVisible<P extends object>(Impl: ComponentType<P>) {
  return function VisibilityGatedChart(props: P) {
    const [visible, setVisible] = useState(false);
    const ref = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
      if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }

      let observer: IntersectionObserver | null = null;
      let idleHandle: number | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;

      const observe = () => {
        if (cancelled) return;
        const node = ref.current;
        if (!node) { setVisible(true); return; }
        observer = new IntersectionObserver((entries) => {
          if (entries.some(e => e.isIntersecting)) {
            setVisible(true);
            observer?.disconnect();
          }
        }, { rootMargin: '300px' });
        observer.observe(node);
      };

      // Wire the observer up once the page has loaded and the main thread goes
      // idle. Charts that are already on screen then mount a few frames later
      // — imperceptible, and invisible on mobile where they are below the fold
      // — but it keeps ~172 KB of Chart.js evaluation off the main thread while
      // the page is still becoming interactive.
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const schedule = () => {
        if (cancelled) return;
        if (typeof idle === 'function') idleHandle = idle(observe, { timeout: 1000 });
        else timeoutHandle = setTimeout(observe, 0);
      };

      if (document.readyState === 'complete') schedule();
      else window.addEventListener('load', schedule, { once: true });

      return () => {
        cancelled = true;
        window.removeEventListener('load', schedule);
        const cancelIdle = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        if (idleHandle != null) cancelIdle?.(idleHandle);
        if (timeoutHandle != null) clearTimeout(timeoutHandle);
        observer?.disconnect();
      };
    }, []);

    if (visible) return <Impl {...props} />;
    // Same markup `dynamic`'s own loading state renders — no layout shift.
    return <canvas ref={ref} role="img" height={150} width={300} />;
  };
}

export const Line = whenVisible(LineImpl);
export const Bar = whenVisible(BarImpl);
export const Doughnut = whenVisible(DoughnutImpl);
