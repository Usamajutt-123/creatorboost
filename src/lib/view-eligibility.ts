/**
 * View traffic attribution vocabulary.
 * ----------------------------------------------------------------
 * CreatorBoost separates a *traffic view* (a request that reached a campaign
 * and passed campaign validation) from an *earning-eligible view* (traffic
 * that additionally passed security checks and the campaign + hashed-IP
 * 24-hour eligibility window).
 *
 *     Visitor request
 *           ↓
 *     Campaign validation
 *           ↓
 *     Security / bot / fraud checks
 *           ↓
 *     View recorded            <- every row below this line exists in `views`
 *           ↓
 *     24h campaign + IP eligibility
 *      ┌──────────────┬───────────────────────┐
 *      ↓                                      ↓
 *   Eligible                          Duplicate / blocked
 *   creator view + earning            admin analytics only, earning = 0
 *
 * This module is the single source of truth for:
 *
 *   1. the SAFE reason categories admin analytics may display, and
 *   2. whether a recorded view is creator-visible at all.
 *
 * It is intentionally pure (no I/O) so both the application and the tests can
 * use it, and it mirrors `public.classify_view_outcome()` /
 * `public.view_category_is_creator_visible()` in migration 0020 — the database
 * remains authoritative, this module keeps the app in sync with it.
 *
 * PRIVACY / DISCLOSURE RULES
 *   - Categories are coarse buckets. They never carry an IP, an IP hash, a
 *     fingerprint, a fraud score or a threshold.
 *   - Categories are ADMIN-FACING ONLY. Creator surfaces never receive the
 *     category, the internal reason, or the count of hidden traffic.
 */

/** Safe, admin-facing traffic categories. `paid` means earning-eligible. */
export const VIEW_TRAFFIC_CATEGORIES = [
  'paid',
  'duplicate_24h',
  'duplicate_device',
  'bot_or_automation',
  'vpn_or_proxy',
  'suspicious_traffic',
  'rate_limited',
  'invalid_session',
  'account_or_campaign',
  'earning_cap',
  'other',
] as const;

export type ViewTrafficCategory = (typeof VIEW_TRAFFIC_CATEGORIES)[number];

/**
 * Internal engine reason -> safe admin category.
 *
 * Reasons are internal strings produced by the earnings engine and the
 * database. They are never returned to a creator or to the visitor.
 */
const REASON_CATEGORY: Record<string, ViewTrafficCategory> = {
  // 1 IP + 1 campaign + 24h rule
  duplicate_ip_24h: 'duplicate_24h',
  duplicate_ip: 'duplicate_24h',
  // device-level duplicates (separate admin bucket, still "duplicate" traffic)
  duplicate_device: 'duplicate_device',
  duplicate_request: 'duplicate_device',
  // automation
  bot: 'bot_or_automation',
  emulator: 'bot_or_automation',
  automation: 'bot_or_automation',
  // IP reputation
  vpn: 'vpn_or_proxy',
  proxy: 'vpn_or_proxy',
  tor: 'vpn_or_proxy',
  // behavioural / scoring
  abnormal_traffic: 'suspicious_traffic',
  click_spam: 'suspicious_traffic',
  // request-level protection
  rate_limited: 'rate_limited',
  invalid_session: 'invalid_session',
  invalid_task: 'invalid_session',
  // account/campaign state
  self_view: 'account_or_campaign',
  account_blocked: 'account_or_campaign',
  campaign_inactive: 'account_or_campaign',
  campaign_deleted: 'account_or_campaign',
  campaign_expired: 'account_or_campaign',
  // caps configured by the admin
  device_limit: 'earning_cap',
  ip_limit: 'earning_cap',
  creator_daily_cap: 'earning_cap',
  campaign_daily_cap: 'earning_cap',
  platform_daily_cap: 'earning_cap',
};

/**
 * Categories that stay OUT of every creator-facing surface.
 *
 * A creator must never learn that a visit was rejected as a duplicate, a bot,
 * a proxy, a replay or rate-limited traffic — neither as a notification, nor
 * as a counter, nor as a row, nor as a reason string. Those rows exist purely
 * for admin analytics.
 */
const CREATOR_HIDDEN_CATEGORIES: ReadonlySet<ViewTrafficCategory> = new Set<ViewTrafficCategory>([
  'duplicate_24h',
  'duplicate_device',
  'bot_or_automation',
  'vpn_or_proxy',
  'suspicious_traffic',
  'rate_limited',
  'invalid_session',
  'other',
]);

