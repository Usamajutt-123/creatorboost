/**
 * CreatorBoost Earnings Engine (secure rewrite)
 * ----------------------------------------------------------------
 * FINANCIAL SAFETY RULE
 * The client is NEVER trusted for:
 *   creator identity, campaign ownership, CPM, country, earning amount,
 *   fraud score, valid status, or balance.
 *
 * The only inputs accepted from the request are:
 *   campaignId (or slug), deviceFingerprint, userAgent, tasksCompleted,
 *   idempotencyKey — and even those are re-validated server-side.
 *
 * Visitor country is resolved from the visitor IP server-side for analytics.
 * The CPM country is a separate, trusted profile field provisioned by the
 * server/admin. Fraud signals are produced server-side. Earnings, caps, and
 * idempotency are enforced here and, additionally, guarded in the database.
 */

import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/server';
import { getCountryFromIP, sanitizeCountryCode } from './geo';
import { assessFraud, hashIp, type FraudAssessment } from './fraud';
import { computePerViewEarning, computeReferralCommission } from './finance';
import { parseActiveCpm, resolveCreatorCpm } from './cpm';
import { classifyViewOutcome, type ViewTrafficCategory } from './view-eligibility';
import type { HeaderSignals } from './bot-detection';

export { computePerViewEarning, computeReferralCommission, computeWithdrawalFee } from './finance';

export type ValidatedCampaign = {
  id: string;
  creator_id: string;
  status: string;
  slug: string;
  deleted_at: string | null;
  expires_at: string | null;
};

export type RecordViewInput = {
  campaign: ValidatedCampaign;      // fetched + validated by the caller
  visitorIp?: string | null;
  /**
   * SECURITY: must be the server-observed `user-agent` request header.
   * `body.userAgent` is never authoritative for a fraud/earning decision.
   */
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  tasksCompleted?: string[];
  idempotencyKey?: string | null;
  // Optional: the currently-authenticated user, for self-view detection.
  sessionUserId?: string | null;
  /** Header-derived bot signals (server-side, from the real request headers). */
  headerSignals?: HeaderSignals | null;
  /** Server-measured seconds between campaign load and unlock submission. */
  sessionSeconds?: number | null;
  /** Number of tasks the campaign requires (read server-side from the campaign). */
  requiredTasks?: number;
};

export type RecordViewResult = {
  valid: boolean;
  reason?: string;
  cpm: number;
  levelMultiplier: number;
  earning: number; // per view
  countryCode: string | null;
  fraudScore: number;
  duplicate: boolean;
  existingId?: string | null;
  /**
   * Safe admin-facing traffic category for this outcome.
   *
   * `paid` = earning-eligible. Everything else is admin-analytics-only
   * traffic that produced no creator earning. This is NEVER forwarded to a
   * creator surface or to the visitor response body.
   */
  category: ViewTrafficCategory;
};

type Caps = {
  maxEarningsPerView: number;
  maxViewsPerDevicePerDay: number;
  maxViewsPerIpPerDay: number;
  creatorDailyEarningCap: number;
  campaignDailyEarningCap: number;
  platformDailyEarningCap: number;
  duplicateIpWindowHours: number;
  duplicateDeviceBlock: boolean;
  sensitivity: string;
  vpnBlockEnabled: boolean;
};

const SENSITIVITY_THRESHOLDS: Record<string, number> = { low: 90, medium: 75, high: 60, strict: 40 };

async function loadCaps(supabase: ReturnType<typeof createAdminClient>): Promise<Caps> {
  const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
  return {
    maxEarningsPerView: Number(data?.max_earnings_per_view ?? 1.0),
    maxViewsPerDevicePerDay: Number(data?.max_views_per_device_per_day ?? 20),
    maxViewsPerIpPerDay: Number(data?.max_views_per_ip_per_day ?? 200),
    creatorDailyEarningCap: Number(data?.creator_daily_earning_cap ?? 500),
    campaignDailyEarningCap: Number(data?.campaign_daily_earning_cap ?? 200),
    platformDailyEarningCap: Number(data?.platform_daily_earning_cap ?? 10000),
    duplicateIpWindowHours: Number(data?.duplicate_ip_window_hours ?? 24),
    duplicateDeviceBlock: data?.duplicate_device_block ?? true,
    sensitivity: data?.fraud_detection_sensitivity ?? 'medium',
    vpnBlockEnabled: data?.vpn_block_enabled ?? true,
  };
}

