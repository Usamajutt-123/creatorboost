/**
 * Admin analytics vs creator privacy.
 *
 * Requirement: the admin sees the FULL picture (total, paid, non-paid,
 * duplicates, bot/fraud blocked, earnings) through server-side aggregates,
 * while the creator sees only normal business metrics and never learns that a
 * visit was a duplicate or was blocked.
 *
 * Part 1 exercises the admin loaders (authorization + aggregation).
 * Part 2 is a source-level audit of the creator-facing surfaces, which is the
 * only way to prove a leak is *absent* from a server component's output.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const getSessionUser = vi.fn();
const getDashboardProfile = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
  getDashboardProfile: (...args: unknown[]) => getDashboardProfile(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: fromMock, rpc: rpcMock })),
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * Read a source file with its comments removed.
 *
 * The privacy audits below assert that a term never reaches a creator's
 * screen or query. Documentation that *explains* why duplicates are hidden is
 * not a leak, so block comments, JSX comments and line comments are stripped
 * before matching.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block + JSX comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, keeping "https://"
}

function asAdmin() {
  getSessionUser.mockResolvedValue({ id: 'admin-1' });
  getDashboardProfile.mockResolvedValue({ id: 'admin-1', role: 'admin', status: 'active' });
}

/** A realistic mixed-traffic day, as the DB aggregate would return it. */
const SUMMARY_ROWS = [
  { category: 'paid', views: 820, earnings: 5.125 },
  { category: 'duplicate_24h', views: 140, earnings: 0 },
  { category: 'duplicate_device', views: 25, earnings: 0 },
  { category: 'bot_or_automation', views: 60, earnings: 0 },
  { category: 'vpn_or_proxy', views: 30, earnings: 0 },
  { category: 'suspicious_traffic', views: 15, earnings: 0 },
  { category: 'earning_cap', views: 10, earnings: 0 },
];

afterEach(() => {
  vi.resetModules();
  getSessionUser.mockReset();
  getDashboardProfile.mockReset();
  fromMock.mockReset();
  rpcMock.mockReset();
});

// =====================================================================
describe('admin traffic summary — authorization', () => {
  it('rejects a creator', async () => {
    getSessionUser.mockResolvedValue({ id: 'creator-1' });
    getDashboardProfile.mockResolvedValue({ id: 'creator-1', role: 'creator', status: 'active' });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await expect(adminLoadViewTrafficSummary()).rejects.toThrow(/admin/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    getSessionUser.mockResolvedValue(null);
    getDashboardProfile.mockResolvedValue(null);
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await expect(adminLoadViewTrafficSummary()).rejects.toThrow(/authenticated/i);
  });

  it('rejects a creator asking for the daily trend', async () => {
    getSessionUser.mockResolvedValue({ id: 'creator-1' });
    getDashboardProfile.mockResolvedValue({ id: 'creator-1', role: 'creator', status: 'active' });
    const { adminLoadViewTrafficDaily } = await import('@/lib/admin-server');
    await expect(adminLoadViewTrafficDaily()).rejects.toThrow(/admin/i);
  });

  it('allows a super admin', async () => {
    getSessionUser.mockResolvedValue({ id: 'sa-1' });
    getDashboardProfile.mockResolvedValue({ id: 'sa-1', role: 'super_admin', status: 'active' });
    rpcMock.mockResolvedValue({ data: SUMMARY_ROWS, error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await expect(adminLoadViewTrafficSummary()).resolves.toBeTruthy();
  });
});

// =====================================================================
describe('admin traffic summary — the full picture', () => {
  it('exposes paid AND non-paid traffic with earnings', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: SUMMARY_ROWS, error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    const summary = await adminLoadViewTrafficSummary({ sinceDays: 30 });

    expect(summary.totalViews).toBe(1100);
    expect(summary.paidViews).toBe(820);
    expect(summary.nonPaidViews).toBe(280);
    expect(summary.duplicateViews).toBe(165); // 140 + 25
    expect(summary.fraudBlockedViews).toBe(105); // 60 + 30 + 15
    expect(summary.earnings).toBeCloseTo(5.125, 6);
    expect(summary.paidViews + summary.nonPaidViews).toBe(summary.totalViews);
  });

  it('breaks the non-paid traffic down by safe category', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: SUMMARY_ROWS, error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    const { byCategory } = await adminLoadViewTrafficSummary();

    expect(byCategory.duplicate_24h).toBe(140);
    expect(byCategory.bot_or_automation).toBe(60);
    expect(byCategory.vpn_or_proxy).toBe(30);
    expect(byCategory.earning_cap).toBe(10);
  });

  it('aggregates in the DATABASE, not by downloading raw view rows', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: SUMMARY_ROWS, error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await adminLoadViewTrafficSummary();

    expect(rpcMock).toHaveBeenCalledWith('admin_view_traffic_summary', expect.any(Object));
    // No `from('views')` select of raw rows.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('passes the campaign and creator scope through to the RPC', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await adminLoadViewTrafficSummary({ campaignId: 'camp-1', creatorId: 'creator-9' });
    expect(rpcMock).toHaveBeenCalledWith('admin_view_traffic_summary', expect.objectContaining({
      p_campaign_id: 'camp-1',
      p_creator_id: 'creator-9',
    }));
  });

  it('clamps an absurd lookback window', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    await adminLoadViewTrafficSummary({ sinceDays: 100_000 });
    const since = new Date(rpcMock.mock.calls[0][1].p_since as string).getTime();
    const maxAge = Date.now() - 366 * 86_400_000;
    expect(since).toBeGreaterThan(maxAge);
  });

  it('degrades to an empty summary when the RPC is unavailable', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: null, error: { message: 'missing function' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    const summary = await adminLoadViewTrafficSummary();
    expect(summary.totalViews).toBe(0);
    expect(summary.paidViews).toBe(0);
    spy.mockRestore();
  });

  it('folds an unrecognised category into `other` rather than dropping it', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({
      data: [{ category: 'paid', views: 10, earnings: 1 }, { category: 'from_the_future', views: 4, earnings: 0 }],
      error: null,
    });
    const { adminLoadViewTrafficSummary } = await import('@/lib/admin-server');
    const summary = await adminLoadViewTrafficSummary();
    expect(summary.totalViews).toBe(14);
    expect(summary.paidViews).toBe(10);
    expect(summary.byCategory.other).toBe(4);
  });
});

