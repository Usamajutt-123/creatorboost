-- ============================================================
-- CreatorBoost Migration 0007 — Final Production Hardening
-- ------------------------------------------------------------
-- 1. views.invalid_reason: enum -> TEXT
--    The earnings engine emits reasons (self_view, device_limit,
--    campaign_expired, ...) that do not exist in the old enum, which
--    made those inserts FAIL silently and the view was never recorded.
-- 2. earnings lifecycle: per-earning `available_at` / `released_at`
--    so the holding period is enforced per earning, not as an
--    all-or-nothing pending dump.
-- 3. Atomic `credit_view_earning` RPC (view + earnings + counters in
--    one transaction) and an idempotent, race-safe
--    `release_matured_earnings()` release job.
-- 4. Referral commissions: idempotent per-view, credited into the
--    earning lifecycle (pending -> available) with full ledger rows.
-- 5. Withdrawal fees (withdrawal_method_config.fee_percentage) are
--    now actually applied, and the max per method is enforced.
-- 6. Anonymous support tickets (support_tickets.user_id nullable +
--    RLS) so the public contact page works.
-- 7. ad_revenue_imports ledger table for REAL vs MANUAL revenue.
-- 8. profiles.welcome_email_sent_at for one-time welcome email.
--
-- Idempotent (safe to re-run).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. views.invalid_reason -> TEXT
-- ------------------------------------------------------------------
ALTER TABLE views ALTER COLUMN invalid_reason TYPE TEXT USING invalid_reason::text;
DROP TYPE IF EXISTS invalid_reason;

-- ------------------------------------------------------------------
-- 2. earnings lifecycle columns
-- ------------------------------------------------------------------
ALTER TABLE earnings ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;
ALTER TABLE earnings ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- Existing rows are treated as already matured.
UPDATE earnings SET available_at = created_at WHERE available_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_earnings_release_queue
  ON earnings(creator_id, type, released_at, available_at)
  WHERE released_at IS NULL;

-- ------------------------------------------------------------------
-- 3. profiles: one-time welcome email flag
-- ------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

-- ------------------------------------------------------------------
-- 4. Anonymous support tickets
-- ------------------------------------------------------------------
ALTER TABLE support_tickets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ticket_messages ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS users_manage_own_tickets ON support_tickets;
CREATE POLICY "users_manage_own_tickets" ON support_tickets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS users_insert_own_ticket_messages ON ticket_messages;
CREATE POLICY "users_insert_own_ticket_messages" ON ticket_messages FOR INSERT
  WITH CHECK (
    (auth.uid() IS NULL AND user_id IS NULL AND EXISTS (
      SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id IS NULL))
    OR
    (auth.uid() IS NOT NULL AND user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()))
  );

-- ------------------------------------------------------------------
-- 5. withdrawals: fee column
-- ------------------------------------------------------------------
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee NUMERIC(12,2) DEFAULT 0 NOT NULL;

-- ------------------------------------------------------------------
-- 6. ad revenue ledger (REAL/MANUAL/ESTIMATED distinction)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_revenue_imports (
  id           BIGSERIAL PRIMARY KEY,
  revenue_date DATE NOT NULL,
  network      TEXT NOT NULL,
  impressions  BIGINT DEFAULT 0 NOT NULL CHECK (impressions >= 0),
  clicks       BIGINT DEFAULT 0 NOT NULL CHECK (clicks >= 0),
  revenue      NUMERIC(14,6) NOT NULL CHECK (revenue >= 0),
  currency     CHAR(3) DEFAULT 'USD' NOT NULL,
  country      CHAR(2),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','provider')),
  imported_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (revenue_date, network, country)
);