// (Pure financial helpers live in ./finance.ts and are re-exported above.)

/**
 * Compute per-view earnings from a SERVER-derived country + fraud result.
 * Never accepts a country from the client.
 */
export async function computeViewEarnings(opts: {
  creatorId: string;
  countryCode: string | null;
  fraud: FraudAssessment;
}): Promise<{
  valid: boolean;
  reason?: string;
  cpm: number;
  levelMultiplier: number;
  earning: number;
}> {
  const supabase = createAdminClient();
  const caps = await loadCaps(supabase);

  // 1. Hard fraud blocks
  if (opts.fraud.isBot) return { valid: false, reason: 'bot', cpm: 0, levelMultiplier: 1, earning: 0 };
  // Tor is an explicit, DELIBERATE decision rather than a collected-but-unused
  // signal. Exit-node traffic hides the visitor's real network entirely, which
  // defeats both the geo-based CPM and the campaign+IP duplicate window, so it
  // is treated like a VPN/proxy and governed by the SAME operator switch
  // (`vpn_block_enabled`). Operators who accept anonymity-network traffic can
  // turn the switch off and Tor visits become payable again — the sensitivity
  // stays configurable, and the reason never reaches the visitor or creator.
  if (caps.vpnBlockEnabled && (opts.fraud.isVpn || opts.fraud.isProxy || opts.fraud.isTor)) {
    const reason = opts.fraud.isVpn ? 'vpn' : opts.fraud.isProxy ? 'proxy' : 'tor';
    return { valid: false, reason, cpm: 0, levelMultiplier: 1, earning: 0 };
  }
  if (opts.fraud.isEmulator) return { valid: false, reason: 'emulator', cpm: 0, levelMultiplier: 1, earning: 0 };

  // 2. Score-based filtering by sensitivity
  const threshold = SENSITIVITY_THRESHOLDS[caps.sensitivity] ?? 75;
  if (opts.fraud.fraudScore >= threshold) {
    return { valid: false, reason: 'abnormal_traffic', cpm: 0, levelMultiplier: 1, earning: 0 };
  }

  // 3. Active platform CPM (admin-configurable Global CPM).
  //    A missing/inactive cpm_settings row yields $0 — never a hardcoded rate.
  //    An active country_tiers rate for the trusted CPM country then overrides
  //    Global CPM. Visitor country stays analytics-only.
  let cpm = 0;
  const { data: cpmRow } = await supabase
    .from('cpm_settings')
    .select('cpm, is_active')
    .eq('id', 1)
    .maybeSingle();
  if (cpmRow) {
    cpm = parseActiveCpm(cpmRow);
  } else {
    const { data: rpcCpm } = await supabase.rpc('get_active_cpm');
    const parsed = Number(rpcCpm);
    cpm = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  // 4. Creator account status: banned/suspended creators earn nothing.
  const { data: profile } = await supabase
    .from('profiles')
    // country_code is creator-editable display data. It is deliberately not
    // selected here: it must never be an input to the earnings decision.
    .select('level, status, cpm_country_code')
    .eq('id', opts.creatorId)
    .maybeSingle();
  if (profile && (profile.status === 'banned' || profile.status === 'suspended')) {
    return { valid: false, reason: 'account_blocked', cpm: 0, levelMultiplier: 1, earning: 0 };
  }

  // SECURITY: use only the server/admin-controlled cpm_country_code
  // (migration 0017). A missing trusted country intentionally falls back to
  // Global CPM; never substitute the creator-editable country_code.
  const creatorCountry = sanitizeCountryCode(
    (profile as Record<string, unknown> | null)?.cpm_country_code as string | null
  );
  if (creatorCountry) {
    const { data: countryRow } = await supabase
      .from('country_tiers')
      .select('cpm_default, active')
      .eq('country_code', creatorCountry)
      .maybeSingle();
    cpm = resolveCreatorCpm(cpm, countryRow).cpm;
  }
  const { data: levelRow } = await supabase
    .from('creator_levels')
    .select('cpm_multiplier')
    .eq('level', profile?.level ?? 'bronze')
    .maybeSingle();
  const levelMultiplier = Number(levelRow?.cpm_multiplier ?? 1.0);

  // 5. Per-view earning with a hard per-view cap
  const earning = computePerViewEarning(cpm, levelMultiplier, caps.maxEarningsPerView);

  return { valid: true, cpm, levelMultiplier, earning };
}

/**
 * Cap inputs for one view decision, computed by the database.
 *
 * PERFORMANCE: this replaces four separate application-side reads that used to
 * download every matching `earnings.amount` row (creator, campaign, platform)
 * plus two `views` count queries and reduce them in JavaScript. On a busy
 * platform the platform-wide read alone was an unbounded download. The
 * `view_cap_snapshot` RPC computes the same numbers with indexed SUM()/COUNT()
 * aggregates and returns a single row.
 *
 * The RPC is the source of truth; the fallback below exists only for
 * databases where migration 0021 has not been applied yet (and for the unit
 * test doubles), and reproduces the previous behaviour exactly.
 */
type CapSnapshot = {
  creatorEarningsToday: number;
  campaignEarningsToday: number;
  platformEarningsToday: number;
  ipViewsToday: number;
  deviceViewsToday: number;
};

async function loadCapSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  args: { creatorId: string; campaignId: string; ipHash: string | null; deviceFingerprint: string | null; sinceIso: string },
): Promise<CapSnapshot> {
  try {
    const { data, error } = await supabase.rpc('view_cap_snapshot', {
      p_creator_id: args.creatorId,
      p_campaign_id: args.campaignId,
      p_ip_hash: args.ipHash,
      p_device_fingerprint: args.deviceFingerprint,
      p_window_hours: 24,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      return {
        creatorEarningsToday: Number(r.creator_earnings_today ?? 0),
        campaignEarningsToday: Number(r.campaign_earnings_today ?? 0),
        platformEarningsToday: Number(r.platform_earnings_today ?? 0),
        ipViewsToday: Number(r.ip_views_today ?? 0),
        deviceViewsToday: Number(r.device_views_today ?? 0),
      };
    }
  } catch {
    // Fall through to the compatibility path below.
  }

  // Compatibility path (pre-0021 database / test doubles). Uses `head: true`
  // counts and bounded selects rather than full-row downloads where possible.
  const sumAmounts = async (build: (q: any) => any): Promise<number> => {
    const { data } = await build(supabase.from('earnings').select('amount'));
    return (data || []).reduce((s: number, e: { amount?: unknown }) => s + Number(e?.amount || 0), 0);
  };
  const countViews = async (column: 'ip_hash' | 'device_fingerprint', value: string | null): Promise<number> => {
    if (!value) return 0;
    const { count } = await supabase
      .from('views')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', args.creatorId)
      .eq(column, value)
      .gte('created_at', args.sinceIso);
    return count ?? 0;
  };

  const [creatorEarningsToday, campaignEarningsToday, platformEarningsToday, ipViewsToday, deviceViewsToday] =
    await Promise.all([
      sumAmounts(q => q.eq('creator_id', args.creatorId).gte('created_at', args.sinceIso)),
      sumAmounts(q => q.eq('campaign_id', args.campaignId).gte('created_at', args.sinceIso)),
      sumAmounts(q => q.eq('type', 'view_earning').gte('created_at', args.sinceIso)),
      countViews('ip_hash', args.ipHash),
      countViews('device_fingerprint', args.deviceFingerprint),
    ]);

  return { creatorEarningsToday, campaignEarningsToday, platformEarningsToday, ipViewsToday, deviceViewsToday };
}

/**
 * Normalize the client-supplied device fingerprint.
 *
 * IMPORTANT — this value is NOT a cryptographic identity and CreatorBoost
 * does not treat it as one. A visitor can omit it, randomize it per request,
 * or copy someone else's. It is only ever used as a weak correlation hint
 * that can LOWER trust; the IP + campaign duplicate window, the caps and the
 * atomic transaction remain the real protections, and all of them work when
 * the fingerprint is absent.
 *
 * What this function guarantees:
 *   - control characters are stripped (no log/HTML injection through it),
 *   - length is bounded (no oversized payload reaching the database),
 *   - whitespace is collapsed so trivial variants normalize to one value,
 *   - an empty/garbage value becomes `null` rather than a matchable token
 *     (so an attacker cannot make everyone share one fingerprint).
 */
export function normalizeDeviceFingerprint(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  // Require some real entropy; a 1-2 character value correlates nothing.
  return cleaned.length >= 8 ? cleaned : null;
}

type AtomicOutcome =
  | { status: 'ok'; valid: boolean; reason: string | null; earning: number; viewId: string | null; replayed: boolean }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable' };

/**
 * Invoke the single-transaction accounting RPC.
 *
 * Returns `unavailable` (and only then) when the function does not exist in
 * the target database, so an un-migrated deployment can fall back to the
 * legacy two-step path. Any OTHER error is `failed`: the money path must
 * never silently continue after a database error.
 */
async function creditAtomically(
  supabase: ReturnType<typeof createAdminClient>,
  args: Record<string, unknown>,
): Promise<AtomicOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await supabase.rpc('record_view_and_credit', args));
  } catch {
    return { status: 'unavailable' };
  }

  if (error) {
    const code = (error as Record<string, unknown> | null)?.code;
    // 42883 = undefined_function. 42881 is accepted too because the existing
    // fallback contract (and its test) has always used it. PGRST202 =
    // PostgREST could not find the function in its schema cache.
    if (code === '42883' || code === '42881' || code === 'PGRST202') return { status: 'unavailable' };
    if (code === '23505') return { status: 'failed', reason: 'duplicate_request' };
    console.error('[earnings] record_view_and_credit failed', error);
    return { status: 'failed', reason: 'accounting_unavailable' };
  }

  if (!data || typeof data !== 'object' || !('processed' in (data as object))) {
    return { status: 'unavailable' };
  }

  const row = data as Record<string, unknown>;
  return {
    status: 'ok',
    valid: row.valid === true,
    reason: typeof row.reason === 'string' ? row.reason : null,
    earning: Number(row.earning ?? 0) || 0,
    viewId: typeof row.view_id === 'string' ? row.view_id : null,
    replayed: row.replayed === true,
  };
}

