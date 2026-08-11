/**
 * Ad-network revenue provider abstraction.
 *
 * The platform NEVER fabricates revenue. Revenue shown in the admin panel is
 * one of:
 *
 *   REAL      — imported automatically from a configured provider (see
 *               provider.ts) or recorded from a verified payout report.
 *   MANUAL    — entered by an admin into the ad_revenue_imports ledger
 *               (source = 'manual'), clearly labeled as manual.
 *   ESTIMATED — never shown as revenue; only clearly-labeled estimates
 *               (e.g. "not configured" placeholders).
 *
 * Until a provider is configured, the UI displays
 * "Revenue integration not configured" instead of fake numbers.
 */

export interface AdRevenueRecord {
  /** YYYY-MM-DD */
  date: string;
  network: string;
  impressions: number;
  clicks: number | null;
  revenue: number;
  currency: string;
  country: string | null;
}

export interface AdRevenueProvider {
  /** stable id, e.g. 'adsterra' | 'monetag' */
  id: string;
  label: string;
  /** true when the env config needed to talk to the real API exists */
  configured(): boolean;
  /**
   * Fetch revenue records for [from, to] (YYYY-MM-DD, inclusive).
   * MUST return [] (never throw) when not configured or on failure —
   * a provider failure must never produce or crash revenue numbers.
   */
  fetchRevenue(from: string, to: string): Promise<AdRevenueRecord[]>;
}

const registry: AdRevenueProvider[] = [];

export function registerProvider(p: AdRevenueProvider): void {
  if (!registry.find(x => x.id === p.id)) registry.push(p);
}

export function getProviders(): AdRevenueProvider[] {
  return [...registry];
}

/** True when at least one REAL provider is configured end-to-end. */
export function isRevenueIntegrationConfigured(): boolean {
  return registry.some(p => p.configured());
}

/** Revenue integration status — used by the admin UI. */
export function revenueIntegrationStatus(): {
  configured: boolean;
  providers: Array<{ id: string; label: string; configured: boolean }>;
} {
  return {
    configured: isRevenueIntegrationConfigured(),
    providers: registry.map(p => ({ id: p.id, label: p.label, configured: p.configured() })),
  };
}

/**
 * Generic HTTP revenue provider used by concrete integrations.
 *
 * Contract: GET {baseUrl}?from=YYYY-MM-DD&to=YYYY-MM-DD with optional
 * `Authorization: Bearer <token>`, returning a JSON array:
 *
 *   [{ "date": "2026-08-01", "impressions": 12345, "clicks": 432,
 *      "revenue": 12.34, "currency": "USD", "country": "US" | null }]
 *
 * Concrete adapters (adsterra.ts / monetag.ts) must be pointed at the
 * REAL endpoints published by those networks via environment variables;
 * without a real endpoint they report `configured() === false` and the
 * UI shows "Revenue integration not configured".
 */
export class HttpRevenueProvider implements AdRevenueProvider {
  constructor(
    public id: string,
    public label: string,
    private baseUrl: string | undefined,
    private token?: string,
    private timeoutMs = 10_000,
  ) {}

  configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async fetchRevenue(from: string, to: string): Promise<AdRevenueRecord[]> {
    if (!this.configured()) return [];
    try {
      const url = new URL(this.baseUrl!);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(url.toString(), { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return [];
      return data
        .map((r: Record<string, unknown>) => sanitizeRecord(r))
        .filter((r): r is AdRevenueRecord => r !== null);
    } catch (e) {
      console.error(`[ad-revenue] ${this.id} fetch failed`, e);
      return [];
    }
  }
}

/** Strict validation of an incoming revenue record (unit-tested). */
export function sanitizeRecord(raw: Record<string, unknown>): AdRevenueRecord | null {
  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const network = typeof raw.network === 'string' ? raw.network.trim().slice(0, 100) : '';
  if (!network) return null;
  const impressions = Number(raw.impressions) || 0;
  const clicks = raw.clicks === null || raw.clicks === undefined ? null : Number(raw.clicks) || 0;
  const revenue = Number(raw.revenue);
  if (!Number.isFinite(revenue) || revenue < 0) return null;
  const currency = typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency)
    ? raw.currency.toUpperCase() : 'USD';
  const country = typeof raw.country === 'string' && /^[A-Za-z]{2}$/.test(raw.country.trim())
    ? raw.country.trim().toUpperCase() : null;
  return { date, network, impressions: Math.max(0, impressions), clicks, revenue, currency, country };
}
