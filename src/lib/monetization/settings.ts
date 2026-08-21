/**
 * Server-side monetization configuration loaders.
 *
 * Public flow pages and API routes read these values with the SERVICE ROLE
 * client. Nothing here is ever exposed to a creator payload: creators cannot
 * configure steps, ads, payout rates or flow settings — the admin panel is
 * the only editor, and every write goes through authorized server actions.
 */

import { cache as reactCache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import { sanitizeRichContent, sanitizeStepImageUrl } from './sanitize';
import { normalizePlatformAdCode, normalizePlatformAdUrl } from '@/lib/platform-ads';
import type { AdDeviceTarget, AdFrequency, AdNetwork, AdPlacement, PublicAdSlot } from './ad-constants';

// Re-export the client-safe constants so existing imports keep working, but
// keep this module server-only (client components import ./ad-constants).
export {
  AD_NETWORK_OPTIONS,
  AD_FORMAT_OPTIONS,
  AD_FORMAT_LABELS,
  isGestureFormat,
} from './ad-constants';
export type { PublicAdSlot } from './ad-constants';

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : ((fn: unknown) => fn) as never;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonetizationSettings = {
  flow_enabled: boolean;
  task_page_ads_enabled: boolean;
  progress_bar_enabled: boolean;
  educational_content_enabled: boolean;
  final_redirect_enabled: boolean;
  test_mode: boolean;
  steps_count: number;
  default_countdown_seconds: number;
  session_ttl_minutes: number;
};

export type MonetizationStep = {
  id: number;
  position: number;
  title: string;
  subtitle: string | null;
  intro: string | null;
  body_html: string | null;
  icon: string | null;
  image_url: string | null;
  button_text: string | null;
  countdown_seconds: number;
  status: 'enabled' | 'disabled';
};

export type MonetizationAdSlot = {
  id: number;
  page_key: string;
  slot_number: number;
  enabled: boolean;
  network: AdNetwork;
  format: string;
  zone_id: string | null;
  code: string | null;
  url: string | null;
  placement: AdPlacement;
  device_target: AdDeviceTarget;
  priority: number;
  frequency: AdFrequency;
};

export type MonetizationPayoutSettings = {
  creator_share_percent: number;
  min_payout_per_view: number;
  max_payout_per_view: number;
  fraud_adjustment_percent: number;
  fraud_adjustment_threshold: number;
};

export const DEFAULT_SETTINGS: MonetizationSettings = {
  flow_enabled: false,
  task_page_ads_enabled: false,
  progress_bar_enabled: true,
  educational_content_enabled: true,
  final_redirect_enabled: true,
  test_mode: false,
  steps_count: 4,
  default_countdown_seconds: 10,
  session_ttl_minutes: 30,
};

// ---------------------------------------------------------------------------
// Loaders (server-only)
// ---------------------------------------------------------------------------

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

export const loadMonetizationSettings = cache(async (): Promise<MonetizationSettings> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('monetization_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    // A transient database failure must never crash the public flow: the
    // defaults keep flow_enabled=false so visitors fall back to the direct
    // unlock path. The failure is logged for the operator.
    console.error('[monetization] settings load failed', error.message);
  }
  if (!data) return DEFAULT_SETTINGS;
  return {
    flow_enabled: toBool(data.flow_enabled, DEFAULT_SETTINGS.flow_enabled),
    task_page_ads_enabled: toBool(data.task_page_ads_enabled, DEFAULT_SETTINGS.task_page_ads_enabled),
    progress_bar_enabled: toBool(data.progress_bar_enabled, DEFAULT_SETTINGS.progress_bar_enabled),
    educational_content_enabled: toBool(data.educational_content_enabled, DEFAULT_SETTINGS.educational_content_enabled),
    final_redirect_enabled: toBool(data.final_redirect_enabled, DEFAULT_SETTINGS.final_redirect_enabled),
    test_mode: toBool(data.test_mode, DEFAULT_SETTINGS.test_mode),
    steps_count: toInt(data.steps_count, DEFAULT_SETTINGS.steps_count, 1, 12),
    default_countdown_seconds: toInt(data.default_countdown_seconds, DEFAULT_SETTINGS.default_countdown_seconds, 1, 120),
    session_ttl_minutes: toInt(data.session_ttl_minutes, DEFAULT_SETTINGS.session_ttl_minutes, 5, 240),
  };
});

