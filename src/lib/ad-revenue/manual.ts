/**
 * Manual revenue entry helpers.
 *
 * "Manual" revenue is real money the operator recorded by hand (e.g. from a
 * payout report) — it is stored in the ad_revenue_imports ledger with
 * source='manual' and is always labeled MANUAL in the UI. It is never
 * presented as if it came from an automated provider.
 */

export interface ManualRevenueInput {
  date: string;        // YYYY-MM-DD
  network: string;
  impressions: number;
  clicks: number | null;
  revenue: number;
  currency?: string;
  country?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure validation of a manual revenue row (unit-tested). */
export function validateManualRevenueRow(row: ManualRevenueInput): string | null {
  if (!row || typeof row !== 'object') return 'Invalid row';
  if (!DATE_RE.test(row.date || '')) return `Invalid date: ${row.date}`;
  const network = String(row.network || '').trim();
  if (!network || network.length > 100) return 'Network name is required (max 100 chars)';
  if (!Number.isFinite(Number(row.impressions)) || Number(row.impressions) < 0) return 'Impressions must be >= 0';
  if (row.clicks !== null && row.clicks !== undefined && (!Number.isFinite(Number(row.clicks)) || Number(row.clicks) < 0)) {
    return 'Clicks must be >= 0';
  }
  if (!Number.isFinite(Number(row.revenue)) || Number(row.revenue) < 0) return 'Revenue must be >= 0';
  if (row.currency && !/^[A-Za-z]{3}$/.test(row.currency)) return 'Currency must be a 3-letter code';
  if (row.country && !/^[A-Za-z]{2}$/.test(row.country)) return 'Country must be a 2-letter code';
  return null;
}
