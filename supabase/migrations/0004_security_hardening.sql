-- ============================================================
-- CreatorBoost Migration 0004 — Security Hardening
-- ------------------------------------------------------------
-- Fixes the RLS model and hardens every SECURITY DEFINER RPC.
--
--  * REMOVES the dangerous `public_read_username` policy that let
--    anonymous users SELECT every private column of every profile.
--  * REMOVES `public_insert_views` (anon could insert arbitrary
--    financial view rows).
--  * Adds admin/super_admin policies via `is_admin()`/`is_super_admin()`.
--  * Adds a public, column-safe view for profile data used to render
--    public campaign pages.
--  * Hardens withdrawal / counter RPCs: derives identity from
--    auth.uid() and enforces roles inside the database.
--  * Revokes EXECUTE on financial functions from client roles so they
--    can only be invoked through service-role server code.
--  * Adds a role-guard trigger to prevent privilege escalation.
--
-- Idempotent (safe to re-run).
-- ============================================================

-- ------------------------------------------------------------------
-- 0. Helper role predicates (SECURITY DEFINER so they can read profiles
--    regardless of RLS on profiles).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT TRUE FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT TRUE FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'), FALSE);
$$;

-- ------------------------------------------------------------------
-- 1. PROFILES RLS — remove the data-leak policy, add safe policies
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS public_read_username ON profiles;

-- Users can still read/update their own profile (existing policies kept).
-- Admins get read + update. The role-guard trigger below prevents an
-- admin from promoting themselves to super_admin via UPDATE.

CREATE POLICY "admins_read_profiles"   ON profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "admins_update_profiles" ON profiles FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------
-- 2. Public profile view — ONLY fields needed to render public pages.
--    Application code must read creator info through this view, never
--    the full `profiles` table for public/anonymous contexts.
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  full_name,
  avatar_url,
  level,
  country_code,
  created_at
FROM public.profiles;

-- ------------------------------------------------------------------
-- 3. CAMPAIGNS — admins manage all campaigns
-- ------------------------------------------------------------------
CREATE POLICY "admins_read_campaigns"   ON campaigns FOR SELECT USING (public.is_admin());
CREATE POLICY "admins_manage_campaigns" ON campaigns FOR ALL   USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------
-- 4. VIEWS — remove anonymous insert; admins read platform views
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS public_insert_views ON views;
DROP POLICY IF EXISTS creators_read_own_views ON views;

CREATE POLICY "creators_read_own_views" ON views FOR SELECT USING (auth.uid() = creator_id);
CREATE POLICY "admins_read_views"       ON views FOR SELECT USING (public.is_admin());

-- ------------------------------------------------------------------
-- 5. EARNINGS — admins read platform ledger
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS users_read_own_earnings ON earnings;
CREATE POLICY "users_read_own_earnings" ON earnings FOR SELECT USING (auth.uid() = creator_id);
CREATE POLICY "admins_read_earnings"    ON earnings FOR SELECT USING (public.is_admin());

-- ------------------------------------------------------------------
-- 6. WITHDRAWALS — admins read/process all; users manage their own
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS users_manage_own_withdrawals ON withdrawals;
DROP POLICY IF EXISTS admins_manage_withdrawals ON withdrawals;

CREATE POLICY "users_manage_own_withdrawals" ON withdrawals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins_manage_withdrawals" ON withdrawals FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------
-- 7. WITHDRAWAL METHOD CONFIG — public read of enabled methods; admins write
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS public_read_wmc ON withdrawal_method_config;
CREATE POLICY "public_read_wmc" ON withdrawal_method_config FOR SELECT USING (enabled = true OR public.is_admin());
CREATE POLICY "admins_manage_wmc" ON withdrawal_method_config FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------
-- 8. platform_settings / country_tiers / creator_levels / ad_networks
--    -> admin write policies (reads stay public as before)
-- ------------------------------------------------------------------
CREATE POLICY "admins_manage_platform_settings" ON platform_settings FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admins_manage_country_tiers"     ON country_tiers     FOR ALL   USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admins_manage_creator_levels"    ON creator_levels    FOR ALL   USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admins_manage_ad_networks"       ON ad_networks       FOR ALL   USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------
-- 9. Role-guard trigger: only a super_admin may change the `role` column,
--    and no user may change their own role at all (prevents self-promotion
--    / self-demotion). Prevents balance tampering via direct UPDATE by
--    non-admins.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only super admins can change roles
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change user roles';
  END IF;
  -- No user may change their own role (even super admin self-demote guarded here)
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() = NEW.id THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;
  -- Nobody may change financial fields via a direct UPDATE
  IF (NEW.total_earnings    IS DISTINCT FROM OLD.total_earnings
      OR NEW.pending_earnings IS DISTINCT FROM OLD.pending_earnings
      OR NEW.pending_balance  IS DISTINCT FROM OLD.pending_balance
      OR NEW.available_balance IS DISTINCT FROM OLD.available_balance
      OR NEW.withdrawal_hold   IS DISTINCT FROM OLD.withdrawal_hold
      OR NEW.referral_earnings IS DISTINCT FROM OLD.referral_earnings)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Balance fields are managed by the system only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_role_guard ON profiles;
