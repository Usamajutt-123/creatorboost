/**
 * Static security tests over the SQL migrations.
 *
 * These read the migration files and assert that the security invariants the
 * application relies on actually exist in the database definition: RLS on
 * every table, SECURITY DEFINER RPCs enforcing identity/roles, idempotency
 * constraints, and the earnings lifecycle columns. They run without a live
 * database but catch regressions in the schema-as-code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

const sql = migrations.map(f => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');

describe('database security invariants', () => {
  it('migrations exist and are ordered', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(7);
    expect(migrations[0]).toMatch(/^0001_/);
    expect(migrations[migrations.length - 1]).toMatch(/^0009_/);
  });

  it('enables RLS on every sensitive table', () => {
    for (const t of ['profiles', 'campaigns', 'views', 'earnings', 'withdrawals', 'referrals', 'support_tickets', 'notifications']) {
      expect(sql, `RLS not enabled on ${t}`).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it('anonymous users cannot insert views (RLS dropped in 0004)', () => {
    // The old public_insert_views policy must be gone.
    const s4 = readFileSync(join(MIGRATIONS_DIR, '0004_security_hardening.sql'), 'utf8');
    expect(s4).toContain('DROP POLICY IF EXISTS public_insert_views ON views');
    expect(s4).not.toContain('CREATE POLICY "public_insert_views"');
  });

  it('profiles have no anonymous SELECT policy that leaks private columns', () => {
    const s1 = readFileSync(join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    expect(s1).toContain('public_read_username'); // created in 0001...
    const s4 = readFileSync(join(MIGRATIONS_DIR, '0004_security_hardening.sql'), 'utf8');
    expect(s4).toContain('DROP POLICY IF EXISTS public_read_username ON profiles'); // ...and dropped in 0004
  });

  it('idempotency unique index exists on views(creator_id, idempotency_key)', () => {
    expect(sql).toContain('uq_views_creator_idempotency');
  });

  it('views.invalid_reason is TEXT (engine emits non-enum reasons)', () => {
    expect(sql).toContain("ALTER TABLE views ALTER COLUMN invalid_reason TYPE TEXT");
  });

  it('earnings lifecycle columns exist', () => {
    for (const col of ['available_at', 'released_at']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col} TIMESTAMPTZ`);
    }
    expect(sql).toContain('pending_earnings');
    expect(sql).toContain('withdrawal_hold');
  });

  it('credit_view_earning is SECURITY DEFINER and revoked from clients', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('credit_view_earning');
    expect(s7).toMatch(/REVOKE EXECUTE ON FUNCTION public\.credit_view_earning/);
  });

  it('release_matured_earnings is idempotent (released_at guard + FOR UPDATE lock)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    const fn = s7.match(/CREATE OR REPLACE FUNCTION public\.release_matured_earnings[\s\S]*?\$\$;/);
    expect(fn, 'release_matured_earnings not found').not.toBeNull();
    expect(fn![0]).toContain('FOR UPDATE');
    expect(fn![0]).toContain('released_at IS NULL');
    expect(s7).toMatch(/REVOKE EXECUTE ON FUNCTION public\.release_matured_earnings/);
  });

  it('withdrawal RPCs derive identity from auth.uid() and check admin role + no self-action', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toMatch(/auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_user_id/); // request_withdrawal
    expect(s7).toMatch(/NOT public\.is_admin\(\)/); // approve/pay/reject
    expect((s7.match(/v_user_id = auth\.uid\(\)/g) || []).length).toBeGreaterThanOrEqual(3); // no self-approve/pay/reject
  });

  it('request_withdrawal moves available_balance -> withdrawal_hold (no double spend)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('available_balance = available_balance - v_total');
    expect(s7).toContain('withdrawal_hold   = withdrawal_hold + v_total');
    expect(s7).toContain('FOR UPDATE');
    expect(s7).toContain('You already have a pending withdrawal');
  });

  it('reject returns the hold to available balance (incl. fee)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('withdrawal_hold = withdrawal_hold - v_total');
    expect(s7).toContain('available_balance = available_balance + v_total');
  });

  it('referral commission is idempotent per view (unique index)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('uq_earnings_referral_view');
    expect(s7).toContain('IF EXISTS (SELECT 1 FROM earnings WHERE type = \'referral_bonus\' AND view_id = p_view_id)');
    expect(s7).toContain('IF p_referrer_id = p_creator_id THEN RETURN; END IF;'); // self-referral guard
  });

  it('ad_revenue_imports ledger exists with source constraint', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('CREATE TABLE IF NOT EXISTS ad_revenue_imports');
    expect(s7).toContain("CHECK (source IN ('manual','provider'))");
  });

  it('role-guard trigger prevents privilege escalation and balance tampering', () => {
    const s4 = readFileSync(join(MIGRATIONS_DIR, '0004_security_hardening.sql'), 'utf8');
    expect(s4).toContain('profiles_role_guard');
    expect(s4).toContain('Only a super admin can change user roles');
    expect(s4).toContain('Balance fields are managed by the system only');
  });

  it('financial RPCs are revoked from anon/authenticated', () => {
    const s4 = readFileSync(join(MIGRATIONS_DIR, '0004_security_hardening.sql'), 'utf8');
    for (const fn of ['increment_view_counters', 'approve_withdrawal', 'pay_withdrawal', 'reject_withdrawal', 'release_pending_earnings', 'credit_referral_commission']) {
      expect(s4).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  });

  it('financial values use NUMERIC, not floating point', () => {
    expect(sql).toMatch(/available_balance NUMERIC\(12, 2\)/);
    expect(sql).toMatch(/earnings NUMERIC\(10, 6\)/);
    expect(sql).toMatch(/amount NUMERIC\(12, 6\)/);
  });

  it('campaigns.deleted_at + task_metadata exist (schema/code alignment)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS task_metadata JSONB');
  });

  it('analytics views are security_invoker (RLS-aware aggregation)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('WITH (security_invoker = true)');
    for (const v of ['campaign_summary', 'campaign_daily_stats', 'campaign_country_stats']) {
      expect(s7).toContain(v);
    }
  });

  it('creators cannot UPDATE their campaigns\' financial columns via RLS', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('DROP POLICY IF EXISTS creators_manage_own_campaigns ON campaigns');
    expect(s7).toContain('CREATE POLICY "creators_update_own_campaigns" ON campaigns');
    expect(s7).toContain('WITH CHECK (');
    expect(s7).toMatch(/total_views\s*=\s*0[\s\S]*total_earnings\s*=\s*0/); // insert policy requires zeroed financials
  });
  it('users cannot UPDATE/DELETE their own withdrawals via RLS (RPCs only)', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('DROP POLICY IF EXISTS users_manage_own_withdrawals ON withdrawals');
    expect(s7).toContain('CREATE POLICY "users_read_own_withdrawals" ON withdrawals FOR SELECT');
    // No user-level UPDATE/INSERT policy may exist on withdrawals.
    expect(s7).not.toMatch(/CREATE POLICY "users_.*"( ON withdrawals FOR (UPDATE|ALL|INSERT))/);
  });

  it('anonymous support tickets are allowed but scoped to null user rows', () => {
    const s7 = readFileSync(join(MIGRATIONS_DIR, '0007_final_production.sql'), 'utf8');
    expect(s7).toContain('ALTER TABLE support_tickets ALTER COLUMN user_id DROP NOT NULL');
    expect(s7).toContain('user_id IS NULL');
  });

  it('new sensitive tables enable RLS and public campaigns never expose destinations', () => {
    const s8 = readFileSync(join(MIGRATIONS_DIR, '0008_production_repair.sql'), 'utf8');
    for (const table of ['withdrawal_method_config', 'referral_clicks', 'audit_log']) {
      expect(s8).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(s8).toContain('CREATE OR REPLACE VIEW public.public_campaigns');
    const publicView = s8.match(/CREATE OR REPLACE VIEW public\.public_campaigns[\s\S]*?FROM public\.campaigns/);
    expect(publicView?.[0]).not.toContain('destination_url');
    expect(s8).toContain('DROP POLICY IF EXISTS public_read_active_campaigns ON campaigns');
    const s9 = readFileSync(join(MIGRATIONS_DIR, '0009_public_campaigns_access.sql'), 'utf8');
    expect(s9).toContain('security_invoker = false');
    expect(s9).not.toContain('destination_url');
  });

  it('uses column grants and ledger uniqueness to block direct financial tampering', () => {
    const s8 = readFileSync(join(MIGRATIONS_DIR, '0008_production_repair.sql'), 'utf8');
    expect(s8).toContain('uq_earnings_view_earning');
    expect(s8).toContain('accounted_at');
    expect(s8).toContain('GRANT UPDATE (username, full_name, avatar_url, bio, country_code) ON TABLE profiles TO authenticated');
    expect(s8).toContain('REVOKE ALL ON TABLE withdrawals FROM anon, authenticated');
    expect(s8).toContain('REVOKE EXECUTE ON FUNCTION public.credit_view_earning');
    expect(s8).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('validates task URLs and serializes mature earning release', () => {
    const s8 = readFileSync(join(MIGRATIONS_DIR, '0008_production_repair.sql'), 'utf8');
    expect(s8).toContain('Every campaign task needs a valid http(s) URL');
    expect(s8).toContain('FOR UPDATE SKIP LOCKED');
    expect(s8).toContain('ON CONFLICT DO NOTHING RETURNING id INTO v_earning_id');
  });

});

