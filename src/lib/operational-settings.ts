/**
 * Operational settings that actually affect runtime.
 *
 * Four admin-editable flags existed in `platform_settings` and in the admin
 * Settings screen but changed NOTHING at runtime, which is worse than not
 * having them: an operator could switch on "Maintenance Mode", see it saved,
 * and the site would carry on serving normally.
 *
 * Their status is now explicit:
 *
 *   maintenance_mode         ENFORCED — the proxy shows a maintenance page for
 *                            public + creator routes. Admin routes and the
 *                            auth/account routes stay reachable so an operator
 *                            can turn it back off, and the cron endpoint keeps
 *                            running so earnings still mature.
 *   signup_enabled           ENFORCED — in the database, by `handle_new_user()`
 *                            (migration 0021). Enforcing it in the UI alone
 *                            would be bypassable by calling Supabase Auth
 *                            directly, so the gate is at profile creation.
 *   site_announcement        RENDERED — see `SiteAnnouncement`.
 *   site_announcement_active RENDERED — gates the banner above.
 *
 * The read is a narrow projection (`public_operational_settings`, migration
 * 0021) so fraud thresholds and earning caps are never exposed alongside it,
 * and it is cached briefly so the hot public path does not pay for a database
 * round-trip on every request.
 */

import { createAdminClient } from '@/lib/supabase/server';

export type OperationalSettings = {
  maintenanceMode: boolean;
  signupEnabled: boolean;
  announcement: string | null;
  announcementActive: boolean;
};

const DEFAULTS: OperationalSettings = {
  // Fail OPEN for maintenance: a database hiccup must not black out the site.
  maintenanceMode: false,
  signupEnabled: true,
  announcement: null,
  announcementActive: false,
};

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: OperationalSettings } | null = null;

/** Test hook: drop the short-lived cache. */
export function clearOperationalSettingsCache(): void {
  cached = null;
}

export async function getOperationalSettings(now = Date.now()): Promise<OperationalSettings> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('public_operational_settings')
      .select('maintenance_mode, signup_enabled, site_announcement, site_announcement_active')
      .maybeSingle();
    if (error || !data) return DEFAULTS;

    const announcement = typeof data.site_announcement === 'string' ? data.site_announcement.trim() : '';
    const value: OperationalSettings = {
      maintenanceMode: data.maintenance_mode === true,
      signupEnabled: data.signup_enabled !== false,
      announcement: announcement || null,
      announcementActive: data.site_announcement_active === true && Boolean(announcement),
    };
    cached = { at: now, value };
    return value;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Routes that stay reachable while maintenance mode is on.
 *
 * An operator must be able to sign in and turn maintenance back off, the
 * scheduled earnings-maturity job must keep running, and static/asset routes
 * must keep serving so the maintenance page itself renders.
 */
export function isMaintenanceExempt(pathname: string): boolean {
  return pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/api/cron/')
    || pathname.startsWith('/auth/')
    || pathname.startsWith('/account/')
    || pathname === '/login'
    || pathname === '/forgot-password'
    || pathname === '/maintenance'
    || pathname === '/robots.txt'
    || pathname === '/sitemap.xml'
    || pathname === '/site.webmanifest'
    || pathname === '/sw.js'
    || pathname === '/offline.html';
}