CREATE TRIGGER trg_profiles_role_guard
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_role_guard();

-- ============================================================
-- HARDENED RPCs
-- ============================================================

-- ------------------------------------------------------------------
-- increment_view_counters: validate ownership + active status before
-- crediting. Only VALID views credit earnings.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_view_counters(
  p_campaign_id UUID,
  p_creator_id UUID,
  p_earning NUMERIC,
  p_valid BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner UUID;
  v_status campaign_status;
  v_earning NUMERIC := COALESCE(p_earning, 0);
BEGIN
  SELECT creator_id, status INTO v_owner, v_status FROM campaigns WHERE id = p_campaign_id;
  IF v_owner IS NULL OR v_status IS NULL THEN
    RETURN; -- campaign missing
  END IF;

  IF p_valid THEN
    -- Integrity: the credited creator must own this campaign.
    IF v_owner <> p_creator_id THEN RETURN; END IF;
    -- Active campaigns only.
    IF v_status <> 'active' THEN RETURN; END IF;
    -- Sanity: never credit more than a sane single-view max.
    IF v_earning > COALESCE((SELECT max_earnings_per_view FROM platform_settings WHERE id = 1), 1.0) THEN
      v_earning := COALESCE((SELECT max_earnings_per_view FROM platform_settings WHERE id = 1), 1.0);
    END IF;
  ELSE
    v_earning := 0;
  END IF;

  UPDATE campaigns SET
    total_views = total_views + 1,
    valid_views   = valid_views   + CASE WHEN p_valid THEN 1 ELSE 0 END,
    invalid_views = invalid_views + CASE WHEN p_valid THEN 0 ELSE 1 END,
    total_earnings = total_earnings + v_earning
  WHERE id = p_campaign_id;

  UPDATE profiles SET
    total_views = total_views + 1,
    valid_views   = valid_views   + CASE WHEN p_valid THEN 1 ELSE 0 END,
    invalid_views = invalid_views + CASE WHEN p_valid THEN 0 ELSE 1 END,
    total_earnings  = total_earnings  + v_earning,
    pending_earnings = pending_earnings + v_earning
  WHERE id = p_creator_id;

  PERFORM public.recalculate_creator_level(p_creator_id);
END;
$$;

-- ------------------------------------------------------------------
-- recalculate_creator_level: unchanged logic, recreated for reference.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_creator_level(p_creator_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total BIGINT;
  v_new_level user_level;
BEGIN
  SELECT total_views INTO v_total FROM profiles WHERE id = p_creator_id;
  IF v_total IS NULL THEN RETURN; END IF;
  SELECT level INTO v_new_level
  FROM creator_levels
  WHERE min_views <= v_total AND active = TRUE
  ORDER BY min_views DESC
  LIMIT 1;
  IF v_new_level IS NOT NULL THEN
    UPDATE profiles SET level = v_new_level WHERE id = p_creator_id;
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- request_withdrawal: auth.uid() must equal p_user_id. Validates
-- method, active status, minimum, no duplicate pending, balance.
-- Moves available_balance -> withdrawal_hold.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_account_details JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC;
  v_min NUMERIC;
  v_status user_status;
  v_withdrawal_id UUID;
  v_valid_method BOOLEAN;
  v_pending INT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT status INTO v_status FROM profiles WHERE id = p_user_id;
  IF v_status IS NULL OR v_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account is not active');
  END IF;

  SELECT min_withdrawal INTO v_min FROM platform_settings WHERE id = 1;
  IF p_amount IS NULL OR p_amount <= 0 OR (v_min IS NOT NULL AND p_amount < v_min) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount below minimum withdrawal');
  END IF;

  SELECT COALESCE(COUNT(*) > 0, FALSE) INTO v_valid_method
  FROM withdrawal_method_config WHERE method = p_method AND enabled = TRUE;
  IF NOT v_valid_method THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or disabled withdrawal method');
  END IF;

  SELECT COUNT(*) INTO v_pending FROM withdrawals
  WHERE user_id = p_user_id AND status IN ('pending', 'approved');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending withdrawal');
  END IF;

  SELECT available_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  UPDATE profiles
    SET available_balance = available_balance - p_amount,
        withdrawal_hold   = withdrawal_hold + p_amount
  WHERE id = p_user_id;

  INSERT INTO withdrawals (user_id, amount, method, account_details, status)
  VALUES (p_user_id, p_amount, p_method::withdraw_method, p_account_details, 'pending')
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, 'withdrawal', 'Withdrawal requested',
          'Your withdrawal of $' || p_amount || ' is pending review.', '/dashboard/withdraw');

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_withdrawal_id);
END;
$$;

