/**
 * Pure chart aggregators, shared by the server components that render the
 * dashboards and by the client chart components.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Round 2 correctly moved the charts' Supabase queries to the server, but it
 * then handed the **raw rows** to client components. Every row therefore had to
 * be JSON-serialised into the RSC flight payload, downloaded, parsed on the
 * main thread and retained in memory — just so the browser could reduce them to
 * a handful of numbers. On a busy creator account that made the `/dashboard`
 * HTML document **982 KB**, of which 957 KB was flight payload containing 6,000
 * `user_agent` strings.
 *
 * Aggregations that do NOT depend on the viewer's timezone are performed here
 * on the server instead, and only the resulting label/count arrays cross the
 * wire. The functions below are byte-for-byte the same algorithms that used to
 * run in the browser (same iteration order, same `sort`/`slice`, same tie
 * handling — `Array.prototype.sort` is stable, and the row order is the order
 * Supabase returned), so the rendered charts are identical.
 *
 * Aggregations that DO depend on the viewer's local timezone (per-local-day
 * earnings, per-local-month revenue/growth) deliberately stay on the client.
 * For those, only the two fields the aggregation reads are shipped, in a
 * compact tuple form, instead of full row objects.
 */

/** `{ labels, data }` pair consumed directly by a Chart.js dataset. */
export type ChartSeries = { labels: string[]; data: number[] };

/** Device split rendered by the dashboard's doughnut chart. */
export type DeviceCounts = { mobile: number; desktop: number; tablet: number };

/**
 * Earnings compacted to `[amount, epochMs]`.
 *
 * `localDayKey()` accepts a number, and `new Date(epochMs)` is exactly
 * equivalent to `new Date(isoString)`, so the client-side per-local-day
 * bucketing produces identical values from ~60% fewer bytes.
 */
export type CompactEarning = [amount: number, at: number];

export function compactEarnings(
  rows: Array<{ amount: number | string | null; created_at: string }> | null | undefined,
): CompactEarning[] {
  return (rows || []).map((e) => [Number(e.amount), Date.parse(e.created_at)]);
}

/** Timestamps compacted to epoch ms (used for local-month bucketing). */
export function compactTimestamps(rows: Array<{ created_at: string }> | null | undefined): number[] {
  return (rows || []).map((r) => Date.parse(r.created_at));
}

/**
 * Top 8 countries by view count. Timezone-independent.
 * Same algorithm the dashboard/admin chart components used to run client-side.
 */
export function aggregateViewCountries(
  rows: Array<{ country_code: string | null }> | null | undefined,
): ChartSeries {
  const counts: Record<string, number> = {};
  (rows || []).forEach((v) => {
    const c = v.country_code || 'XX';
    counts[c] = (counts[c] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { labels: top.map(([c]) => c), data: top.map(([, n]) => n) };
}

/**
 * Mobile/desktop/tablet split from user-agent strings. Timezone-independent.
 * Identical branch order to the previous client-side implementation.
 */
export function aggregateViewDevices(
  rows: Array<{ user_agent: string | null }> | null | undefined,
): DeviceCounts {
  let mobile = 0, desktop = 0, tablet = 0;
  (rows || []).forEach((v) => {
    const ua = (v.user_agent || '').toLowerCase();
    if (ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) tablet++;
    else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) mobile++;
    else desktop++;
  });
  return { mobile, desktop, tablet };
}

/**
 * Recorded revenue per ad network (top 6). Timezone-independent.
 *
 * Note the `(a || 0) + Number(b) || 0` shape is preserved exactly from the
 * previous implementation so NaN handling stays identical.
 */
export function aggregateNetworkRevenue(
  rows: Array<{ network: string; revenue: number | string | null }> | null | undefined,
): ChartSeries {
  const totals: Record<string, number> = {};
  (rows || []).forEach((r) => { totals[r.network] = (totals[r.network] || 0) + Number(r.revenue) || 0; });
  const nets = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { labels: nets.map(([n]) => n), data: nets.map(([, v]) => Math.round(v * 100) / 100) };
}

/** Regional-indicator flag for a 2-letter country code (as rendered before). */
export function countryFlagLabel(code: string): string {
  const flag = String.fromCodePoint(...code.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
  return `${flag} ${code}`;
}
