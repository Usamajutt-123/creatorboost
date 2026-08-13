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
 */

import dynamic from 'next/dynamic';

function ChartPlaceholder() {
  return <canvas role="img" height={150} width={300} />;
}

// Turbopack requires these options to be inline object literals.
export const Line = dynamic(() => import('./ChartKit').then(m => m.Line), { ssr: false, loading: ChartPlaceholder });
export const Bar = dynamic(() => import('./ChartKit').then(m => m.Bar), { ssr: false, loading: ChartPlaceholder });
export const Doughnut = dynamic(() => import('./ChartKit').then(m => m.Doughnut), { ssr: false, loading: ChartPlaceholder });
