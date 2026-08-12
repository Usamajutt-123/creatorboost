-- ============================================================
-- CreatorBoost Migration 0010 — CPM source of truth + notifications
-- ------------------------------------------------------------
-- * Global cpm_settings is the single active CPM used by new views
-- * Changes are audited (cpm_change_log + existing audit_log)
-- * Notifications: tighter RLS, admin alerts, release notices
-- Idempotent / safe to re-run where possible.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Global CPM settings (one row, NUMERIC, non-negative, min/max)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cpm_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cpm NUMERIC(12, 6) NOT NULL DEFAULT 5.000000 CHECK (cpm >= 0),
  min_cpm NUMERIC(12, 6) NOT NULL DEFAULT 0.000000 CHECK (min_cpm >= 0),
  max_cpm NUMERIC(12, 6) NOT NULL DEFAULT 100.000000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cpm_settings_bounds CHECK (max_cpm >= min_cpm AND cpm >= min_cpm AND cpm <= max_cpm)
);

INSERT INTO public.cpm_settings (id, cpm, min_cpm, max_cpm, is_active)
VALUES (1, 5.000000, 0.000000, 100.000000, TRUE)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_cpm_settings_updated ON public.cpm_settings;
CREATE TRIGGER trg_cpm_settings_updated
  BEFORE UPDATE ON public.cpm_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.cpm_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_cpm NUMERIC(12, 6),
  new_cpm NUMERIC(12, 6) NOT NULL,
  previous_min NUMERIC(12, 6),
  new_min NUMERIC(12, 6),
  previous_max NUMERIC(12, 6),
  new_max NUMERIC(12, 6),
  admin_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL DEFAULT 'cpm_changed',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpm_change_log_created ON public.cpm_change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpm_change_log_admin ON public.cpm_change_log(admin_user_id);

ALTER TABLE public.cpm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpm_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpm_settings_no_direct_write ON public.cpm_settings;
DROP POLICY IF EXISTS cpm_change_log_no_client_write ON public.cpm_change_log;

REVOKE ALL ON TABLE public.cpm_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cpm_change_log FROM PUBLIC, anon, authenticated;

-- Creators may read only the public current CPM (not min/max/admin identity).
CREATE OR REPLACE VIEW public.public_cpm
WITH (security_barrier = true, security_invoker = false) AS
SELECT cpm, updated_at
FROM public.cpm_settings
WHERE id = 1 AND is_active = TRUE;

REVOKE ALL ON public.public_cpm FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_cpm TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_active_cpm()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cpm FROM public.cpm_settings WHERE id = 1 AND is_active = TRUE), 0);
$$;

REVOKE ALL ON FUNCTION public.get_active_cpm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_cpm() TO service_role;

-- ------------------------------------------------------------------
-- 2. Notifications: users can only read/mark-read their own rows
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS users_read_own_notifications ON notifications;
DROP POLICY IF EXISTS users_update_own_notifications ON notifications;
DROP POLICY IF EXISTS "users_read_own_notifications" ON notifications;
DROP POLICY IF EXISTS "users_update_own_notifications" ON notifications;

