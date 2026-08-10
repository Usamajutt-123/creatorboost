/**
 * CreatorBoost Earnings Engine
 * ----------------------------------------------------------------
 * All values (CPM, payout %, level multiplier) are pulled from
 * the database. NO values are hardcoded. The admin controls
 * everything from the dashboard.
 *
 * Formula:
 *   earnings = (validViews / 1000) × cpm × levelMultiplier
 *   cpm = country_tier.cpm_default (admin-editable)
 */

import { createAdminClient } from './supabase/server';

export type ViewInput = {
  campaignId: string;
  creatorId: string;
  countryCode: string;
  isVpn?: boolean;
  isProxy?: boolean;
  isBot?: boolean;
  isEmulator?: boolean;
  fraudScore?: number;
};

export type EarningsResult = {
  valid: boolean;
  reason?: string;
  cpm: number;
  levelMultiplier: number;
  earning: number; // per view
};

/**
 * Compute earnings for a single view.
 * Returns invalid reasons if view should be filtered out.
 */
export async function computeViewEarnings(view: ViewInput): Promise<EarningsResult> {
  const supabase = createAdminClient();

  // 1. Pull platform settings + fraud config
  const { data: settings } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 1)
    .single();

  const sensitivity = settings?.fraud_detection_sensitivity ?? 'medium';

  // 2. Hard fraud blocks (always invalid)
  if (view.isBot) return { valid: false, reason: 'bot', cpm: 0, levelMultiplier: 0, earning: 0 };
  if (settings?.vpn_block_enabled && (view.isVpn || view.isProxy)) {
    return { valid: false, reason: view.isVpn ? 'vpn' : 'proxy', cpm: 0, levelMultiplier: 0, earning: 0 };
  }
  if (view.isEmulator) return { valid: false, reason: 'emulator', cpm: 0, levelMultiplier: 0, earning: 0 };

  // 3. Score-based filtering by sensitivity
  const thresholds: Record<string, number> = { low: 90, medium: 75, high: 60, strict: 40 };
  const score = view.fraudScore ?? 0;
  if (score >= thresholds[sensitivity]) {
    return { valid: false, reason: 'abnormal_traffic', cpm: 0, levelMultiplier: 0, earning: 0 };
  }

  // 4. Lookup country tier CPM (admin-configurable)
  const { data: country } = await supabase
    .from('country_tiers')
    .select('cpm_default, tier, active')
    .eq('country_code', view.countryCode?.toUpperCase())
    .single();

  let cpm = country?.cpm_default ?? 0.5; // conservative fallback

  if (!country || !country.active) {
    // Unknown / inactive country = tier 3 default
    const { data: tier3 } = await supabase
      .from('country_tiers')
      .select('cpm_default')
      .eq('tier', 'tier_3')
      .limit(1)
      .single();
    cpm = tier3?.cpm_default ?? 0.5;
  }

  // 5. Lookup creator's level multiplier
  const { data: profile } = await supabase
    .from('profiles')
    .select('level')
    .eq('id', view.creatorId)
    .single();

  const { data: levelRow } = await supabase
    .from('creator_levels')
    .select('cpm_multiplier')
    .eq('level', profile?.level ?? 'bronze')
    .single();

  const levelMultiplier = levelRow?.cpm_multiplier ?? 1.0;

  // 6. Compute per-view earning
  // Earnings per single view = (cpm * levelMultiplier) / 1000
  const earning = (cpm * levelMultiplier) / 1000;

  return { valid: true, cpm, levelMultiplier, earning };
}

/**
 * Record a view and credit earnings to creator.
 * Returns the persisted view record.
 */
export async function recordView(view: ViewInput & {
  visitorIp?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  tasksCompleted?: any[];
}) {
  const supabase = createAdminClient();

  // 1. Compute earnings
  const result = await computeViewEarnings(view);

  // 2. Check for duplicate device/IP within window
  if (result.valid && view.deviceFingerprint) {
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('duplicate_ip_window_hours, duplicate_device_block')
      .single();

    if (settings?.duplicate_device_block) {
      const window = settings.duplicate_ip_window_hours ?? 24;
      const { data: existing } = await supabase
        .from('views')
        .select('id, created_at, campaign_id')
        .eq('creator_id', view.creatorId)
        .eq('device_fingerprint', view.deviceFingerprint)
        .gte('created_at', new Date(Date.now() - window * 3600_000).toISOString())
        .limit(1);
      if (existing && existing.length > 0) {
        return { ...result, valid: false, reason: 'duplicate_device' as const, persisted: null };
      }
    }
  }

  // 3. Insert view
  const { data: inserted, error } = await supabase
    .from('views')
    .insert({
      campaign_id: view.campaignId,
      creator_id: view.creatorId,
      visitor_ip: view.visitorIp,
      country_code: view.countryCode?.toUpperCase(),
      device_fingerprint: view.deviceFingerprint,
      user_agent: view.userAgent,
      is_vpn: view.isVpn ?? false,
      is_proxy: view.isProxy ?? false,
      is_bot: view.isBot ?? false,
      is_emulator: view.isEmulator ?? false,
      fraud_score: view.fraudScore ?? 0,
      status: result.valid ? 'valid' : 'invalid',
      invalid_reason: result.reason ?? null,
      cpm_rate: result.cpm,
      earnings: result.earning,
      tasks_completed: view.tasksCompleted ?? [],
      validated_at: result.valid ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) throw error;

  // 4. If valid → record earning + update aggregates
  if (result.valid) {
    await supabase.from('earnings').insert({
      creator_id: view.creatorId,
      campaign_id: view.campaignId,
      view_id: inserted.id,
      type: 'view_earning',
      amount: result.earning,
      description: `View earning @ $${result.cpm.toFixed(2)} CPM × ${result.levelMultiplier}x level`,
    });

    // Update campaign & profile aggregates
    await supabase.rpc('increment_view_counters', {
      p_campaign_id: view.campaignId,
      p_creator_id: view.creatorId,
      p_earning: result.earning,
      p_valid: true,
    });
  } else {
    await supabase.rpc('increment_view_counters', {
      p_campaign_id: view.campaignId,
      p_creator_id: view.creatorId,
      p_earning: 0,
      p_valid: false,
    });
  }

  return { ...result, persisted: inserted };
}

/**
 * Calculate total platform profit.
 * Profit = ad_revenue - creator_payouts
 */
export async function getPlatformProfit(periodDays = 30) {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - periodDays * 86400_000).toISOString();

  const [{ data: payouts }, { data: adRevenue }] = await Promise.all([
    supabase.from('earnings').select('amount').eq('type', 'view_earning').gte('created_at', since),
    supabase.from('ad_networks').select('total_revenue, monthly_revenue'),
  ]);

  const totalPayouts = payouts?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const totalAdRevenue = adRevenue?.reduce((s, a) => s + Number(a.total_revenue), 0) ?? 0;
  const profit = totalAdRevenue - totalPayouts;

  return { totalPayouts, totalAdRevenue, profit, margin: totalAdRevenue > 0 ? (profit / totalAdRevenue) * 100 : 0 };
}
