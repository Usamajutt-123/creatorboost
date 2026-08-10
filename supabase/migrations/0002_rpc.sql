-- ============================================================
-- RPC functions used by earnings engine
-- ============================================================

-- Atomic counter update for view tracking
CREATE OR REPLACE FUNCTION increment_view_counters(
  p_campaign_id UUID,
  p_creator_id UUID,
  p_earning NUMERIC,
  p_valid BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update campaign
  UPDATE campaigns
  SET total_views = total_views + 1,
      valid_views = valid_views + CASE WHEN p_valid THEN 1 ELSE 0 END,
      invalid_views = invalid_views + CASE WHEN p_valid THEN 0 ELSE 1 END,
      total_earnings = total_earnings + CASE WHEN p_valid THEN p_earning ELSE 0 END
  WHERE id = p_campaign_id;

  -- Update profile
  UPDATE profiles
  SET total_views = total_views + 1,
      valid_views = valid_views + CASE WHEN p_valid THEN 1 ELSE 0 END,
      invalid_views = invalid_views + CASE WHEN p_valid THEN 0 ELSE 1 END,
      total_earnings = total_earnings + CASE WHEN p_valid THEN p_earning ELSE 0 END,
      pending_balance = pending_balance + CASE WHEN p_valid THEN p_earning ELSE 0 END
  WHERE id = p_creator_id;

  -- Recalculate creator level based on total views
  PERFORM recalculate_creator_level(p_creator_id);
END;
$$;

-- Recalculate level from views
CREATE OR REPLACE FUNCTION recalculate_creator_level(p_creator_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

-- Withdraw funds (atomic)
CREATE OR REPLACE FUNCTION request_withdrawal(
  p_user_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_account_details JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance NUMERIC;
  v_min NUMERIC;
  v_status withdraw_status := 'pending';
  v_withdrawal_id UUID;
BEGIN
  -- Check min
  SELECT min_withdrawal INTO v_min FROM platform_settings WHERE id = 1;
  IF p_amount < v_min THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount below minimum');
  END IF;

  -- Lock user balance
  SELECT available_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Move from available to pending
  UPDATE profiles
  SET available_balance = available_balance - p_amount,
      pending_balance = pending_balance + p_amount
  WHERE id = p_user_id;

  -- Create withdrawal
  INSERT INTO withdrawals (user_id, amount, method, account_details, status)
  VALUES (p_user_id, p_amount, p_method::withdraw_method, p_account_details, v_status)
  RETURNING id INTO v_withdrawal_id;

  -- Create notification
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, 'withdrawal', 'Withdrawal requested', 'Your withdrawal of $' || p_amount || ' is pending review.', '/dashboard/withdraw');

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_withdrawal_id);
END;
$$;

-- Approve withdrawal
CREATE OR REPLACE FUNCTION approve_withdrawal(p_withdrawal_id UUID, p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_amount NUMERIC;
BEGIN
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'pending'
  FOR UPDATE;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE withdrawals
  SET status = 'approved', processed_at = NOW(), processed_by = p_admin_id
  WHERE id = p_withdrawal_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal approved', 'Your withdrawal of $' || v_amount || ' has been approved and will be processed shortly.');
END;
$$;

-- Mark paid
CREATE OR REPLACE FUNCTION pay_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_tx_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_amount NUMERIC;
BEGIN
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status = 'approved'
  FOR UPDATE;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE withdrawals
  SET status = 'paid', transaction_id = p_tx_id, processed_at = NOW(), processed_by = p_admin_id
  WHERE id = p_withdrawal_id;

  UPDATE profiles
  SET pending_balance = pending_balance - v_amount
  WHERE id = v_user_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal paid', 'Your withdrawal of $' || v_amount || ' has been sent. TX: ' || p_tx_id);
END;
$$;

-- Reject withdrawal
CREATE OR REPLACE FUNCTION reject_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_amount NUMERIC;
BEGIN
  SELECT user_id, amount INTO v_user_id, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id AND status IN ('pending', 'approved')
  FOR UPDATE;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE withdrawals
  SET status = 'rejected', rejection_reason = p_reason, processed_at = NOW(), processed_by = p_admin_id
  WHERE id = p_withdrawal_id;

  UPDATE profiles
  SET pending_balance = pending_balance - v_amount,
      available_balance = available_balance + v_amount
  WHERE id = v_user_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_user_id, 'withdrawal', 'Withdrawal rejected', 'Your withdrawal of $' || v_amount || ' was rejected. Reason: ' || p_reason);
END;
$$;

-- Convert pending balance to available (clears hold period)
CREATE OR REPLACE FUNCTION release_pending_balance()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET available_balance = available_balance + pending_balance,
      pending_balance = 0;
END;
$$;
