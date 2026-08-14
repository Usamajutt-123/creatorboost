/**
 * Platform-owned advertising configuration for public unlock pages.
 *
 * These helpers deliberately know nothing about campaigns. Ad settings live in
 * the single `platform_settings` row and are resolved on the server before
 * being sent to an unlock page. A creator's campaign payload can therefore
 * never supply or override an ad placement.
 */

export const PLATFORM_AD_CODE_MAX_LENGTH = 5_000;
export const PLATFORM_AD_URL_MAX_LENGTH = 2_000;

export type PlatformAdPlacement = {
  /** Trusted, admin-supplied ad network markup. Takes priority over `url`. */
  code: string | null;
  /** Optional direct hosted-ad URL used when no network markup is supplied. */
  url: string | null;
};

export type PublicPlatformAds = {
  banner: PlatformAdPlacement | null;
  popunder: PlatformAdPlacement | null;
};

type RawPlatformAdSettings = {
  banner_enabled?: unknown;
  banner_code?: unknown;
  banner_url?: unknown;
  popunder_enabled?: unknown;
  popunder_code?: unknown;
  popunder_url?: unknown;
} | null | undefined;

function trimmedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

/** Non-empty markup within the database's configured length limit. */
export function normalizePlatformAdCode(value: unknown): string | null {
  return trimmedText(value, PLATFORM_AD_CODE_MAX_LENGTH);
}

/**
 * Hosted ad and popunder fallback URLs may only use browser-safe HTTP(S).
 * Credentials are intentionally rejected: publisher credentials belong in the
 * provider's code/configuration, never in a public URL.
 */
export function normalizePlatformAdUrl(value: unknown): string | null {
  const url = trimmedText(value, PLATFORM_AD_URL_MAX_LENGTH);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isValidPlatformAdUrl(value: unknown): boolean {
  return normalizePlatformAdUrl(value) !== null;
}

/**
 * Normalizes one placement. A placement only exists when it has something
 * renderable; this keeps disabled/misconfigured settings from producing an
 * empty public ad box.
 */
export function resolvePlatformAdPlacement(input: {
  code?: unknown;
  url?: unknown;
}): PlatformAdPlacement | null {
  const code = normalizePlatformAdCode(input.code);
  const url = normalizePlatformAdUrl(input.url);
  return code || url ? { code, url } : null;
}

/**
 * Produces the minimal public configuration for the unlock page. Disabled
 * placements and malformed values are discarded server-side, rather than
 * being interpreted by the browser.
 */
export function getPublicPlatformAds(settings: RawPlatformAdSettings): PublicPlatformAds {
  return {
    banner: settings?.banner_enabled === true
      ? resolvePlatformAdPlacement({ code: settings.banner_code, url: settings.banner_url })
      : null,
    popunder: settings?.popunder_enabled === true
      ? resolvePlatformAdPlacement({ code: settings.popunder_code, url: settings.popunder_url })
      : null,
  };
}