/** Enabled steps in their configured order (admin-reorderable). */
export const loadActiveSteps = cache(async (): Promise<MonetizationStep[]> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('monetization_steps')
    .select('*')
    .eq('status', 'enabled')
    .order('position', { ascending: true })
    .limit(12);
  if (error) {
    console.error('[monetization] steps load failed', error.message);
    return [];
  }
  return (data || []) as MonetizationStep[];
});

export const loadAllSteps = cache(async (): Promise<MonetizationStep[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('monetization_steps')
    .select('*')
    .order('position', { ascending: true })
    .limit(12);
  return (data || []) as MonetizationStep[];
});

export const loadAdSlots = cache(async (): Promise<MonetizationAdSlot[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('monetization_ad_slots')
    .select('*')
    .order('page_key', { ascending: true })
    .order('slot_number', { ascending: true })
    .limit(300);
  return (data || []) as MonetizationAdSlot[];
});

export const loadPayoutSettings = cache(async (): Promise<MonetizationPayoutSettings> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('monetization_payout_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  return {
    creator_share_percent: Number(data?.creator_share_percent ?? 100),
    min_payout_per_view: Number(data?.min_payout_per_view ?? 0.0005),
    max_payout_per_view: Number(data?.max_payout_per_view ?? 0.05),
    fraud_adjustment_percent: Number(data?.fraud_adjustment_percent ?? 0),
    fraud_adjustment_threshold: Number(data?.fraud_adjustment_threshold ?? 40),
  };
});

// ---------------------------------------------------------------------------
// Public ad resolution
// ---------------------------------------------------------------------------

/** Coarse device detection from the trusted server-side User-Agent. */
export function deviceCategoryFromUA(userAgent: string | null | undefined): 'mobile' | 'desktop' | 'tablet' {
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) return 'tablet';
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
  return 'desktop';
}

/**
 * Resolves the enabled, device-appropriate slots for one page key.
 *
 * A slot renders publicly only when it is enabled AND has renderable code or
 * an http(s) URL — unless test mode is active, in which case a labeled
 * placeholder box is substituted so the layout can be tested safely.
 * Device targeting and priority are applied here on the server.
 */
export function resolvePageAdSlots(
  slots: MonetizationAdSlot[],
  pageKey: string,
  device: 'mobile' | 'desktop' | 'tablet',
  opts: { enabled: boolean; testMode: boolean },
): PublicAdSlot[] {
  if (!opts.enabled) return [];
  return slots
    .filter(slot => slot.page_key === pageKey && slot.enabled)
    .filter(slot => {
      if (slot.device_target === 'all') return true;
      return slot.device_target === (device === 'desktop' ? 'desktop' : 'mobile');
    })
    .sort((a, b) => (b.priority - a.priority) || (a.slot_number - b.slot_number))
    .map(slot => {
      const code = normalizePlatformAdCode(slot.code);
      const url = normalizePlatformAdUrl(slot.url);
      const hasContent = Boolean(code || url);
      // Disabled/misconfigured slots never produce an empty public ad box
      // outside test mode. In test mode every enabled slot renders as a
      // labeled placeholder so the layout can be tested safely.
      if (!opts.testMode && !hasContent) return null;
      return {
        key: `${slot.page_key}:${slot.slot_number}`,
        network: slot.network,
        format: slot.format,
        code,
        url,
        placement: slot.placement,
        frequency: slot.frequency,
        placeholder: opts.testMode || !hasContent,
      };
    })
    .filter((slot): slot is PublicAdSlot => slot !== null);
}

// ---------------------------------------------------------------------------
// Content preparation
// ---------------------------------------------------------------------------

/** Public-safe step content: sanitized once more before it reaches a page. */
export function prepareStepContent(step: MonetizationStep) {
  return {
    id: step.id,
    position: step.position,
    title: step.title.slice(0, 160),
    subtitle: step.subtitle?.slice(0, 300) || null,
    intro: step.intro?.slice(0, 2_000) || null,
    bodyHtml: sanitizeRichContent(step.body_html),
    icon: step.icon?.slice(0, 16) || null,
    imageUrl: sanitizeStepImageUrl(step.image_url),
    buttonText: step.button_text?.slice(0, 60) || null,
    countdownSeconds: Math.min(Math.max(step.countdown_seconds, 1), 120),
  };
}