CREATE POLICY users_read_own_notifications ON notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Only the read flag may change; WITH CHECK keeps the row owned by the user.
CREATE POLICY users_update_own_notifications ON notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE notifications FROM anon, authenticated;
GRANT SELECT ON TABLE notifications TO authenticated;
GRANT UPDATE (read) ON TABLE notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_type notification_type;
BEGIN
  IF p_user_id IS NULL OR length(btrim(COALESCE(p_title, ''))) = 0 OR length(btrim(COALESCE(p_message, ''))) = 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_type := p_type::notification_type;
  EXCEPTION WHEN invalid_text_representation THEN
    v_type := 'system';
  END;
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  VALUES (p_user_id, v_type, left(btrim(p_title), 200), left(btrim(p_message), 2000),
          CASE WHEN p_link ~ '^/' AND p_link !~ '^//' THEN left(p_link, 300) ELSE NULL END,
          COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  SELECT p.id,
         COALESCE(NULLIF(p_type, '')::notification_type, 'system'),
         left(btrim(p_title), 200),
         left(btrim(p_message), 2000),
         CASE WHEN p_link ~ '^/' AND p_link !~ '^//' THEN left(p_link, 300) ELSE NULL END,
         COALESCE(p_metadata, '{}'::jsonb)
  FROM profiles p
  WHERE p.role IN ('admin', 'super_admin') AND p.status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
EXCEPTION WHEN invalid_text_representation THEN
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  SELECT p.id, 'system', left(btrim(p_title), 200), left(btrim(p_message), 2000),
         CASE WHEN p_link ~ '^/' AND p_link !~ '^//' THEN left(p_link, 300) ELSE NULL END,
         COALESCE(p_metadata, '{}'::jsonb)
  FROM profiles p
  WHERE p.role IN ('admin', 'super_admin') AND p.status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ------------------------------------------------------------------
-- 3. Wire notifications into existing financial RPCs (redefine bodies)
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
  v_fee NUMERIC;
  v_total NUMERIC;
  v_pending INTEGER;
  v_method withdrawal_method_config%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Amount must be a positive value in cents');
  END IF;
  IF jsonb_typeof(p_account_details) <> 'object' OR length(btrim(COALESCE(p_account_details ->> 'account', ''))) NOT BETWEEN 1 AND 500 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Invalid account details');
  END IF;

  SELECT status, available_balance INTO v_status, v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_status IS NULL OR v_status <> 'active' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Account is not active');
  END IF;
  SELECT min_withdrawal INTO v_min FROM platform_settings WHERE id = 1;
  SELECT * INTO v_method FROM withdrawal_method_config WHERE method = lower(p_method) AND enabled = TRUE;
  IF v_method.id IS NULL THEN RETURN jsonb_build_object('success', FALSE, 'error', 'Invalid or disabled withdrawal method'); END IF;
  IF p_amount < GREATEST(COALESCE(v_min, 0), v_method.min_amount) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Amount is below the minimum for this method');
  END IF;
  IF p_amount > v_method.max_amount THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Amount exceeds the maximum for this method');
  END IF;

  SELECT COUNT(*) INTO v_pending FROM withdrawals WHERE user_id = p_user_id AND status IN ('pending', 'approved');
  IF v_pending > 0 THEN RETURN jsonb_build_object('success', FALSE, 'error', 'You already have a pending withdrawal'); END IF;
  v_fee := ROUND(p_amount * COALESCE(v_method.fee_percentage, 0) / 100, 2);
  v_total := p_amount + v_fee;
  IF v_balance < v_total THEN RETURN jsonb_build_object('success', FALSE, 'error', 'Insufficient balance (including fee)'); END IF;

  UPDATE profiles SET available_balance = available_balance - v_total,
    withdrawal_hold = withdrawal_hold + v_total WHERE id = p_user_id;
  INSERT INTO withdrawals (user_id, amount, fee, method, account_details, status)
  VALUES (p_user_id, p_amount, v_fee, lower(p_method)::withdraw_method, p_account_details, 'pending')
  RETURNING id INTO v_withdrawal_id;
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, 'withdrawal', 'Withdrawal requested', 'Your withdrawal of $' || p_amount || ' is pending review.', '/dashboard/withdraw');
  PERFORM public.notify_admins(
    'withdrawal',
    'New withdrawal request',
    'A creator requested $' || p_amount || ' via ' || lower(p_method) || '.',
    '/admin/withdrawals',
    jsonb_build_object('withdrawal_id', v_withdrawal_id, 'amount', p_amount)
  );
  RETURN jsonb_build_object('success', TRUE, 'withdrawal_id', v_withdrawal_id, 'fee', v_fee, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_matured_earnings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  WITH matured AS MATERIALIZED (
    SELECT id, creator_id, amount
    FROM earnings
    WHERE released_at IS NULL AND available_at <= NOW()
      AND type IN ('view_earning', 'referral_bonus')
    FOR UPDATE SKIP LOCKED
  ), released AS (
    UPDATE earnings e SET released_at = NOW()
    FROM matured m WHERE e.id = m.id
    RETURNING e.creator_id, e.amount
  ), totals AS (
    SELECT creator_id, COALESCE(SUM(amount), 0) AS amount FROM released GROUP BY creator_id
  ), updated AS (
    UPDATE profiles p
    SET available_balance = p.available_balance + t.amount,
        pending_earnings = GREATEST(p.pending_earnings - t.amount, 0)
    FROM totals t WHERE p.id = t.creator_id
    RETURNING p.id, t.amount
  ), notified AS (
    INSERT INTO notifications (user_id, type, title, message, link, metadata)
    SELECT u.id, 'earning', 'Earnings released',
           'Your matured earnings of $' || trim(to_char(u.amount, 'FM999999990.000000')) || ' are now available.',
           '/dashboard/withdraw',
           jsonb_build_object('amount', u.amount)
    FROM updated u
    WHERE u.amount > 0
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_referral_commission(
  p_referrer_id UUID,
  p_amount NUMERIC,
  p_creator_id UUID,
  p_view_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hold_hours INTEGER;
  v_earning_id UUID;
  v_view_earning NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_referrer_id = p_creator_id OR p_view_id IS NULL THEN RETURN; END IF;
  SELECT amount INTO v_view_earning FROM earnings
    WHERE type = 'view_earning' AND view_id = p_view_id AND creator_id = p_creator_id;
  IF v_view_earning IS NULL OR p_amount > v_view_earning THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM referrals WHERE referrer_id = p_referrer_id AND referred_id = p_creator_id AND status = 'active') THEN RETURN; END IF;
  SELECT COALESCE(earning_holding_hours, 24) INTO v_hold_hours FROM platform_settings WHERE id = 1;

  INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
  VALUES (p_referrer_id, NULL, p_view_id, 'referral_bonus', p_amount,
          'Referral commission from referred creator view', NOW() + (COALESCE(v_hold_hours, 24) * INTERVAL '1 hour'))
  ON CONFLICT DO NOTHING RETURNING id INTO v_earning_id;
  IF v_earning_id IS NULL THEN RETURN; END IF;

  UPDATE profiles SET referral_earnings = referral_earnings + p_amount,
    pending_earnings = pending_earnings + p_amount WHERE id = p_referrer_id;
  UPDATE referrals SET total_commission = total_commission + p_amount
    WHERE referrer_id = p_referrer_id AND referred_id = p_creator_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (
    p_referrer_id,
    'referral',
    'Referral commission received',
    'You earned $' || trim(to_char(p_amount, 'FM999999990.000000')) || ' from a referred creator.',
    '/dashboard/referrals'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.release_matured_earnings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_matured_earnings() TO service_role;
REVOKE EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID, UUID) TO service_role;

-- Support ticket: notify admins on new tickets
CREATE OR REPLACE FUNCTION public.trg_support_ticket_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_admins(
    'system',
    'New support ticket',
    'Ticket: ' || left(NEW.subject, 120),
    '/admin/support',
    jsonb_build_object('ticket_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_ticket_notify ON support_tickets;
CREATE TRIGGER trg_support_ticket_notify
  AFTER INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.trg_support_ticket_notify();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