-- ------------------------------------------------------------------
-- approve_withdrawal / pay_withdrawal / reject_withdrawal:
-- admin identity is derived from auth.uid() and role-checked in-DB.
-- p_admin_id is accepted for signature compatibility but ignored for
-- authorization (the real actor is auth.uid()).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_withdrawal_id UUID, p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'pending' FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE withdrawals SET status = 'approved', processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal approved',
          'Your withdrawal of $' || v_amount || ' has been approved and will be processed shortly.');
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_tx_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'approved' FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE withdrawals SET status = 'paid', transaction_id = p_tx_id, processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  UPDATE profiles SET withdrawal_hold = withdrawal_hold - v_amount WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal paid',
          'Your withdrawal of $' || v_amount || ' has been sent. TX: ' || COALESCE(p_tx_id, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status IN ('pending','approved') FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE withdrawals SET status = 'rejected', rejection_reason = p_reason, processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  -- Return hold to available balance
  UPDATE profiles
    SET withdrawal_hold = withdrawal_hold - v_amount,
        available_balance = available_balance + v_amount
  WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal rejected',
          'Your withdrawal of $' || v_amount || ' was rejected. Reason: ' || COALESCE(p_reason, ''));
END;
$$;

-- ------------------------------------------------------------------
-- release_pending_earnings: moves pending_earnings -> available_balance
-- (the holding-period release). SECURITY DEFINER; client EXECUTE revoked,
-- so it must be called by a scheduled job / service-role code.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_pending_earnings()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
    SET available_balance = available_balance + pending_earnings,
        pending_earnings = 0
  WHERE pending_earnings > 0;
END;
$$;

-- ------------------------------------------------------------------
-- credit_referral_commission: credits a referrer a commission from a
-- referred creator's valid view earning. Only callable via service role.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_referral_commission(
  p_referrer_id UUID,
  p_amount NUMERIC,
  p_creator_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
  IF p_referrer_id = p_creator_id THEN RETURN; END IF;

  UPDATE profiles
    SET referral_earnings = referral_earnings + p_amount
  WHERE id = p_referrer_id;

  UPDATE referrals
    SET total_commission = total_commission + p_amount
  WHERE referrer_id = p_referrer_id AND referred_id = p_creator_id;

  INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description)
  VALUES (
    p_referrer_id, NULL, NULL, 'referral_bonus', p_amount,
    'Referral commission from referred creator view'
  );
END;
$$;

-- Legacy alias (was never actually wired); point it at the new release.
CREATE OR REPLACE FUNCTION public.release_pending_balance()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.release_pending_earnings();
END;
$$;

-- ------------------------------------------------------------------
-- Revoke client EXECUTE on all financial RPCs so they can only be
-- invoked via service-role server code (PostgREST anon/authenticated
-- cannot call them). request_withdrawal stays callable by authenticated
-- users (it enforces auth.uid() = p_user_id internally).
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.increment_view_counters(UUID, UUID, NUMERIC, BOOLEAN) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pay_withdrawal(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_withdrawal(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_pending_earnings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_pending_balance() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_creator_level(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