/**
 * Record a view and (if eligible) credit the creator. Fully server-driven.
 */
export async function recordView(input: RecordViewInput): Promise<RecordViewResult> {
  const supabase = createAdminClient();
  const creatorId = input.campaign.creator_id;
  const ipHash = hashIp(input.visitorIp);
  const campaignId = input.campaign.id;
  const idemKey = input.idempotencyKey?.trim() || null;

  // ---------------------------------------------------------------
  // 0. Idempotency: a replayed request with the same key returns the
  //    original outcome WITHOUT creating another earning. A DB unique
  //    index (views.creator_id + idempotency_key) backs this up.
  // ---------------------------------------------------------------
  if (idemKey) {
    const { data: existing } = await supabase
      .from('views')
      .select('id, status, invalid_reason, cpm_rate, earnings, fraud_score, country_code, accounted_at')
      .eq('creator_id', creatorId)
      .eq('idempotency_key', idemKey)
      .maybeSingle();
    if (existing) {
      return {
        valid: existing.status === 'valid' && Boolean(existing.accounted_at),
        reason: existing.accounted_at ? (existing.invalid_reason ?? undefined) : 'accounting_pending',
        cpm: Number(existing.cpm_rate || 0),
        levelMultiplier: 1,
        earning: Number(existing.earnings || 0),
        countryCode: existing.country_code,
        fraudScore: Number(existing.fraud_score || 0),
        duplicate: true,
        existingId: existing.id,
        category: classifyViewOutcome(existing.status, existing.invalid_reason),
      };
    }
  }

  // ---------------------------------------------------------------
  // 1. Campaign lifecycle guards (defense-in-depth; caller already checks)
  // ---------------------------------------------------------------
  if (input.campaign.status !== 'active') {
    return invalidResult('campaign_inactive');
  }
  if (input.campaign.deleted_at) return invalidResult('campaign_deleted');
  if (input.campaign.expires_at && new Date(input.campaign.expires_at).getTime() < Date.now()) {
    return invalidResult('campaign_expired');
  }

  // Self-view detection: the authenticated campaign owner farming their own
  // traffic is not eligible for payment.
  if (input.sessionUserId && input.sessionUserId === creatorId) {
    return invalidResult('self_view');
  }

  // ---------------------------------------------------------------
  // 2. Server-side country + fraud
  // ---------------------------------------------------------------
  const countryCode = sanitizeCountryCode(await getCountryFromIP(input.visitorIp));
  const fraud = await assessFraud({
    ip: input.visitorIp ?? undefined,
    // Already the server-observed header value — the route handler never
    // forwards `body.userAgent` into this field for a security decision.
    userAgent: input.userAgent ?? undefined,
    fingerprint: input.deviceFingerprint ?? undefined,
    campaignId,
    creatorId,
    // Server-derived request/behavioural context. All of these come from the
    // real request headers and server-side timestamps, never from the body.
    headerSignals: input.headerSignals ?? null,
    sessionSeconds: input.sessionSeconds ?? null,
    requiredTasks: input.requiredTasks ?? 0,
  });

  // ---------------------------------------------------------------
  // 3. Earnings decision
  // ---------------------------------------------------------------
  const decision = await computeViewEarnings({ creatorId, countryCode, fraud });
  // The database performs a final serialized cap/status check while it
  // accounts the view. These values are updated from that authoritative RPC
  // response before we return anything to the route handler.
  let finalValid = decision.valid;
  let finalReason: string | undefined = decision.valid ? undefined : (decision.reason ?? 'other');
  let finalEarning = decision.valid ? decision.earning : 0;
  const now = Date.now();
  const dayStart = new Date(now - 86400_000).toISOString();
  const caps = await loadCaps(supabase);
  // The fingerprint is a client-controlled correlation HINT, never an
  // identity. It is normalized/bounded here so a malicious payload cannot
  // reach the database, and its absence never grants eligibility.
  const normalizedFingerprint = normalizeDeviceFingerprint(input.deviceFingerprint);

  // Caps (device/IP view counts + creator/campaign/platform daily earnings).
  // One database round-trip computes all five aggregates; the thresholds and
  // their precedence are unchanged. The database re-checks the earning caps a
  // second time, serialized, inside the atomic accounting transaction — these
  // checks are the fast pre-filter, not the authority.
  if (decision.valid) {
    const snapshot = await loadCapSnapshot(supabase, {
      creatorId,
      campaignId,
      ipHash,
      deviceFingerprint: normalizedFingerprint,
      sinceIso: dayStart,
    });

    if (normalizedFingerprint && snapshot.deviceViewsToday >= caps.maxViewsPerDevicePerDay) {
      const r = invalidResult('device_limit');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
    if (ipHash && snapshot.ipViewsToday >= caps.maxViewsPerIpPerDay) {
      const r = invalidResult('ip_limit');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
    if (decision.earning > 0) {
      if (snapshot.creatorEarningsToday + decision.earning > caps.creatorDailyEarningCap) {
        const r = invalidResult('creator_daily_cap');
        r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
        return r;
      }
      if (snapshot.campaignEarningsToday + decision.earning > caps.campaignDailyEarningCap) {
        const r = invalidResult('campaign_daily_cap');
        r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
        return r;
      }
      if (snapshot.platformEarningsToday + decision.earning > caps.platformDailyEarningCap) {
        const r = invalidResult('platform_daily_cap');
        r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
        return r;
      }
    }
  }

  // ---------------------------------------------------------------
  // 4. Duplicate device within window (only when device dup blocking on)
  // ---------------------------------------------------------------
  if (decision.valid && caps.duplicateDeviceBlock && normalizedFingerprint) {
    const since = new Date(now - caps.duplicateIpWindowHours * 3600_000).toISOString();
    const { data: dup } = await supabase
      .from('views')
      .select('id')
      .eq('creator_id', creatorId)
      .eq('device_fingerprint', normalizedFingerprint)
      .gte('created_at', since)
      .limit(1);
    if (dup && dup.length > 0) {
      const r = invalidResult('duplicate_device');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
  }

  // ---------------------------------------------------------------
  // 5. ATOMIC ACCOUNTING
  //
  // `record_view_and_credit` (migration 0021) performs the entire critical
  // financial path in ONE PostgreSQL transaction:
  //
  //   idempotency -> campaign/creator validation -> duplicate window ->
  //   caps -> view insert -> earnings ledger -> campaign counters ->
  //   creator counters -> pending balance -> referral commission -> commit
  //
  // The previous flow issued `record_view_with_ip_check` and then
  // `credit_view_earning` as two independent statements, so a failure in
  // between could leave a 'valid' view with no ledger row. That split no
  // longer exists: either everything commits or nothing does.
  // ---------------------------------------------------------------
  const capsIpWindow = caps.duplicateIpWindowHours ?? 24;
  const visitorIpValue = input.visitorIp && input.visitorIp !== 'unknown' ? input.visitorIp : null;
  const description = `View earning @ $${decision.cpm.toFixed(2)} CPM × ${decision.levelMultiplier}x level`;
  const viewStatus = finalValid ? 'valid' : 'invalid';
  const viewReason = finalValid ? null : (finalReason ?? 'other');

  const atomic = await creditAtomically(supabase, {
    p_campaign_id: campaignId,
    p_creator_id: creatorId,
    p_visitor_ip: visitorIpValue,
    p_ip_hash: ipHash,
    p_country_code: countryCode,
    p_device_fingerprint: normalizedFingerprint,
    p_user_agent: input.userAgent || null,
    p_is_vpn: fraud.isVpn,
    p_is_proxy: fraud.isProxy,
    p_is_bot: fraud.isBot,
    p_is_emulator: fraud.isEmulator,
    p_fraud_score: fraud.fraudScore,
    p_status: viewStatus,
    p_invalid_reason: viewReason,
    p_cpm_rate: decision.cpm,
    p_earnings: finalValid ? finalEarning : 0,
    p_tasks_completed: input.tasksCompleted ?? [],
    p_idempotency_key: idemKey,
    p_ip_window_hours: capsIpWindow,
    p_description: description,
  });

  if (atomic.status === 'ok') {
    finalValid = atomic.valid;
    finalReason = atomic.valid ? undefined : (atomic.reason || 'invalid_traffic');
    finalEarning = atomic.valid ? atomic.earning : 0;
    return {
      valid: finalValid,
      reason: finalReason,
      cpm: decision.cpm,
      levelMultiplier: decision.levelMultiplier,
      earning: finalEarning,
      countryCode,
      fraudScore: fraud.fraudScore,
      duplicate: atomic.replayed,
      existingId: atomic.viewId,
      category: classifyViewOutcome(finalValid ? 'valid' : 'invalid', finalReason),
    };
  }
  if (atomic.status === 'failed') {
    // The transaction was reached but did not complete. Never report a
    // payout-eligible view when the protected accounting did not commit.
    return invalidResult(atomic.reason);
  }

  // ---------------------------------------------------------------
  // 5b. COMPATIBILITY PATH
  //
  // Only reached when `record_view_and_credit` is absent (a database that
  // has not applied migration 0021 yet, or a unit-test double). It keeps the
  // previous two-step behaviour so an un-migrated deployment still records
  // traffic and pays creators. Production runs the atomic path above.
  // ---------------------------------------------------------------
  let inserted: { id: string } | null = null;

  const viewInsertData = {
    campaign_id: campaignId,
    creator_id: creatorId,
    visitor_ip: visitorIpValue,
    ip_hash: ipHash,
    country_code: countryCode,
    device_fingerprint: normalizedFingerprint,
    user_agent: input.userAgent || null,
    is_vpn: fraud.isVpn,
    is_proxy: fraud.isProxy,
    is_bot: fraud.isBot,
    is_emulator: fraud.isEmulator,
    fraud_score: fraud.fraudScore,
    status: viewStatus,
    invalid_reason: viewReason,
    cpm_rate: decision.cpm,
    earnings: finalValid ? finalEarning : 0,
    tasks_completed: input.tasksCompleted ?? [],
    validated_at: finalValid ? new Date().toISOString() : null,
    idempotency_key: idemKey,
  };

  let useRpc = true;
  try {
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('record_view_with_ip_check', {
      p_campaign_id: campaignId,
      p_creator_id: creatorId,
      p_visitor_ip: viewInsertData.visitor_ip,
      p_ip_hash: ipHash,
      p_country_code: countryCode,
      p_device_fingerprint: viewInsertData.device_fingerprint,
      p_user_agent: viewInsertData.user_agent,
      p_is_vpn: fraud.isVpn,
      p_is_proxy: fraud.isProxy,
      p_is_bot: fraud.isBot,
      p_is_emulator: fraud.isEmulator,
      p_fraud_score: fraud.fraudScore,
      p_status: viewInsertData.status,
      p_invalid_reason: viewInsertData.invalid_reason,
      p_cpm_rate: decision.cpm,
      p_earnings: viewInsertData.earnings,
      p_tasks_completed: viewInsertData.tasks_completed,
      p_validated_at: viewInsertData.validated_at,
      p_idempotency_key: idemKey,
      p_ip_window_hours: capsIpWindow,
    });

    if (rpcErr) {
      const errCode = (rpcErr as unknown as Record<string, unknown>).code;
      if (typeof errCode === 'string' && (errCode === '42883' || errCode === '42881')) {
        useRpc = false;
      } else if (typeof errCode === 'string' && errCode === '23505') {
        return invalidResult('duplicate_request');
      } else {
        console.error('[earnings] record_view_with_ip_check failed', rpcErr);
        return invalidResult('internal');
      }
    } else if (rpcResult && typeof rpcResult === 'object') {
      const result = rpcResult as Record<string, unknown>;
      inserted = result.view_id ? { id: result.view_id as string } : null;
      if (result.duplicate_ip === true && finalValid) {
        finalValid = false;
        finalReason = 'duplicate_ip_24h';
        finalEarning = 0;
      }
    } else {
      useRpc = false;
    }
  } catch {
    useRpc = false;
  }

  if (!useRpc) {
    // Advisory lock per (campaign, IP) pair to prevent concurrent duplicates.
    if (finalValid && ipHash) {
      try {
        await supabase.rpc('pg_advisory_xact_lock', {
          p_key: Number('0x' + createHash('sha256').update(`${campaignId}:${ipHash}`).digest('hex').slice(0, 16)),
        });
      } catch {
        // Advisory lock unavailable in dev — continue with a best-effort check.
      }
      const sinceWindow = new Date(now - capsIpWindow * 3600_000).toISOString();
      const { data: existingSameIp } = await supabase
        .from('views')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('ip_hash', ipHash)
        .eq('status', 'valid')
        .gte('created_at', sinceWindow)
        .limit(1);
      if (existingSameIp && existingSameIp.length > 0) {
        finalValid = false;
        finalReason = 'duplicate_ip_24h';
        finalEarning = 0;
        viewInsertData.status = 'invalid';
        viewInsertData.invalid_reason = 'duplicate_ip_24h';
        viewInsertData.earnings = 0;
        viewInsertData.validated_at = null;
      }
    }

    const { data: directInserted, error } = await supabase
      .from('views')
      .insert(viewInsertData)
      .select()
      .maybeSingle();

    if (error) {
      if (typeof error.code === 'string' && error.code === '23505') {
        return invalidResult('duplicate_request');
      }
      console.error('[earnings] view insert failed', error);
      return invalidResult('internal');
    }
    inserted = directInserted;
  }

  if (inserted) {
    const { data: credit, error: cErr } = await supabase.rpc('credit_view_earning', {
      p_view_id: inserted.id,
      p_campaign_id: campaignId,
      p_creator_id: creatorId,
      p_valid: finalValid,
      p_cpm: decision.cpm,
      p_earning: finalValid ? finalEarning : 0,
      p_level_multiplier: decision.levelMultiplier,
      p_description: description,
    });
    if (cErr) {
      console.error('[earnings] credit_view_earning failed', cErr);
      finalValid = false;
      finalReason = 'accounting_unavailable';
      finalEarning = 0;
    } else if (credit && typeof credit === 'object' && 'valid' in credit) {
      const result = credit as { valid?: boolean; reason?: string; earning?: number };
      finalValid = result.valid === true;
      finalReason = finalValid ? undefined : (result.reason || 'invalid_traffic');
      finalEarning = finalValid ? Number(result.earning ?? decision.earning) : 0;
      if (finalValid && finalEarning > 0) {
        await maybeCreditReferral(supabase, creatorId, finalEarning, inserted.id);
      }
    } else if (decision.valid && decision.earning > 0) {
      await maybeCreditReferral(supabase, creatorId, decision.earning, inserted.id);
    }
  }

  return {
    valid: finalValid,
    reason: finalReason,
    cpm: decision.cpm,
    levelMultiplier: decision.levelMultiplier,
    earning: finalEarning,
    countryCode,
    fraudScore: fraud.fraudScore,
    duplicate: false,
    category: classifyViewOutcome(finalValid ? 'valid' : 'invalid', finalReason),
  };
}

function invalidResult(reason: string): RecordViewResult {
  return {
    valid: false,
    reason,
    cpm: 0,
    levelMultiplier: 1,
    earning: 0,
    countryCode: null,
    fraudScore: 0,
    duplicate: false,
    // Non-paid traffic is still recorded/classified for admin analytics.
    category: classifyViewOutcome('invalid', reason),
  };
}

/** Credit the referrer a % commission on a valid view earning (idempotent per view). */
async function maybeCreditReferral(
  supabase: ReturnType<typeof createAdminClient>,
  creatorId: string,
  earning: number,
  viewId: string,
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('referred_by')
      .eq('id', creatorId)
      .maybeSingle();
    if (!profile?.referred_by) return;

    const { data: settings } = await supabase
      .from('platform_settings')
      .select('referral_percentage')
      .eq('id', 1)
      .maybeSingle();
    const pct = Number(settings?.referral_percentage ?? 10);
    const commission = computeReferralCommission(earning, pct);
    if (commission <= 0) return;

    // Prevent self-referral (should not exist, but guard anyway)
    if (profile.referred_by === creatorId) return;

    const { error } = await supabase.rpc('credit_referral_commission', {
      p_referrer_id: profile.referred_by,
      p_amount: commission,
      p_creator_id: creatorId,
      p_view_id: viewId,
    });
    if (error) console.error('[earnings] referral credit failed', error);
  } catch (e) {
    console.error('[earnings] referral lookup failed', e);
  }
}