// =====================================================================
describe('admin daily trend', () => {
  it('maps the DB columns into the chart shape', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({
      data: [{ day: '2026-01-10', total: 100, paid: 70, duplicates: 20, fraud_blocked: 10, earnings: 0.44 }],
      error: null,
    });
    const { adminLoadViewTrafficDaily } = await import('@/lib/admin-server');
    const rows = await adminLoadViewTrafficDaily(7);
    expect(rows).toEqual([
      { day: '2026-01-10', total: 100, paid: 70, duplicates: 20, fraudBlocked: 10, earnings: 0.44 },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('admin_view_traffic_daily', { p_days: 7 });
  });

  it('clamps the requested day range', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { adminLoadViewTrafficDaily } = await import('@/lib/admin-server');
    await adminLoadViewTrafficDaily(9999);
    expect(rpcMock).toHaveBeenCalledWith('admin_view_traffic_daily', { p_days: 90 });
    rpcMock.mockClear();
    await adminLoadViewTrafficDaily(-5);
    expect(rpcMock).toHaveBeenCalledWith('admin_view_traffic_daily', { p_days: 1 });
  });

  it('returns an empty trend when the RPC is unavailable', async () => {
    asAdmin();
    rpcMock.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { adminLoadViewTrafficDaily } = await import('@/lib/admin-server');
    expect(await adminLoadViewTrafficDaily()).toEqual([]);
    spy.mockRestore();
  });
});

// =====================================================================
describe('the admin UI renders the required counters', () => {
  const component = read('src/components/AdminTrafficQuality.tsx');

  it.each([
    'Total Views',
    'Valid',
    'Non-Paid',
    'Duplicate',
    'Earning',
  ])('shows a %s figure', label => {
    expect(component).toContain(label);
  });

  it('renders bot/fraud blocked traffic', () => {
    expect(component).toMatch(/Bot|Fraud/i);
    expect(component).toContain('fraudBlockedViews');
  });

  it('is wired into the admin dashboard and the admin campaign page', () => {
    expect(read('src/app/admin/page.tsx')).toContain('AdminTrafficQuality');
    expect(read('src/app/admin/campaigns/[id]/page.tsx')).toContain('AdminTrafficQuality');
  });

  it('never renders a raw visitor IP', () => {
    const code = readCode('src/components/AdminTrafficQuality.tsx');
    expect(code).not.toContain('visitor_ip');
    expect(code).not.toMatch(/\bip_hash\b/);
    expect(code).not.toContain('device_fingerprint');
  });
});

