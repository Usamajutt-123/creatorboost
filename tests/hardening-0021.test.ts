/**
 * Static + unit coverage for the migration-0021 hardening round.
 *
 * These assert the invariants the audit required, at the layer where each one
 * is actually enforced:
 *
 *   * creators cannot reach raw fraud columns or another creator's traffic
 *     -> table grants, RLS policies and the creator-safe projection (SQL)
 *   * suspended/banned admins lose privileges
 *     -> is_admin()/is_super_admin() (SQL) and requireAdmin() (TS)
 *   * view + ledger are atomic
 *     -> record_view_and_credit() (SQL) and the engine call site (TS)
 *   * creator analytics exclude hidden security traffic
 *     -> campaign_* views (SQL) and the dashboard queries (TS)
 *   * withdrawal methods cannot be configured beyond the enum
 *     -> CHECK constraint (SQL) + the shared list (TS)
 *
 * They run without a live database, in the same schema-as-code style as
 * tests/database-security.test.ts, so a regression in the migration is caught
 * even though CI has no PostgreSQL instance.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const allSql = migrationFiles.map(f => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
const m21 = read('supabase/migrations/0021_privacy_atomicity_authz.sql');

// =====================================================================
describe('1. creator raw traffic / fraud data access', () => {
  it('removes every browser-role grant on the raw views table', () => {
    expect(m21).toContain('REVOKE ALL ON TABLE public.views FROM anon, authenticated');
  });

  it('drops the creator SELECT policy that exposed raw view rows', () => {
    expect(m21).toContain('DROP POLICY IF EXISTS creators_read_own_views ON public.views');
  });

  it('exposes a creator-safe projection instead', () => {
    expect(m21).toContain('CREATE VIEW public.creator_view_analytics');
    expect(m21).toContain('GRANT SELECT ON public.creator_view_analytics TO authenticated');
  });

  it('the projection selects NO fraud or identifying column', () => {
    const view = m21.slice(
      m21.indexOf('CREATE VIEW public.creator_view_analytics'),
      m21.indexOf('REVOKE ALL ON public.creator_view_analytics'),
    );
    for (const forbidden of [
      'visitor_ip', 'ip_hash', 'device_fingerprint', 'fraud_score',
      'is_bot', 'is_vpn', 'is_proxy', 'is_emulator',
      'invalid_reason', 'traffic_category', 'eligibility_window_start',
    ]) {
      expect(view, `creator projection must not expose ${forbidden}`).not.toContain(forbidden);
    }
    // The user agent is only READ to derive a coarse bucket; the raw string
    // is never a selected output column.
    expect(view).toContain('public.view_device_category(v.user_agent) AS device_category');
    expect(view).not.toMatch(/\bv\.user_agent\s+AS\b/);
  });

  it('the projection is scoped to the caller, so one creator cannot read another', () => {
    expect(m21).toMatch(/creator_view_analytics[\s\S]*?v\.creator_id = auth\.uid\(\) OR public\.is_admin\(\)/);
  });

  it('the projection contains only earning-eligible traffic', () => {
    const view = m21.slice(
      m21.indexOf('CREATE VIEW public.creator_view_analytics'),
      m21.indexOf('REVOKE ALL ON public.creator_view_analytics'),
    );
    expect(view).toContain("v.status = 'valid'");
    expect(view).toContain('earning_eligible');
  });

  it('creator dashboards read the projection, never the raw table', () => {
    for (const page of [
      'src/app/dashboard/analytics/page.tsx',
      'src/app/dashboard/campaigns/[id]/page.tsx',
      'src/app/dashboard/page.tsx',
    ]) {
      const source = read(page);
      expect(source, `${page} must use the safe projection`).toContain('creator_view_analytics');
      expect(source, `${page} must not query the raw views table`).not.toContain(".from('views')");
    }
  });

  it('the creator dashboard no longer ships raw user agents to the browser', () => {
    const dashboard = read('src/app/dashboard/page.tsx');
    expect(dashboard).toContain(".select('country_code, device_category')");
    // No query selects the raw user agent (comments may still mention it).
    expect(dashboard).not.toMatch(/\.select\([^)]*user_agent/);
  });
});

// =====================================================================
describe('2. hidden traffic leakage from aggregate views', () => {
  const aggregates = ['campaign_summary', 'campaign_daily_stats', 'campaign_country_stats', 'creator_campaign_traffic'];

  it.each(aggregates)('%s filters out creator-hidden security traffic', name => {
    const start = m21.indexOf(`CREATE VIEW public.${name}`);
    expect(start, `${name} must be redefined in 0021`).toBeGreaterThan(-1);
    const body = m21.slice(start, start + 1_400);
    expect(body).toContain('public.view_category_is_creator_visible');
  });

  it.each(aggregates)('%s scopes rows to the caller', name => {
    const start = m21.indexOf(`CREATE VIEW public.${name}`);
    const body = m21.slice(start, start + 1_400);
    expect(body).toContain('auth.uid() OR public.is_admin()');
  });

  it('admin traffic-quality analytics still see the COMPLETE picture', () => {
    // The admin RPCs from 0020 aggregate over the whole `views` table with no
    // creator-visibility filter, and 0021 does not touch them.
    const m20 = read('supabase/migrations/0020_view_traffic_attribution.sql');
    expect(m20).toContain('admin_view_traffic_summary');
    expect(m20).toContain('admin_view_traffic_daily');
    expect(m20).toMatch(/admin_view_traffic_daily[\s\S]*?fraud_blocked/);
    expect(m21).not.toContain('CREATE OR REPLACE FUNCTION public.admin_view_traffic_summary');
  });

  it('the admin RPCs require admin privileges', () => {
    const m20 = read('supabase/migrations/0020_view_traffic_attribution.sql');
    const calls = m20.match(/IF NOT public\.is_admin\(\) THEN/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});

// =====================================================================
describe('3. suspended / banned admin authorization', () => {
  it('is_admin() requires an ACTIVE account, not just the role', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.is_admin()'),
      m21.indexOf('CREATE OR REPLACE FUNCTION public.is_super_admin()'));
    expect(fn).toContain("role IN ('admin', 'super_admin')");
    expect(fn).toContain("status = 'active'");
  });

  it('is_super_admin() requires an ACTIVE account', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.is_super_admin()'),
      m21.indexOf('COMMENT ON FUNCTION public.is_admin()'));
    expect(fn).toContain("role = 'super_admin'");
    expect(fn).toContain("status = 'active'");
  });

  it('the withdrawal RPCs authorize through is_admin(), so they inherit the rule', () => {
    const m8 = read('supabase/migrations/0008_production_repair.sql');
    for (const rpc of ['approve_withdrawal', 'pay_withdrawal', 'reject_withdrawal']) {
      const start = m8.indexOf(`FUNCTION public.${rpc}(`);
      expect(start).toBeGreaterThan(-1);
      expect(m8.slice(start, start + 900)).toContain('NOT public.is_admin()');
    }
  });

  it('the server-side guards check status too', () => {
    const adminServer = read('src/lib/admin-server.ts');
    expect(adminServer).toContain('function assertActive');
    expect(adminServer).toMatch(/assertActive\(admin\);\s*\n\s*return admin;/);
    // Both guards call it.
    expect((adminServer.match(/assertActive\(admin\);/g) || []).length).toBe(2);
  });

  it('the admin layout redirects a suspended/banned admin (UI layer)', () => {
    const layout = read('src/app/admin/layout.tsx');
    expect(layout).toContain("profile?.status === 'suspended'");
    expect(layout).toContain("profile?.status === 'banned'");
  });

  it('normal creators are not accidentally blocked', () => {
    // The predicate is role-then-status; a creator fails on role, exactly as
    // before, and no creator-facing policy gained a status requirement.
    const creatorPolicies = m21.match(/auth\.uid\(\) OR public\.is_admin\(\)/g) || [];
    expect(creatorPolicies.length).toBeGreaterThan(0);
    expect(m21).not.toMatch(/creator[a-z_]*\s+.*status = 'active'/i);
  });
});

// =====================================================================
describe('4. atomic view insertion + financial accounting', () => {
  const fnStart = m21.indexOf('CREATE OR REPLACE FUNCTION public.record_view_and_credit(');
  const fnEnd = m21.indexOf('REVOKE EXECUTE ON FUNCTION public.record_view_and_credit(');
  const fn = m21.slice(fnStart, fnEnd);

  it('the atomic RPC exists', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('performs the whole critical path in one function body', () => {
    // view insert, ledger insert, campaign counters, creator counters,
    // pending balance and referral commission all live here.
    expect(fn).toContain('INSERT INTO views');
    expect(fn).toContain('INSERT INTO earnings');
    expect(fn).toContain('UPDATE campaigns');
    expect(fn).toContain('UPDATE profiles');
    expect(fn).toContain('pending_earnings = pending_earnings +');
    expect(fn).toContain('credit_referral_commission');
  });

  it('aborts the transaction rather than leaving a paid view with no ledger row', () => {
    expect(fn).toContain('RAISE EXCEPTION');
    expect(fn).toMatch(/IF v_earning_id IS NULL THEN\s*\n\s*RAISE EXCEPTION/);
  });

  it('keeps idempotency: a replay returns the original outcome', () => {
    expect(fn).toContain('idempotency_key = p_idempotency_key');
    expect(fn).toContain("'replayed', TRUE");
  });

  it('keeps duplicate protection and concurrency protection', () => {
    expect(fn).toContain('pg_advisory_xact_lock');
    expect(fn).toContain("v_reason := 'duplicate_ip_24h'");
    expect(fn).toContain('WHEN unique_violation THEN');
  });

  it('keeps every existing financial cap', () => {
    expect(fn).toContain('max_earnings_per_view');
    expect(fn).toContain('creator_daily_cap');
    expect(fn).toContain('campaign_daily_cap');
    expect(fn).toContain('platform_daily_cap');
    expect(fn).toContain('earning_holding_hours');
  });

  it('is service-role only', () => {
    expect(m21).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_view_and_credit\([\s\S]*?FROM PUBLIC, anon, authenticated/);
    expect(m21).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_view_and_credit\([\s\S]*?TO service_role/);
  });

  it('the engine calls the atomic RPC as its primary path', () => {
    const earnings = read('src/lib/earnings.ts');
    expect(earnings).toContain("supabase.rpc('record_view_and_credit'");
    // And treats a real failure as non-payable rather than continuing.
    expect(earnings).toContain("return invalidResult(atomic.reason)");
  });

  it('zero CPM stays safe (no negative or NaN earning)', () => {
    expect(fn).toContain('GREATEST(COALESCE(p_earnings, 0), 0)');
    expect(fn).toContain('IF v_earning < 0 THEN v_earning := 0; END IF;');
  });
});

// =====================================================================
describe('5. CPM country security', () => {
  it('signup metadata cannot auto-assign a premium CPM country', () => {
    expect(m21).toContain('CREATE OR REPLACE FUNCTION public.trusted_signup_cpm_country');
    expect(m21).toMatch(/tier IN \('tier_1', 'tier_2'\)[\s\S]*?THEN NULL/);
  });

  it('handle_new_user routes the signup country through the trusted filter', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()'),
      m21.indexOf('-- Trusted provisioning'));
    expect(fn).toContain('public.trusted_signup_cpm_country(v_country)');
    // The display country is still stored verbatim (normalized).
    expect(fn).toContain('v_country,');
  });

  it('validates and normalizes the country code', () => {
    expect(m21).toContain("!~ '^[A-Za-z]{2}$'");
    expect(m21).toContain('upper(p_country)');
  });

  it('trusted provisioning is fill-once and service-role only', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.provision_cpm_country('),
      m21.indexOf('REVOKE EXECUTE ON FUNCTION public.provision_cpm_country'));
    // Never overwrites an existing value.
    expect(fn).toContain("IF NOT FOUND OR COALESCE(v_current, '') <> '' THEN RETURN FALSE");
    expect(m21).toContain('REVOKE EXECUTE ON FUNCTION public.provision_cpm_country(UUID, TEXT) FROM PUBLIC, anon, authenticated');
    expect(m21).toContain('GRANT EXECUTE ON FUNCTION public.provision_cpm_country(UUID, TEXT) TO service_role');
  });

  it('creators still cannot write cpm_country_code directly', () => {
    expect(allSql).toContain('REVOKE UPDATE (cpm_country_code) ON TABLE public.profiles');
    expect(allSql).not.toMatch(/GRANT UPDATE \([^)]*cpm_country_code[^)]*\) ON TABLE profiles TO authenticated/);
  });

  it('the server provisions from the IP-derived country, not from the browser', () => {
    const layout = read('src/app/dashboard/layout.tsx');
    expect(layout).toContain('provision_cpm_country');
    expect(layout).toContain('getClientIpFromHeaders');
    expect(layout).toContain('getCountryFromIP');
  });

  it('the earnings engine still reads only the trusted column', () => {
    const earnings = read('src/lib/earnings.ts');
    expect(earnings).toContain("select('level, status, cpm_country_code')");
    // An invalid/absent trusted country falls back to Global CPM.
    expect(earnings).toContain('sanitizeCountryCode');
  });
});

// =====================================================================
describe('6. public API discloses no payout information', () => {
  const route = read('src/app/api/views/record/route.ts');

  it('returns only an unlock signal', () => {
    expect(route).toContain('NextResponse.json({ unlocked: true })');
  });

  it('never returns eligibility, earning, CPM, fraud or duplicate detail', () => {
    // The response construction must not reference any of these.
    const responseBlock = route.slice(route.indexOf('const response = NextResponse.json'), route.indexOf('response.cookies.set'));
    for (const leak of ['payoutEligible', 'earning', 'cpm', 'fraud', 'reason', 'category', 'duplicate']) {
      expect(responseBlock, `response must not disclose ${leak}`).not.toContain(leak);
    }
  });

  it('still returns proper errors for genuinely invalid requests', () => {
    expect(route).toContain('status: 404');
    expect(route).toContain('status: 410');
    expect(route).toContain('status: 429');
    expect(route).toContain('status: 400');
  });
});

// =====================================================================
describe('7. task session verification', () => {
  const route = read('src/app/api/views/record/route.ts');

  it('the endpoint requires a server-issued session', () => {
    expect(route).toContain('verifyTaskSession');
    expect(route).toContain('if (!session.ok)');
  });

  it('the campaign page issues one', () => {
    expect(read('src/app/c/[slug]/page.tsx')).toContain('createTaskSession');
  });

  it('does not claim third-party social verification', () => {
    const source = read('src/lib/task-session.ts');
    expect(source).toMatch(/cannot verify/i);
    expect(source).toMatch(/task interaction/i);
  });
});

// =====================================================================
describe('9. duplicate window matches the configured setting', () => {
  it('the uniqueness bucket is derived from duplicate_ip_window_hours', () => {
    expect(m21).toContain('CREATE OR REPLACE FUNCTION public.duplicate_window_seconds()');
    expect(m21).toContain('duplicate_ip_window_hours');
    const guard = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.views_attribution_guard()'),
      m21.indexOf('-- The unique index itself is unchanged'));
    expect(guard).toContain('public.duplicate_window_seconds()');
    // The old fixed UTC-day divisor is gone from the guard.
    expect(guard).not.toContain('86400');
  });

  it('different campaigns stay independent (the key includes campaign_id)', () => {
    const m20 = read('supabase/migrations/0020_view_traffic_attribution.sql');
    expect(m20).toContain('ON public.views (campaign_id, ip_hash, eligibility_window_start)');
  });
});

// =====================================================================
describe('10. unlock cookie hardening', () => {
  const token = read('src/lib/unlock-token.ts');

  it('has a short TTL', () => {
    expect(token).toContain('const TOKEN_TTL_MS = 5 * 60_000');
  });

  it('is campaign-bound and subject-bound', () => {
    expect(token).toContain('payload.campaignId !== campaignId');
    expect(token).toContain('payload.sub !== subject');
  });

  it('does not break unbound (legacy) tokens', () => {
    expect(token).toContain('if (payload.sub && payload.sub !== subject) return false;');
  });

  it('the destination page verifies the same binding', () => {
    expect(read('src/app/destination/[campaign]/page.tsx')).toContain('unlockSubject');
  });
});

// =====================================================================
describe('13. performance / scalability', () => {
  it('cap aggregates are computed in SQL, not by downloading rows', () => {
    expect(m21).toContain('CREATE OR REPLACE FUNCTION public.view_cap_snapshot');
    expect(m21).toContain('SUM(e.amount)');
    const earnings = read('src/lib/earnings.ts');
    expect(earnings).toContain("supabase.rpc('view_cap_snapshot'");
  });

  it('adds indexes that support the cap and analytics queries', () => {
    for (const index of [
      'idx_earnings_creator_type_created',
      'idx_earnings_campaign_type_created',
      'idx_earnings_type_created',
      'idx_views_creator_iphash_created',
      'idx_views_creator_device_created',
      'idx_rate_limit_window',
    ]) {
      expect(m21, `missing index ${index}`).toContain(index);
    }
  });

  it('minimizes work under the global platform lock', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.record_view_and_credit('),
      m21.indexOf('REVOKE EXECUTE ON FUNCTION public.record_view_and_credit('));
    const lockAt = fn.indexOf("pg_advisory_xact_lock(hashtext('creatorboost:platform-earnings'))");
    const settingsAt = fn.indexOf('SELECT * INTO v_caps FROM platform_settings');
    // The settings read (and the per-view cap clamp) happen BEFORE the global
    // lock is taken, so the serialized section is only the cap aggregates.
    expect(settingsAt).toBeGreaterThan(-1);
    expect(settingsAt).toBeLessThan(lockAt);
  });

  it('schedules the rate-limit cleanup that migration 0017 never ran', () => {
    const cron = read('src/app/api/cron/release-earnings/route.ts');
    expect(cron).toContain("supabase.rpc('cleanup_rate_limits')");
    expect(read('vercel.json')).toContain('/api/cron/release-earnings');
  });

  it('the geo cache no longer discards its whole working set on overflow', () => {
    const geo = read('src/lib/geo.ts');
    expect(geo).toContain('CACHE_EVICT_BATCH');
    expect(geo).not.toContain('if (cache.size >= CACHE_MAX) cache.clear();');
  });
});

// =====================================================================
describe('14. withdrawal method configuration', () => {
  it('the enum and the application list agree', () => {
    const init = read('supabase/migrations/0001_init.sql');
    const match = init.match(/CREATE TYPE withdraw_method AS ENUM \(([^)]*)\)/);
    expect(match).toBeTruthy();
    const enumLabels = [...match![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();

    const methods = read('src/lib/withdrawal-methods.ts');
    const listed = [...methods.matchAll(/^\s{2}'([a-z_]+)',$/gm)].map(m => m[1]).sort();

    expect(listed).toEqual(enumLabels);
    expect(enumLabels).toHaveLength(6);
  });

  it('the database refuses an unsupported method key', () => {
    expect(m21).toContain('withdrawal_method_config_supported_method');
    expect(m21).toContain("CHECK (method IN ('jazzcash', 'easypaisa', 'paypal', 'binance', 'usdt', 'bank'))");
  });

  it('the admin action refuses to configure an unsupported method', () => {
    const adminServer = read('src/lib/admin-server.ts');
    expect(adminServer).toContain('isSupportedWithdrawalMethod(method)');
    expect(adminServer).toContain('is not a supported withdrawal method');
  });

  it('the withdrawal request action validates the method too', () => {
    expect(read('src/lib/withdraw-actions.ts')).toContain('isSupportedWithdrawalMethod');
  });
});

// =====================================================================
describe('15. referral precision', () => {
  it('total_commission is widened to ledger precision', () => {
    expect(m21).toContain('ALTER COLUMN total_commission TYPE NUMERIC(14, 6)');
  });

  it('the atomic RPC does not round the commission to cents', () => {
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.record_view_and_credit('),
      m21.indexOf('REVOKE EXECUTE ON FUNCTION public.record_view_and_credit('));
    expect(fn).toContain('v_earning * v_pct / 100.0');
    expect(fn).not.toMatch(/ROUND\(v_earning \* v_pct/);
  });
});

// =====================================================================
describe('16. operational settings affect runtime', () => {
  it('signup_enabled is enforced where it cannot be bypassed', () => {
    expect(m21).toContain('Signups are currently disabled');
    const fn = m21.slice(m21.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()'),
      m21.indexOf('-- Trusted provisioning'));
    expect(fn).toContain('signup_enabled');
  });

  it('maintenance_mode gates requests in the proxy', () => {
    const mw = read('src/lib/supabase/middleware.ts');
    expect(mw).toContain('isMaintenanceExempt');
    expect(mw).toContain("NextResponse.rewrite(new URL('/maintenance'");
  });

  it('admins can still reach /admin while maintenance is on', () => {
    const settings = read('src/lib/operational-settings.ts');
    expect(settings).toContain("pathname.startsWith('/admin/')");
    expect(settings).toContain("pathname.startsWith('/api/cron/')");
  });

  it('maintenance fails OPEN so a database hiccup cannot black out the site', () => {
    const settings = read('src/lib/operational-settings.ts');
    expect(settings).toMatch(/maintenanceMode: false/);
  });

  it('the announcement is rendered and escaped as text, not HTML', () => {
    const banner = read('src/components/SiteAnnouncement.tsx');
    expect(banner).toContain('announcementActive');
    expect(banner).not.toContain('dangerouslySetInnerHTML');
    expect(read('src/app/layout.tsx')).toContain('<SiteAnnouncement />');
  });
});

// =====================================================================
describe('17. admin audit logging', () => {
  const adminServer = read('src/lib/admin-server.ts');

  it('critical mutations fail when they cannot be audited', () => {
    expect(adminServer).toContain('CRITICAL_AUDIT_ACTIONS');
    expect(adminServer).toContain('class AuditLogError');
    expect(adminServer).toContain('if (critical) throw new AuditLogError');
  });

  it('covers the security-sensitive actions the audit called out', () => {
    for (const action of [
      'role_change', 'user_status_suspended', 'user_status_banned',
      'cpm_changed', 'withdrawal_approve', 'withdrawal_pay', 'withdrawal_reject',
      'campaign_delete', 'settings_update',
    ]) {
      expect(adminServer, `audit must be reliable for ${action}`).toContain(`'${action}'`);
    }
  });

  it('no longer swallows a PostgREST error silently', () => {
    expect(adminServer).toContain('const { error } = await supabase.rpc(\'audit_action\'');
    expect(adminServer).toContain('if (error) {');
  });
});

// =====================================================================
describe('18. popunder sandboxing', () => {
  const ads = read('src/components/PlatformAdSlot.tsx');

  it('the popunder no longer executes on the main origin', () => {
    expect(ads).not.toContain('mountTrustedPopunderMarkup');
    expect(ads).not.toContain('document.createElement(\'script\')');
    expect(ads).toContain('mountSandboxedPopunder');
  });

  it('runs in an opaque origin (no allow-same-origin)', () => {
    // Assert the actual sandbox token list, not the surrounding prose.
    const tokens = [...ads.matchAll(/'(allow-[a-z- ]+)'/g)].map(m => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const value of tokens) {
      expect(value, 'no sandbox attribute may grant same-origin').not.toContain('allow-same-origin');
    }
    expect(tokens).toContain('allow-scripts allow-popups allow-popups-to-escape-sandbox');
  });

  it('preserves the popunder capability', () => {
    expect(ads).toContain('allow-popups');
  });
});

// =====================================================================
describe('19. withdrawal account details', () => {
  it('browser roles cannot select the column', () => {
    expect(m21).toContain('REVOKE SELECT (account_details) ON TABLE public.withdrawals FROM anon, authenticated');
  });

  it('the admin list ships a masked value, not the payment destination', () => {
    const adminServer = read('src/lib/admin-server.ts');
    expect(adminServer).toContain('account_masked');
    expect(adminServer).toContain('function maskAccountDetail');
    expect(adminServer).toContain('adminRevealWithdrawalAccount');
  });

  it('a reveal is audited', () => {
    const adminServer = read('src/lib/admin-server.ts');
    const fn = adminServer.slice(adminServer.indexOf('export async function adminRevealWithdrawalAccount'));
    expect(fn.slice(0, 900)).toContain("audit(admin, 'withdrawal_account_reveal'");
  });

  it('existing withdrawals keep working (the column is not dropped or altered)', () => {
    expect(m21).not.toMatch(/ALTER TABLE public\.withdrawals\s+DROP COLUMN account_details/);
  });
});

// =====================================================================
describe('20. service worker cache', () => {
  const sw = read('public/sw.js');

  it('bumps the cache version so old entries are purged', () => {
    expect(sw).toContain("const CACHE = 'creatorboost-v3'");
  });

  it('never caches RSC payloads for private pages', () => {
    expect(sw).toContain('function isPrivateRequest');
    expect(sw).toContain("url.searchParams.has('_rsc')");
    expect(sw).toContain("request.headers.get('RSC')");
    expect(sw).toContain('if (isPrivateRequest(url, request)) return;');
  });

  it('keeps every required private prefix out of cache', () => {
    for (const p of ['/dashboard', '/admin', '/api/', '/auth/', '/destination/', '/account/', '/settings', '/withdraw']) {
      expect(sw, `${p} must be blocked`).toContain(`'${p}'`);
    }
  });
});

// =====================================================================
describe('21. email HTML escaping', () => {
  const email = read('src/lib/email.ts');

  it('escapes every user-controlled value used in HTML', () => {
    expect(email).toContain('d[k] = escapeHtml(v)');
  });

  it('escapes environment-derived values interpolated into attributes', () => {
    expect(email).toContain('const s = escapeHtml(siteUrl())');
    expect(email).toContain('const support = escapeHtml(process.env.SUPPORT_EMAIL');
    // No raw env interpolation left in the templates.
    expect(email).not.toContain('${process.env.SUPPORT_EMAIL');
  });

  it('escapes the layout title', () => {
    expect(email).toContain('${escapeHtml(rawTitle)}');
  });

  it('does not HTML-escape the plain-text bodies (appearance preserved)', () => {
    expect(email).toContain('r[k] = String(v)');
    expect(email).toContain('text: `We received your support request #${r.ticketId}');
  });
});

// =====================================================================
describe('22. storage cleanup', () => {
  const actions = read('src/lib/campaign-actions.ts');

  it('removes replaced campaign images', () => {
    expect(actions).toContain('removeUnreferencedCampaignImages');
  });

  it('never deletes an object another record still references', () => {
    expect(actions).toContain('stillReferenced');
    expect(actions).toContain('if (error || (data && data.length > 0)) stillReferenced.add(path)');
  });

  it('ignores URLs that are not ours', () => {
    expect(actions).toContain('function campaignStoragePath');
    expect(actions).toContain('/storage/v1/object/public/');
  });
});

// =====================================================================
describe('23. API transport hardening', () => {
  it('the support endpoint enforces POST + application/json + a size limit', () => {
    const support = read('src/app/api/support/route.ts');
    expect(support).toContain('validateJsonRequestEnvelope');
    expect(support).toContain('exceedsPayloadLimit');
    expect(support).toContain('MAX_SUPPORT_PAYLOAD_BYTES');
  });

  it('financial mutations remain POST-only', () => {
    const route = read('src/app/api/views/record/route.ts');
    expect(route).toContain('export async function GET()');
    expect(route).toContain('405');
  });
});

// =====================================================================
describe('26. the dormant custom-page flow is not revived', () => {
  it('0021 does not touch campaign_pages / flow_* at all', () => {
    for (const symbol of ['campaign_pages', 'flow_type', 'flow_multiplier', 'flow_session_id']) {
      expect(m21, `0021 must not reference ${symbol}`).not.toContain(symbol);
    }
  });
});