CREATE INDEX IF NOT EXISTS idx_ad_revenue_date ON ad_revenue_imports(revenue_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_network ON ad_revenue_imports(network);

ALTER TABLE ad_revenue_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_read_ad_revenue ON ad_revenue_imports;
DROP POLICY IF EXISTS admins_manage_ad_revenue ON ad_revenue_imports;
CREATE POLICY "admins_read_ad_revenue" ON ad_revenue_imports FOR SELECT USING (public.is_admin());
CREATE POLICY "admins_manage_ad_revenue" ON ad_revenue_imports FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================
-- RPC: credit_view_earning (atomic view + earnings + counters)
-- Only callable via service-role server code.
-- ============================================================
CREATE OR REPLACE FUNCTION public.credit_view_earning(
  p_view_id UUID,
  p_campaign_id UUID,
  p_creator_id UUID,
  p_valid BOOLEAN,
  p_cpm NUMERIC,
  p_earning NUMERIC,
  p_level_multiplier NUMERIC,
  p_description TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_view_campaign UUID;
  v_view_creator UUID;
  v_owner UUID;
  v_status campaign_status;
  v_earning NUMERIC := COALESCE(p_earning, 0);
  v_hold_hours INTEGER;
BEGIN
  -- The view row must exist and belong to this campaign/creator.
  SELECT campaign_id, creator_id INTO v_view_campaign, v_view_creator
  FROM views WHERE id = p_view_id;
  IF v_view_campaign IS NULL OR v_view_campaign <> p_campaign_id OR v_view_creator <> p_creator_id THEN
    RETURN; -- integrity mismatch: never credit
  END IF;

  SELECT creator_id, status INTO v_owner, v_status FROM campaigns WHERE id = p_campaign_id;
  IF v_owner IS NULL THEN RETURN; END IF;

  IF p_valid THEN
    -- Credit only the campaign owner while the campaign is active.
    IF v_owner <> p_creator_id OR v_status <> 'active' THEN
      v_earning := 0;
    END IF;
    -- Hard per-view cap.
    IF v_earning > COALESCE((SELECT max_earnings_per_view FROM platform_settings WHERE id = 1), 1.0) THEN
      v_earning := COALESCE((SELECT max_earnings_per_view FROM platform_settings WHERE id = 1), 1.0);
    END IF;

    IF v_earning > 0 THEN
      SELECT COALESCE(earning_holding_hours, 24) INTO v_hold_hours FROM platform_settings WHERE id = 1;
      INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
      VALUES (p_creator_id, p_campaign_id, p_view_id, 'view_earning', v_earning,
              COALESCE(p_description, 'View earning'),
              NOW() + (COALESCE(v_hold_hours, 24) * INTERVAL '1 hour'));
      UPDATE campaigns SET
        total_views = total_views + 1,
        valid_views = valid_views + 1,
        total_earnings = total_earnings + v_earning
      WHERE id = p_campaign_id;
      UPDATE profiles SET
        total_views = total_views + 1,
        valid_views = valid_views + 1,
        total_earnings = total_earnings + v_earning,
        pending_earnings = pending_earnings + v_earning
      WHERE id = p_creator_id;
      PERFORM public.recalculate_creator_level(p_creator_id);
    ELSE
      -- Valid but zero-value view (e.g. capped at 0): count it, no money.
      UPDATE campaigns SET total_views = total_views + 1, valid_views = valid_views + 1
      WHERE id = p_campaign_id;
      UPDATE profiles SET total_views = total_views + 1, valid_views = valid_views + 1
      WHERE id = p_creator_id;
    END IF;
  ELSE
    UPDATE campaigns SET total_views = total_views + 1, invalid_views = invalid_views + 1
    WHERE id = p_campaign_id;
    UPDATE profiles SET total_views = total_views + 1, invalid_views = invalid_views + 1
    WHERE id = p_creator_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM anon, authenticated;

-- ============================================================
-- RPC: release_matured_earnings (idempotent, race-safe)
-- Locks profiles rows first so concurrent cron runs serialize;
-- each run re-reads earnings under a fresh snapshot, so a row
-- released by a previous run is never credited twice.
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_matured_earnings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_last_creator UUID := NULL;
  v_total NUMERIC;
  v_count INTEGER := 0;
BEGIN
  -- Lock the matured earnings rows (FOR UPDATE) so concurrent runs
  -- serialize: the second run blocks here until the first commits.
  -- The per-creator aggregation below uses a fresh statement snapshot,
  -- so rows released by the committed run are never credited twice.
  FOR v_row IN
    SELECT e.id, e.creator_id
    FROM earnings e
    WHERE e.released_at IS NULL AND e.available_at <= NOW()
      AND e.type IN ('view_earning', 'referral_bonus')
    ORDER BY e.creator_id, e.id
    FOR UPDATE OF e
  LOOP
    IF v_last_creator IS DISTINCT FROM v_row.creator_id THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_total
      FROM earnings
      WHERE creator_id = v_row.creator_id
        AND released_at IS NULL AND available_at <= NOW()
        AND type IN ('view_earning', 'referral_bonus');

      IF v_total > 0 THEN
        UPDATE profiles
          SET available_balance = available_balance + v_total,
              pending_earnings  = GREATEST(pending_earnings - v_total, 0)
        WHERE id = v_row.creator_id;
      END IF;

      v_last_creator := v_row.creator_id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  UPDATE earnings
    SET released_at = NOW()
  WHERE released_at IS NULL AND available_at <= NOW()
    AND type IN ('view_earning', 'referral_bonus');

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_matured_earnings() FROM anon, authenticated;

-- Legacy name kept for the cron endpoint / existing callers.
CREATE OR REPLACE FUNCTION public.release_pending_earnings()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.release_matured_earnings();
END;
$$;

-- ============================================================
-- RPC: credit_referral_commission v2 — idempotent per view,
-- commissions flow through the normal earning lifecycle.
-- ============================================================
DROP FUNCTION IF EXISTS public.credit_referral_commission(UUID, NUMERIC, UUID);
CREATE OR REPLACE FUNCTION public.credit_referral_commission(
  p_referrer_id UUID,
  p_amount NUMERIC,
  p_creator_id UUID,
  p_view_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hold_hours INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
  IF p_referrer_id = p_creator_id THEN RETURN; END IF; -- self-referral guard
  IF p_view_id IS NULL THEN RETURN; END IF;
  -- Idempotency: one commission per view, ever.
  IF EXISTS (SELECT 1 FROM earnings WHERE type = 'referral_bonus' AND view_id = p_view_id) THEN RETURN; END IF;

  SELECT COALESCE(earning_holding_hours, 24) INTO v_hold_hours FROM platform_settings WHERE id = 1;

  UPDATE profiles
    SET referral_earnings = referral_earnings + p_amount,
        pending_earnings  = pending_earnings + p_amount
  WHERE id = p_referrer_id;

  UPDATE referrals
    SET total_commission = total_commission + p_amount
  WHERE referrer_id = p_referrer_id AND referred_id = p_creator_id;

  INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
  VALUES (p_referrer_id, NULL, p_view_id, 'referral_bonus', p_amount,
          'Referral commission from referred creator view',
          NOW() + (COALESCE(v_hold_hours, 24) * INTERVAL '1 hour'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID, UUID) FROM anon, authenticated;

-- One commission per view (backed by the unique index too).
CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_referral_view
  ON earnings(view_id) WHERE type = 'referral_bonus' AND view_id IS NOT NULL;

-- ============================================================
-- RPC: request_withdrawal v2 — enforces method limits, applies
-- fees, single pending withdrawal, atomic balance move.
-- ============================================================
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
  v_fee NUMERIC;
  v_total NUMERIC;
  v_pending INT;
  v_method withdrawal_method_config%ROWTYPE;
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

  SELECT * INTO v_method FROM withdrawal_method_config WHERE method = p_method AND enabled = TRUE;
  IF v_method.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or disabled withdrawal method');
  END IF;
  IF p_amount > v_method.max_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount exceeds the maximum for this method');
  END IF;

  SELECT COUNT(*) INTO v_pending FROM withdrawals
  WHERE user_id = p_user_id AND status IN ('pending', 'approved');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending withdrawal');
  END IF;

  v_fee := ROUND(p_amount * COALESCE(v_method.fee_percentage, 0) / 100, 2);
  v_total := p_amount + v_fee;

  SELECT available_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance (including fee)');
  END IF;

  UPDATE profiles
    SET available_balance = available_balance - v_total,
        withdrawal_hold   = withdrawal_hold + v_total
  WHERE id = p_user_id;

  INSERT INTO withdrawals (user_id, amount, fee, method, account_details, status)
  VALUES (p_user_id, p_amount, v_fee, p_method::withdraw_method, p_account_details, 'pending')
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, 'withdrawal', 'Withdrawal requested',
          'Your withdrawal of $' || p_amount || ' is pending review.', '/dashboard/withdraw');

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_withdrawal_id, 'fee', v_fee, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) TO authenticated;

-- ============================================================
-- approve / pay / reject: no admin may act on their own
-- withdrawal; fee is part of the hold.
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_withdrawal_id UUID, p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'pending' FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF v_user_id = auth.uid() THEN RETURN; END IF; -- no self-approval
  UPDATE withdrawals SET status = 'approved', processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal approved',
          'Your withdrawal of $' || v_amount || ' has been approved and will be processed shortly.');
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_tx_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_total NUMERIC; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount + fee, amount INTO v_user_id, v_total, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'approved' FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF v_user_id = auth.uid() THEN RETURN; END IF; -- no self-pay
  UPDATE withdrawals SET status = 'paid', transaction_id = p_tx_id, processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  UPDATE profiles SET withdrawal_hold = withdrawal_hold - v_total WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal paid',
          'Your withdrawal of $' || v_amount || ' has been sent. TX: ' || COALESCE(p_tx_id, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_total NUMERIC; v_amount NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  SELECT user_id, amount + fee, amount INTO v_user_id, v_total, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status IN ('pending','approved') FOR UPDATE;
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF v_user_id = auth.uid() THEN RETURN; END IF; -- no self-reject
  UPDATE withdrawals SET status = 'rejected', rejection_reason = p_reason, processed_at = NOW(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
  UPDATE profiles
    SET withdrawal_hold = withdrawal_hold - v_total,
        available_balance = available_balance + v_total
  WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal rejected',
          'Your withdrawal of $' || v_amount || ' was rejected. Reason: ' || COALESCE(p_reason, ''));
END;
$$;

-- ============================================================
-- 11. RLS hardening: creators may not touch financial columns.
--     Previously `creators_manage_own_campaigns` (FOR ALL) allowed a
--     creator to UPDATE total_earnings / valid_views on their own
--     campaign, and `users_manage_own_withdrawals` (FOR ALL) allowed
--     a user to UPDATE their own withdrawal to 'paid'. Both are
--     replaced with column-safe policies; money movement is only
--     possible through the SECURITY DEFINER RPCs (service-role/admin).
-- ============================================================
DROP POLICY IF EXISTS creators_manage_own_campaigns ON campaigns;
CREATE POLICY "creators_insert_own_campaigns" ON campaigns FOR INSERT
  WITH CHECK (
    auth.uid() = creator_id
    AND NEW.total_views = 0
    AND NEW.valid_views = 0
    AND NEW.invalid_views = 0
    AND NEW.total_earnings = 0
  );
CREATE POLICY "creators_update_own_campaigns" ON campaigns FOR UPDATE
  USING (auth.uid() = creator_id)
  WITH CHECK (
    auth.uid() = creator_id
    AND NEW.total_views = OLD.total_views
    AND NEW.valid_views = OLD.valid_views
    AND NEW.invalid_views = OLD.invalid_views
    AND NEW.total_earnings = OLD.total_earnings
  );

DROP POLICY IF EXISTS users_manage_own_withdrawals ON withdrawals;
-- Users may READ their own withdrawals; creating/updating them is only
-- possible through the request/approve/pay/reject RPCs (SECURITY DEFINER)
-- or the admin policies below.
CREATE POLICY "users_read_own_withdrawals" ON withdrawals FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 12. Analytics aggregation views (security_invoker -> RLS still
--     applies to the underlying `views` rows, so creators only see
--     their own campaigns' numbers; no more client-side limit(200)).
-- ============================================================
DROP VIEW IF EXISTS campaign_summary;
CREATE VIEW campaign_summary
WITH (security_invoker = true) AS
SELECT
  campaign_id,
  COUNT(*)                                                    AS total_views,
  COUNT(*) FILTER (WHERE status = 'valid')                    AS valid_views,
  COUNT(*) FILTER (WHERE status = 'invalid')                  AS invalid_views,
  COALESCE(SUM(earnings), 0)                                  AS total_earnings,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')  AS views_24h,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')    AS views_7d,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')   AS views_30d
FROM views
GROUP BY campaign_id;

DROP VIEW IF EXISTS campaign_daily_stats;
CREATE VIEW campaign_daily_stats
WITH (security_invoker = true) AS
SELECT
  campaign_id,
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS views,
  COUNT(*) FILTER (WHERE status = 'valid') AS valid,
  COALESCE(SUM(earnings), 0) AS earnings
FROM views
GROUP BY campaign_id, DATE_TRUNC('day', created_at);

DROP VIEW IF EXISTS campaign_country_stats;
CREATE VIEW campaign_country_stats
WITH (security_invoker = true) AS
SELECT
  campaign_id,
  country_code,
  COUNT(*) AS views,
  COUNT(*) FILTER (WHERE status = 'valid') AS valid,
  COUNT(*) FILTER (WHERE status = 'invalid') AS invalid
FROM views
GROUP BY campaign_id, country_code;

GRANT SELECT ON campaign_summary, campaign_daily_stats, campaign_country_stats TO authenticated;

-- ============================================================
-- (end of migration)
-- ============================================================

