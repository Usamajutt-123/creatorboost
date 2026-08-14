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
 * Country is resolved from the visitor IP server-side. Fraud signals are
 * produced server-side. Earnings, caps, and idempotency are enforced here
 * and, additionally, guarded in the database.
 */

import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/server';
import { getCountryFromIP, sanitizeCountryCode } from './geo';
import { assessFraud, hashIp, type FraudAssessment } from './fraud';
import { computePerViewEarning, computeReferralCommission } from './finance';
import { parseActiveCpm, resolveCreatorCpm } from './cpm';

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
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  tasksCompleted?: string[];
  idempotencyKey?: string | null;
  // Optional: the currently-authenticated user, for self-view detection.
  sessionUserId?: string | null;
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
  if (caps.vpnBlockEnabled && (opts.fraud.isVpn || opts.fraud.isProxy)) {
    return { valid: false, reason: opts.fraud.isVpn ? 'vpn' : 'proxy', cpm: 0, levelMultiplier: 1, earning: 0 };
  }
  if (opts.fraud.isEmulator) return { valid: false, reason: 'emulator', cpm: 0, levelMultiplier: 1, earning: 0 };

  // 2. Score-based filtering by sensitivity
  const threshold = SENSITIVITY_THRESHOLDS[caps.sensitivity] ?? 75;
  if (opts.fraud.fraudScore >= threshold) {
    return { valid: false, reason: 'abnormal_traffic', cpm: 0, levelMultiplier: 1, earning: 0 };
  }

  // 3. Active platform CPM (admin-configurable Global CPM).
  //    A missing/inactive cpm_settings row yields $0 — never a hardcoded rate.
  //    An active country_tiers rate for the creator's profile country then
  //    overrides Global CPM. Visitor country stays analytics-only.
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
    .select('level, status, cpm_country_code, country_code')
    .eq('id', opts.creatorId)
    .maybeSingle();
  if (profile && (profile.status === 'banned' || profile.status === 'suspended')) {
    return { valid: false, reason: 'account_blocked', cpm: 0, levelMultiplier: 1, earning: 0 };
  }

  // SECURITY: use the admin-controlled cpm_country_code (migration 0017)
  // instead of the creator-editable country_code. This prevents a creator
  // from selecting a premium-CPM country and getting inflated earnings.
  const creatorCountry = sanitizeCountryCode(
    (profile as Record<string, unknown> | null)?.cpm_country_code as string | null
      ?? profile?.country_code
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

async function sumEarningsSince(supabase: ReturnType<typeof createAdminClient>, creatorId: string, sinceIso: string) {
  const { data } = await supabase
    .from('earnings')
    .select('amount')
    .eq('creator_id', creatorId)
    .gte('created_at', sinceIso);
  return (data || []).reduce((s, e) => s + Number(e.amount || 0), 0);
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
    userAgent: input.userAgent ?? undefined,
    fingerprint: input.deviceFingerprint ?? undefined,
    campaignId,
    creatorId,
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

  // Cap: views per device per day
  if (decision.valid && input.deviceFingerprint) {
    const { count } = await supabase
      .from('views')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creatorId)
      .eq('device_fingerprint', input.deviceFingerprint.trim())
      .gte('created_at', dayStart);
    if ((count ?? 0) >= caps.maxViewsPerDevicePerDay) {
      const r = invalidResult('device_limit');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
  }

  // Cap: views per IP per day
  if (decision.valid && ipHash) {
    const { count } = await supabase
      .from('views')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creatorId)
      .eq('ip_hash', ipHash)
      .gte('created_at', dayStart);
    if ((count ?? 0) >= caps.maxViewsPerIpPerDay) {
      const r = invalidResult('ip_limit');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
  }

  // Earnings caps (daily)
  if (decision.valid && decision.earning > 0) {
    const creatorToday = await sumEarningsSince(supabase, creatorId, dayStart);
    if (creatorToday + decision.earning > caps.creatorDailyEarningCap) {
      const r = invalidResult('creator_daily_cap');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
    const { data: campAgg } = await supabase
      .from('campaigns')
      .select('total_earnings')
      .eq('id', campaignId)
      .maybeSingle();
    // approximate daily campaign earnings via ledger
    const { data: campToday } = await supabase
      .from('earnings')
      .select('amount')
      .eq('campaign_id', campaignId)
      .gte('created_at', dayStart);
    const campDaily = (campToday || []).reduce((s, e) => s + Number(e.amount || 0), 0);
    if (campDaily + decision.earning > caps.campaignDailyEarningCap) {
      const r = invalidResult('campaign_daily_cap');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
    void campAgg;
    const { data: platToday } = await supabase
      .from('earnings')
      .select('amount')
      .eq('type', 'view_earning')
      .gte('created_at', dayStart);
    const platformToday = (platToday || []).reduce((s, e) => s + Number(e.amount || 0), 0);
    if (platformToday + decision.earning > caps.platformDailyEarningCap) {
      const r = invalidResult('platform_daily_cap');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
  }

  // ---------------------------------------------------------------
  // 4. Duplicate device within window (only when device dup blocking on)
  // ---------------------------------------------------------------
  if (decision.valid && caps.duplicateDeviceBlock && input.deviceFingerprint) {
    const since = new Date(now - caps.duplicateIpWindowHours * 3600_000).toISOString();
    const { data: dup } = await supabase
      .from('views')
      .select('id')
      .eq('creator_id', creatorId)
      .eq('device_fingerprint', input.deviceFingerprint.trim())
      .gte('created_at', since)
      .limit(1);
    if (dup && dup.length > 0) {
      const r = invalidResult('duplicate_device');
      r.cpm = decision.cpm; r.levelMultiplier = decision.levelMultiplier;
      return r;
    }
  }

  // ---------------------------------------------------------------
  // 5. Persist the view — using the atomic RPC that combines the
  //    24h duplicate-IP check with the INSERT in one transaction.
  //    This prevents two concurrent requests from both crediting
  //    earnings for the same campaign + IP within 24 hours.
  // ---------------------------------------------------------------
  const capsIpWindow = caps.duplicateIpWindowHours ?? 24;
  let inserted: { id: string } | null = null;
  let duplicateIpDetected = false;

  const viewInsertData = {
    campaign_id: campaignId,
    creator_id: creatorId,
    visitor_ip: input.visitorIp && input.visitorIp !== 'unknown' ? input.visitorIp : null,
    ip_hash: ipHash,
    country_code: countryCode,
    device_fingerprint: input.deviceFingerprint?.trim() || null,
    user_agent: input.userAgent || null,
    is_vpn: fraud.isVpn,
    is_proxy: fraud.isProxy,
    is_bot: fraud.isBot,
    is_emulator: fraud.isEmulator,
    fraud_score: fraud.fraudScore,
    status: finalValid ? 'valid' : 'invalid',
    invalid_reason: finalValid ? null : (finalReason ?? 'other'),
    cpm_rate: decision.cpm,
    earnings: finalValid ? finalEarning : 0,
    tasks_completed: input.tasksCompleted ?? [],
    validated_at: finalValid ? new Date().toISOString() : null,
    idempotency_key: idemKey,
  };

  // Try the atomic RPC first (migration 0017). If it doesn't exist
  // (dev/test environments), fall back to the original approach.
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
      // If the RPC doesn't exist (404/42881), fall through to direct insert.
      // 42881 = undefined_function in PostgreSQL.
      const errCode = (rpcErr as unknown as Record<string, unknown>).code;
      if (typeof errCode === 'string' && errCode === '42881') {
        useRpc = false;
      } else {
        // Unique constraint violation from the RPC — another request won.
        if (typeof errCode === 'string' && errCode === '23505') {
          return invalidResult('duplicate_request');
        }
        console.error('[earnings] record_view_with_ip_check failed', rpcErr);
        return invalidResult('internal');
      }
    } else if (rpcResult && typeof rpcResult === 'object') {
      const result = rpcResult as Record<string, unknown>;
      inserted = result.view_id ? { id: result.view_id as string } : null;
      duplicateIpDetected = result.duplicate_ip === true;
      if (duplicateIpDetected && finalValid) {
        finalValid = false;
        finalReason = 'duplicate_ip_24h';
        finalEarning = 0;
      }
    }
  } catch {
    // RPC invocation failed (function doesn't exist) — fall back.
    useRpc = false;
  }

  // Fallback: direct INSERT + advisory lock for environments without
  // the migration 0017 RPC (development/testing).
  if (!useRpc) {
    // Advisory lock per (campaign, IP) pair to prevent concurrent
    // duplicate credited views.
    if (finalValid && ipHash) {
      try {
        await supabase.rpc('pg_advisory_xact_lock', {
          p_key: Number('0x' + createHash('sha256').update(`${campaignId}:${ipHash}`).digest('hex').slice(0, 16)),
        });
      } catch {
        // Advisory lock function may not exist in dev — continue
        // with best-effort duplicate check.
      }
      const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const { data: existingSameIp } = await supabase
        .from('views')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('ip_hash', ipHash)
        .eq('status', 'valid')
        .gte('created_at', since24h)
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

  // ---------------------------------------------------------------
  // 6. Credit atomically: earnings ledger + counters in one RPC.
  //    The RPC re-validates view ownership and caps server-side.
  // ---------------------------------------------------------------
  if (inserted) {
    const description = `View earning @ $${decision.cpm.toFixed(2)} CPM × ${decision.levelMultiplier}x level`;
    const { data: credit, error: cErr } = await supabase.rpc('credit_view_earning', {
      p_view_id: inserted.id,
      p_campaign_id: campaignId,
      p_creator_id: creatorId,
      p_valid: decision.valid,
      p_cpm: decision.cpm,
      p_earning: decision.valid ? decision.earning : 0,
      p_level_multiplier: decision.levelMultiplier,
      p_description: description,
    });
    if (cErr) {
      console.error('[earnings] credit_view_earning failed', cErr);
      // Never report a payout-eligible view when the protected accounting
      // transaction did not complete.
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
      // Compatibility with a database that has not yet applied migration
      // 0008. Production deployments use the structured response above.
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
  };
}

function invalidResult(reason: string): RecordViewResult {
  return { valid: false, reason, cpm: 0, levelMultiplier: 1, earning: 0, countryCode: null, fraudScore: 0, duplicate: false };
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
