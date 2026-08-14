import { cache as reactCache } from 'react';
import { createClient } from '@/lib/supabase/server';

// The published React package only exports `cache` through the Next.js server
// runtime; under plain Node (unit tests) it is undefined, in which case these
// helpers degrade to plain functions (no memoization) — behavior in the app is
// unchanged.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : ((fn: unknown) => fn) as never;

/**
 * Request-scoped session/profile helpers.
 *
 * A dashboard request used to hit Supabase for the same data three times:
 * the middleware read `profiles(role,status)`, the dashboard layout read
 * `profiles.*`, and the page read `profiles.*` again — plus two separate
 * `auth.getUser()` round-trips. Layout and page render in the same request, so
 * those calls were pure duplicates sitting on the critical path.
 *
 * `cache()` memoizes per request only (never across requests or users), so
 * private profile data is still fetched fresh for every request and is never
 * shared between users. It only removes the duplicate round-trips inside one
 * render.
 */

/** Columns any dashboard/analytics screen renders. Replaces `select('*')`. */
export const DASHBOARD_PROFILE_COLUMNS =
  'id, full_name, email, role, status, level, country_code, cpm_country_code, total_earnings, available_balance, pending_earnings, referral_earnings, total_views, valid_views, invalid_views' as const;

export type DashboardProfile = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  level: string | null;
  country_code: string | null;
  cpm_country_code: string | null;
  total_earnings: number | null;
  available_balance: number | null;
  pending_earnings: number | null;
  referral_earnings: number | null;
  total_views: number | null;
  valid_views: number | null;
  invalid_views: number | null;
};

/** Server-verified user for the current request (deduped across layout + page). */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

/**
 * The signed-in creator's profile row for the current request.
 * Returns null when there is no session or no profile row.
 */
export const getDashboardProfile = cache(async (): Promise<DashboardProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select(DASHBOARD_PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();
  return (data as DashboardProfile | null) ?? null;
});
