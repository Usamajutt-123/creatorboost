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
import { getCountryFromIP } from './geo';
import { assessFraud, hashIp, type FraudAssessment } from './fraud';

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

function sanitizeCountry(code: string | null): string | null {
  return code && /^[A-Z]{2}$/.test(code.toUpperCase()) ? code.toUpperCase() : null;
}

/**
 * Pure per-view earning formula, used by the engine and unit-tested.
 * earning = min((cpm * levelMultiplier) / 1000, maxEarningsPerView)
 */
export function computePerViewEarning(cpm: number, levelMultiplier: number, maxEarningsPerView: number): number {
  const raw = (Number(cpm) * Number(levelMultiplier)) / 1000;
  return Math.min(Number.isFinite(raw) && raw > 0 ? raw : 0, Number(maxEarningsPerView) || 1);
}

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

  // 3. Country tier CPM (admin-configurable). Unknown/inactive country ->
  //    conservative Tier-3 default (NEVER highest CPM).
  const country = sanitizeCountry(opts.countryCode);
  let cpm = 0.5; // conservative floor
  if (country) {
    const { data: row } = await supabase
      .from('country_tiers')
      .select('cpm_default, active')
      .eq('country_code', country)
      .maybeSingle();
    if (row && row.active) cpm = Number(row.cpm_default);
  }
  if (cpm <= 0) cpm = 0.5;

  // 4. Creator level multiplier
  const { data: profile } = await supabase
    .from('profiles')
    .select('level')
    .eq('id', opts.creatorId)
    .maybeSingle();
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
      .select('id, status, invalid_reason, cpm_rate, earnings, fraud_score, country_code')
      .eq('creator_id', creatorId)
      .eq('idempotency_key', idemKey)
      .maybeSingle();
    if (existing) {
      return {
        valid: existing.status === 'valid',
        reason: existing.invalid_reason ?? undefined,
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
  const countryCode = sanitizeCountry(await getCountryFromIP(input.visitorIp));
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
  // 5. Persist the view
  // ---------------------------------------------------------------
  const { data: inserted, error } = await supabase
    .from('views')
    .insert({
      campaign_id: campaignId,
      creator_id: creatorId,
      visitor_ip: input.visitorIp || null,
      ip_hash: ipHash,
      country_code: countryCode,
      device_fingerprint: input.deviceFingerprint?.trim() || null,
      user_agent: input.userAgent || null,
      is_vpn: fraud.isVpn,
      is_proxy: fraud.isProxy,
      is_bot: fraud.isBot,
      is_emulator: fraud.isEmulator,
      fraud_score: fraud.fraudScore,
      status: decision.valid ? 'valid' : 'invalid',
      invalid_reason: decision.valid ? null : (decision.reason ?? 'other'),
      cpm_rate: decision.cpm,
      earnings: decision.valid ? decision.earning : 0,
      tasks_completed: input.tasksCompleted ?? [],
      validated_at: decision.valid ? new Date().toISOString() : null,
      idempotency_key: idemKey,
    })
    .select()
    .maybeSingle();

  if (error) {
    // Unique idempotency violation -> another request won the race.
    if (typeof error.code === 'string' && error.code === '23505') {
      return invalidResult('duplicate_request');
    }
    console.error('[earnings] view insert failed', error);
    return invalidResult('internal');
  }

  // ---------------------------------------------------------------
  // 6. If valid -> earnings ledger + counters + referral commission
  // ---------------------------------------------------------------
  if (decision.valid && inserted) {
    const earningId = crypto.randomUUID();
    const { error: eErr } = await supabase.from('earnings').insert({
      id: earningId,
      creator_id: creatorId,
      campaign_id: campaignId,
      view_id: inserted.id,
      type: 'view_earning',
      amount: decision.earning,
      description: `View earning @ $${decision.cpm.toFixed(2)} CPM × ${decision.levelMultiplier}x level`,
    });
    if (!eErr) {
      await supabase.rpc('increment_view_counters', {
        p_campaign_id: campaignId,
        p_creator_id: creatorId,
        p_earning: decision.earning,
        p_valid: true,
      });
      await maybeCreditReferral(supabase, creatorId, decision.earning);
    }
  } else if (inserted) {
    await supabase.rpc('increment_view_counters', {
      p_campaign_id: campaignId,
      p_creator_id: creatorId,
      p_earning: 0,
      p_valid: false,
    });
  }

  return {
    valid: decision.valid,
    reason: decision.valid ? undefined : (decision.reason ?? 'other'),
    cpm: decision.cpm,
    levelMultiplier: decision.levelMultiplier,
    earning: decision.valid ? decision.earning : 0,
    countryCode,
    fraudScore: fraud.fraudScore,
    duplicate: false,
  };
}

function invalidResult(reason: string): RecordViewResult {
  return { valid: false, reason, cpm: 0, levelMultiplier: 1, earning: 0, countryCode: null, fraudScore: 0, duplicate: false };
}

/** Credit the referrer a % commission on a valid view earning. */
async function maybeCreditReferral(
  supabase: ReturnType<typeof createAdminClient>,
  creatorId: string,
  earning: number,
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
    const pct = Number(settings?.referral_percentage ?? 10) / 100;
    const commission = earning * pct;
    if (commission <= 0) return;

    // Prevent self-referral (should not exist, but guard anyway)
    if (profile.referred_by === creatorId) return;

    const { error } = await supabase.rpc('credit_referral_commission', {
      p_referrer_id: profile.referred_by,
      p_amount: commission,
      p_creator_id: creatorId,
    });
    if (error) console.error('[earnings] referral credit failed', error);
  } catch (e) {
    console.error('[earnings] referral lookup failed', e);
  }
}
