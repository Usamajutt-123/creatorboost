/**
 * Client-safe monetization constants and public ad slot shape.
 *
 * This module deliberately has NO server-only imports (no supabase/server,
 * no node:crypto) so it can be bundled into client components. The
 * server-side loaders live in ./settings.
 */

export const AD_NETWORK_OPTIONS = ['adsterra', 'monetag', 'custom', 'placeholder'] as const;

export type AdNetwork = (typeof AD_NETWORK_OPTIONS)[number];

export const AD_FORMAT_OPTIONS: Record<AdNetwork, string[]> = {
  adsterra: ['native_banner', 'standard_banner', 'social_bar', 'popunder', 'other'],
  monetag: ['multitag', 'onclick', 'inpage_push', 'vignette', 'other'],
  custom: ['other'],
  placeholder: ['other'],
};

export const AD_FORMAT_LABELS: Record<string, string> = {
  native_banner: 'Native Banner',
  standard_banner: 'Standard Banner',
  social_bar: 'Social Bar',
  popunder: 'Popunder',
  multitag: 'MultiTag',
  onclick: 'OnClick',
  inpage_push: 'In-Page Push',
  vignette: 'Vignette',
  other: 'Other',
};

export type AdPlacement = 'top' | 'middle' | 'bottom';
export type AdDeviceTarget = 'all' | 'desktop' | 'mobile';
export type AdFrequency = 'once_per_session' | 'every_view';

/** Safe, renderable public shape for one ad slot. */
export type PublicAdSlot = {
  key: string;
  network: AdNetwork;
  format: string;
  code: string | null;
  url: string | null;
  placement: AdPlacement;
  frequency: AdFrequency;
  /** True when test mode substitutes a labeled placeholder box. */
  placeholder: boolean;
};

const GESTURE_FORMATS = new Set(['popunder', 'onclick', 'vignette']);

/** Formats that run from a visitor gesture instead of rendering inline. */
export function isGestureFormat(format: string): boolean {
  return GESTURE_FORMATS.has(format);
}