// =====================================================================
describe('creator surfaces leak nothing about anti-fraud', () => {
  const creatorFiles = [
    'src/app/dashboard/page.tsx',
    'src/app/dashboard/analytics/page.tsx',
    'src/app/dashboard/campaigns/[id]/page.tsx',
    'src/components/AnalyticsCharts.tsx',
    'src/components/DashboardCharts.tsx',
    'src/app/c/[slug]/UnlockClient.tsx',
  ];

  it.each(creatorFiles)('%s never selects a fraud/privacy column', file => {
    const source = readCode(file);
    for (const forbidden of ['visitor_ip', 'ip_hash', 'fraud_score', 'is_vpn', 'is_proxy', 'is_bot', 'is_emulator', 'device_fingerprint']) {
      expect(source, `${file} must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each(creatorFiles)('%s never renders a duplicate/block concept to the creator', file => {
    const source = readCode(file);
    for (const forbidden of ['duplicate_ip_24h', 'duplicate_device', 'Duplicate', 'duplicate', 'Bot Blocked', 'invalid_reason', 'fraudScore', 'trafficCategory', 'traffic_category']) {
      expect(source, `${file} must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the creator campaign page reads only the creator-safe projection', () => {
    const source = readCode('src/app/dashboard/campaigns/[id]/page.tsx');
    // The projection itself contains earning-eligible rows only, so the page
    // no longer needs (or is able) to filter the raw table by status.
    expect(source).toContain('creator_view_analytics');
    expect(source).not.toContain(".from('views')");
    expect(source).toContain('Recent Valid Views');
  });

  it('creator analytics no longer charts an "Invalid Views" series', () => {
    const analytics = readCode('src/app/dashboard/analytics/page.tsx');
    const charts = readCode('src/components/AnalyticsCharts.tsx');
    expect(analytics).not.toContain('Invalid Views');
    expect(charts).not.toContain('Invalid');
    expect(charts).toContain('Valid Views');
  });

  it('the unlock client shows no rejection warning to the visitor', () => {
    const source = readCode('src/app/c/[slug]/UnlockClient.tsx');
    expect(source).not.toContain('payoutEligible');
    expect(source).not.toMatch(/not (be )?(counted|eligible)/i);
  });

  it('the unlock client does not send a client user agent field', () => {
    const source = readCode('src/app/c/[slug]/UnlockClient.tsx');
    // navigator.userAgent may still feed the (non-authoritative) fingerprint
    // string, but no `userAgent` field may be posted to the API — the server
    // reads the real request header instead.
    expect(source).not.toMatch(/userAgent\s*:/);
  });
});

// =====================================================================
describe('creator notifications never announce blocked traffic', () => {
  it('the notification policy has no duplicate/fraud event', () => {
    const source = readCode('src/lib/notification-policy.ts');
    for (const forbidden of ['duplicate', 'fraud', 'bot_', 'blocked_view']) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });
});

// =====================================================================
describe('the database keeps creators away from hidden traffic', () => {
  const migration = read('supabase/migrations/0020_view_traffic_attribution.sql');

  it('exposes a creator view filtered to creator-visible categories only', () => {
    expect(migration).toContain('creator_campaign_traffic');
    expect(migration).toContain('view_category_is_creator_visible');
    expect(migration).toContain('security_invoker = true');
  });

  it('gives admins an aggregate RPC guarded by is_admin()', () => {
    expect(migration).toContain('admin_view_traffic_summary');
    expect(migration).toContain('admin_view_traffic_daily');
    expect(migration).toContain('is_admin()');
    expect(migration).toContain('SECURITY DEFINER');
  });

  it('revokes the admin analytics RPCs from anonymous callers', () => {
    expect(migration).toMatch(/REVOKE[\s\S]*admin_view_traffic_summary[\s\S]*FROM (PUBLIC|anon)/i);
  });

  it('keeps visitors from writing to the views table directly', () => {
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE (public\.)?views FROM anon, authenticated/i);
  });

  it('forces earnings to zero for non-eligible traffic at the DB level', () => {
    expect(migration).toContain('earning_eligible');
    expect(migration).toMatch(/NEW\.earnings\s*(:)?=\s*0/);
  });

  it('enforces one paid view per campaign + ip + window with a unique index', () => {
    expect(migration).toContain('uniq_views_paid_campaign_ip_window');
    expect(migration).toMatch(/\(\s*campaign_id,\s*ip_hash,\s*eligibility_window_start\s*\)/);
    expect(migration).toMatch(/WHERE\s+earning_eligible/i);
  });

  it('never makes the unique key IP-only (that would block shared IPs site-wide)', () => {
    expect(migration).not.toMatch(/UNIQUE INDEX \w+ ON (public\.)?views \(\s*ip_hash\s*\)/i);
  });
});