/** Categories counted as "fraud / bot blocked" in admin analytics. */
const FRAUD_BLOCKED_CATEGORIES: ReadonlySet<ViewTrafficCategory> = new Set<ViewTrafficCategory>([
  'bot_or_automation',
  'vpn_or_proxy',
  'suspicious_traffic',
]);

/** Categories counted as "duplicate" in admin analytics. */
const DUPLICATE_CATEGORIES: ReadonlySet<ViewTrafficCategory> = new Set<ViewTrafficCategory>([
  'duplicate_24h',
  'duplicate_device',
]);

export function isViewTrafficCategory(value: unknown): value is ViewTrafficCategory {
  return typeof value === 'string' && (VIEW_TRAFFIC_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Map a recorded view outcome to its safe admin category.
 * `valid` traffic is always `paid`; anything else falls back to `other`, so an
 * unknown future reason can never accidentally be presented as paid traffic.
 */
export function classifyViewOutcome(status: string | null | undefined, reason?: string | null): ViewTrafficCategory {
  if (status === 'valid') return 'paid';
  const key = (reason || '').trim();
  if (!key) return 'other';
  return REASON_CATEGORY[key] ?? 'other';
}

/** True when a recorded view may appear in creator dashboards/analytics. */
export function isCreatorVisibleCategory(category: ViewTrafficCategory): boolean {
  return !CREATOR_HIDDEN_CATEGORIES.has(category);
}

/** Convenience: creator visibility straight from the engine outcome. */
export function isCreatorVisibleOutcome(status: string | null | undefined, reason?: string | null): boolean {
  return isCreatorVisibleCategory(classifyViewOutcome(status, reason));
}

export function isDuplicateCategory(category: ViewTrafficCategory): boolean {
  return DUPLICATE_CATEGORIES.has(category);
}

export function isFraudBlockedCategory(category: ViewTrafficCategory): boolean {
  return FRAUD_BLOCKED_CATEGORIES.has(category);
}

/** Human label used by the admin traffic-quality table. */
export const CATEGORY_LABEL: Record<ViewTrafficCategory, string> = {
  paid: 'Valid / paid',
  duplicate_24h: 'Duplicate (same campaign + IP, 24h)',
  duplicate_device: 'Duplicate device / replayed request',
  bot_or_automation: 'Bot or automation',
  vpn_or_proxy: 'VPN / proxy / Tor',
  suspicious_traffic: 'Suspicious traffic',
  rate_limited: 'Rate limited',
  invalid_session: 'Invalid task / session',
  account_or_campaign: 'Account or campaign state',
  earning_cap: 'Earning cap reached',
  other: 'Other',
};

/** Aggregated traffic counters returned by the admin analytics RPC. */
export type ViewTrafficSummary = {
  totalViews: number;
  paidViews: number;
  nonPaidViews: number;
  duplicateViews: number;
  fraudBlockedViews: number;
  earnings: number;
  byCategory: Record<ViewTrafficCategory, number>;
};

export function emptyCategoryCounts(): Record<ViewTrafficCategory, number> {
  return VIEW_TRAFFIC_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as Record<ViewTrafficCategory, number>);
}

/**
 * Fold per-category counts into the summary the admin dashboard renders.
 * Pure so the aggregation is identical whether it came from the database RPC
 * or from a fallback query.
 */
export function summarizeTraffic(
  rows: Array<{ category: string; views: number; earnings?: number }> | null | undefined,
): ViewTrafficSummary {
  const byCategory = emptyCategoryCounts();
  let totalViews = 0;
  let earnings = 0;

  for (const row of rows || []) {
    const category = isViewTrafficCategory(row.category) ? row.category : 'other';
    const views = Number(row.views) || 0;
    byCategory[category] += views;
    totalViews += views;
    earnings += Number(row.earnings) || 0;
  }

  const paidViews = byCategory.paid;
  let duplicateViews = 0;
  let fraudBlockedViews = 0;
  for (const category of VIEW_TRAFFIC_CATEGORIES) {
    if (isDuplicateCategory(category)) duplicateViews += byCategory[category];
    if (isFraudBlockedCategory(category)) fraudBlockedViews += byCategory[category];
  }

  return {
    totalViews,
    paidViews,
    nonPaidViews: Math.max(0, totalViews - paidViews),
    duplicateViews,
    fraudBlockedViews,
    earnings: Math.round(earnings * 1e6) / 1e6,
    byCategory,
  };
}
