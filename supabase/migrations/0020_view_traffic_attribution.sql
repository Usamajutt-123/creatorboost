-- ============================================================
-- CreatorBoost Migration 0020 — View traffic attribution + hardening
-- ------------------------------------------------------------
-- Additive only. Migrations 0001-0019 are already applied and are NOT
-- edited. Nothing here changes the CPM formula, the creator-level
-- multiplier, earnings caps, referrals, withdrawals, notifications,
-- authentication, RBAC or the existing RLS boundaries.
--
-- WHAT THIS MIGRATION DOES
--
--  1. Extends the EXISTING `views` table with two derived, admin-facing
--     attribution columns (no new table):
--        - traffic_category : safe reason bucket (never an IP)
--        - earning_eligible : TRUE only for a paid view
--     Both are maintained by the database, so they can never be supplied
--     or influenced by a client.
--
--  2. Makes the campaign + hashed-IP + 24h duplicate rule ATOMIC AND
--     RACE-PROOF at the storage layer, not merely inside one function
--     body: a partial UNIQUE index on
--        (campaign_id, ip_hash, eligibility_window_start)
--     means two concurrent transactions physically cannot both hold a
--     paid view for the same campaign + IP in the same 24-hour window.
--
--     THE RULE (unchanged, now enforced by a constraint):
--        1 IP + 1 campaign  = max 1 earning-eligible view per 24 hours
--        1 IP + another campaign = INDEPENDENT eligibility
--     There is deliberately NO site-wide per-IP restriction, so shared
--     IPs (family, campus, office, carrier NAT, public Wi-Fi) keep
--     earning on every other campaign.
--
--  3. Adds admin-only aggregate RPCs so the admin dashboard reads
--     database aggregates instead of thousands of raw rows, and never
--     needs raw visitor IPs.
--
--  4. Adds a creator-safe analytics view that EXCLUDES duplicate/bot/
--     fraud traffic entirely, so no creator surface can leak anti-fraud
--     internals.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Attribution columns on the existing `views` table
-- ------------------------------------------------------------------
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS traffic_category TEXT;
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS earning_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- The start of the rolling 24-hour eligibility bucket this view belongs to.
-- NULL for non-paid traffic, which is exactly what lets unlimited
-- duplicate/blocked rows coexist under the partial unique index below.
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS eligibility_window_start TIMESTAMPTZ;

COMMENT ON COLUMN public.views.traffic_category IS
  'Safe admin-facing traffic bucket (paid, duplicate_24h, bot_or_automation, ...). Derived server-side; never client supplied. Contains no IP or fraud threshold.';
COMMENT ON COLUMN public.views.earning_eligible IS
  'TRUE only when this view generated a CreatorBoost earning. Maintained by the database.';
COMMENT ON COLUMN public.views.eligibility_window_start IS
  'Rolling 24h bucket key for the campaign + ip_hash uniqueness constraint. NULL for non-paid traffic.';

-- ------------------------------------------------------------------
-- 2. Server-side classifier — mirrors src/lib/view-eligibility.ts
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_view_outcome(
  p_status TEXT,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'valid' THEN 'paid'
    WHEN COALESCE(btrim(p_reason), '') = '' THEN 'other'
    WHEN p_reason IN ('duplicate_ip_24h', 'duplicate_ip')          THEN 'duplicate_24h'
    WHEN p_reason IN ('duplicate_device', 'duplicate_request')     THEN 'duplicate_device'
    WHEN p_reason IN ('bot', 'emulator', 'automation')             THEN 'bot_or_automation'
    WHEN p_reason IN ('vpn', 'proxy', 'tor')                       THEN 'vpn_or_proxy'
    WHEN p_reason IN ('abnormal_traffic', 'click_spam')            THEN 'suspicious_traffic'
    WHEN p_reason IN ('rate_limited')                              THEN 'rate_limited'
    WHEN p_reason IN ('invalid_session', 'invalid_task')           THEN 'invalid_session'
    WHEN p_reason IN ('self_view', 'account_blocked',
                      'campaign_inactive', 'campaign_deleted',
                      'campaign_expired')                          THEN 'account_or_campaign'
    WHEN p_reason IN ('device_limit', 'ip_limit', 'creator_daily_cap',
                      'campaign_daily_cap', 'platform_daily_cap')  THEN 'earning_cap'
    ELSE 'other'
  END;
$$;

-- Creator visibility rule, kept beside the classifier so both the app and
-- the database agree on what a creator may ever see.
CREATE OR REPLACE FUNCTION public.view_category_is_creator_visible(p_category TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_category, 'other') NOT IN (
    'duplicate_24h', 'duplicate_device', 'bot_or_automation',
    'vpn_or_proxy', 'suspicious_traffic', 'rate_limited',
    'invalid_session', 'other'
  );
$$;

-- ------------------------------------------------------------------
-- 3. Trigger: attribution is ALWAYS derived, never accepted from a caller
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.views_attribution_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Derive, ignoring whatever the caller passed for these columns. This is
  -- the defense-in-depth that makes `earning_eligible` unforgeable even if a
  -- future code path inserts into `views` directly.
  NEW.traffic_category := public.classify_view_outcome(NEW.status::TEXT, NEW.invalid_reason);
  NEW.earning_eligible := (NEW.status = 'valid');

  IF NOT NEW.earning_eligible THEN
    NEW.earnings := 0;
  END IF;

  -- Only a paid view occupies a 24-hour eligibility slot. Non-paid traffic
  -- keeps a NULL window so any number of duplicate/blocked rows can be
  -- recorded for admin analytics without tripping the unique index.
  IF NEW.earning_eligible AND NEW.ip_hash IS NOT NULL THEN
    NEW.eligibility_window_start :=
      to_timestamp(floor(extract(EPOCH FROM COALESCE(NEW.created_at, NOW())) / 86400) * 86400);
  ELSE
    NEW.eligibility_window_start := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_views_attribution_guard ON public.views;
CREATE TRIGGER trg_views_attribution_guard
  BEFORE INSERT OR UPDATE OF status, invalid_reason, ip_hash, earnings ON public.views
  FOR EACH ROW EXECUTE FUNCTION public.views_attribution_guard();

-- Backfill existing rows through the same classifier (idempotent).
UPDATE public.views
SET traffic_category = public.classify_view_outcome(status::TEXT, invalid_reason),
    earning_eligible = (status = 'valid')
WHERE traffic_category IS NULL;

-- ------------------------------------------------------------------
-- 4. Storage-level atomicity for the 24-hour rule
-- ------------------------------------------------------------------
-- Deduplicate any historical rows that would violate the new constraint,
-- keeping the earliest paid view in each bucket. Later rows become
-- duplicate_24h traffic — visible to admins, worth nothing to creators.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY campaign_id, ip_hash,
             to_timestamp(floor(extract(EPOCH FROM created_at) / 86400) * 86400)
           ORDER BY created_at, id
         ) AS rn
  FROM public.views
  WHERE status = 'valid' AND ip_hash IS NOT NULL
)
UPDATE public.views v
SET status = 'invalid',
    invalid_reason = 'duplicate_ip_24h',
    earnings = 0
FROM ranked r
WHERE v.id = r.id AND r.rn > 1;

-- Recompute the window for the surviving paid rows.
UPDATE public.views
SET eligibility_window_start =
      to_timestamp(floor(extract(EPOCH FROM created_at) / 86400) * 86400)
WHERE status = 'valid'
  AND ip_hash IS NOT NULL
  AND eligibility_window_start IS NULL;

UPDATE public.views
SET eligibility_window_start = NULL
WHERE eligibility_window_start IS NOT NULL
  AND (status <> 'valid' OR ip_hash IS NULL);

-- THE CONSTRAINT. Two concurrent transactions cannot both insert a paid view
-- for the same campaign + hashed IP in the same window: the second one gets a
-- 23505 and the application demotes it to duplicate_24h traffic.
-- Note the key is (campaign_id, ip_hash, window) — NOT (ip_hash) alone — so a
-- different campaign from the same IP is completely unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_views_paid_campaign_ip_window
  ON public.views (campaign_id, ip_hash, eligibility_window_start)
  WHERE earning_eligible AND ip_hash IS NOT NULL;

-- Supporting indexes for the eligibility lookup and admin aggregates.
CREATE INDEX IF NOT EXISTS idx_views_campaign_iphash_created
  ON public.views (campaign_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_views_category_created
  ON public.views (traffic_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_views_creator_category_created
  ON public.views (creator_id, traffic_category, created_at DESC);

-- ------------------------------------------------------------------
-- 5. Atomic record RPC (supersedes the 0019 body; same name + signature
--    so the application call site is unchanged)
-- ------------------------------------------------------------------
-- Differences vs 0019:
--   * the rolling-window duplicate check uses the exact 24h interval AND is
--     backed by the unique index above, so it is atomic under concurrency
--     even across separate serverless instances;
--   * a 23505 from the index is caught and converted into a duplicate
--     outcome instead of failing the visitor's unlock;
--   * the returned payload carries the safe traffic category for admins.
CREATE OR REPLACE FUNCTION public.record_view_with_ip_check(
  p_campaign_id UUID,
  p_creator_id UUID,
  p_visitor_ip INET,
  p_ip_hash TEXT,
  p_country_code TEXT,
  p_device_fingerprint TEXT,
  p_user_agent TEXT,
  p_is_vpn BOOLEAN,
  p_is_proxy BOOLEAN,
  p_is_bot BOOLEAN,
  p_is_emulator BOOLEAN,
  p_fraud_score NUMERIC,
  p_status TEXT,
  p_invalid_reason TEXT,
  p_cpm_rate NUMERIC,
  p_earnings NUMERIC,
  p_tasks_completed TEXT[],
  p_validated_at TIMESTAMPTZ,
  p_idempotency_key TEXT,
  p_ip_window_hours INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_duplicate BOOLEAN := FALSE;
  v_view_id UUID;
  v_status view_status;
  v_invalid_reason TEXT := p_invalid_reason;
  v_country_code CHAR(2);
  v_earnings NUMERIC := GREATEST(COALESCE(p_earnings, 0), 0);
  v_validated_at TIMESTAMPTZ := p_validated_at;
  v_window_hours INTEGER := GREATEST(COALESCE(p_ip_window_hours, 24), 0);
  v_category TEXT;
BEGIN
  v_country_code := CASE
    WHEN COALESCE(p_country_code, '') ~ '^[A-Za-z]{2}$'
      THEN upper(p_country_code)::CHAR(2)
    ELSE NULL
  END;

  IF p_status = 'valid' THEN
    v_status := 'valid'::view_status;
  ELSE
    v_status := 'invalid'::view_status;
    v_earnings := 0;
    v_validated_at := NULL;
  END IF;

  -- Serialize concurrent requests for the SAME campaign + hashed IP.
  -- The key intentionally includes the campaign id, so traffic for another
  -- campaign from the same IP never waits on this lock and never collides.
  v_lock_key := ('x' || left(encode(
    digest(p_campaign_id::TEXT || ':' || COALESCE(p_ip_hash, ''), 'sha256'),
    'hex'), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Rolling-window check: has this campaign already been paid for this IP
  -- within the last N hours? Only *paid* views occupy the window.
  IF p_ip_hash IS NOT NULL AND v_status = 'valid' THEN
    IF EXISTS (
      SELECT 1
      FROM public.views
      WHERE campaign_id = p_campaign_id
        AND ip_hash = p_ip_hash
        AND status = 'valid'
        AND created_at >= NOW() - (v_window_hours || ' hours')::INTERVAL
    ) THEN
      v_duplicate := TRUE;
    END IF;
  END IF;

  IF v_duplicate THEN
    v_status := 'invalid'::view_status;
    v_invalid_reason := 'duplicate_ip_24h';
    v_earnings := 0;
    v_validated_at := NULL;
  END IF;

  BEGIN
    INSERT INTO public.views (
      campaign_id, creator_id, visitor_ip, ip_hash, country_code,
      device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
      fraud_score, status, invalid_reason, cpm_rate, earnings,
      tasks_completed, validated_at, idempotency_key
    ) VALUES (
      p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country_code,
      p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
      p_is_emulator, p_fraud_score, v_status, v_invalid_reason, p_cpm_rate,
      v_earnings,
      to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
      v_validated_at, p_idempotency_key
    )
    RETURNING id INTO v_view_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Another transaction won the 24h slot (uniq_views_paid_campaign_ip_window)
      -- or replayed the idempotency key. Record the traffic as a duplicate so
      -- the admin still sees it, and credit nothing.
      v_duplicate := TRUE;
      v_status := 'invalid'::view_status;
      v_invalid_reason := 'duplicate_ip_24h';
      v_earnings := 0;
      v_validated_at := NULL;

      INSERT INTO public.views (
        campaign_id, creator_id, visitor_ip, ip_hash, country_code,
        device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
        fraud_score, status, invalid_reason, cpm_rate, earnings,
        tasks_completed, validated_at, idempotency_key
      ) VALUES (
        p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country_code,
        p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
        p_is_emulator, p_fraud_score, v_status, v_invalid_reason, p_cpm_rate,
        0,
        to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
        NULL, NULL   -- drop the idempotency key: the original row owns it
      )
      RETURNING id INTO v_view_id;
  END;

  v_category := public.classify_view_outcome(v_status::TEXT, v_invalid_reason);

  RETURN jsonb_build_object(
    'view_id', v_view_id,
    'duplicate_ip', v_duplicate,
    'status', v_status::TEXT,
    'earnings', v_earnings,
    'traffic_category', v_category,
    'earning_eligible', v_status = 'valid'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_view_with_ip_check(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC,
  TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TIMESTAMPTZ, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_view_with_ip_check(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC,
  TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TIMESTAMPTZ, TEXT, INTEGER
) TO service_role;

-- ------------------------------------------------------------------
-- 5b. Creator counters must never include anti-fraud traffic
-- ------------------------------------------------------------------
-- Same name, same signature, same financial logic as migration 0008 — the
-- CPM formula, the per-view cap, the creator/campaign/platform daily caps,
-- the holding period, the ledger insert and the referral path are all
-- byte-for-byte unchanged.
--
-- THE ONLY CHANGE is the non-paid branch at the end. Previously EVERY
-- rejected view incremented profiles.total_views / invalid_views and
-- campaigns.total_views / invalid_views, which meant a creator could see a
-- counter tick up for a duplicate or a blocked bot and infer the anti-fraud
-- rules from their own browser. Traffic in a creator-hidden category is now
-- recorded in `views` for admin analytics ONLY and leaves creator-facing
-- counters untouched.
--
-- Creator-VISIBLE rejections (earning caps, account/campaign state) keep
-- their existing counter behaviour, because those are legitimate business
-- outcomes rather than security internals.
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_view_campaign UUID;
  v_view_creator UUID;
  v_view_status view_status;
  v_accounted_at TIMESTAMPTZ;
  v_owner UUID;
  v_campaign_status campaign_status;
  v_creator_status user_status;
  v_valid BOOLEAN := COALESCE(p_valid, FALSE);
  v_reason TEXT := NULL;
  v_earning NUMERIC(14,6) := GREATEST(COALESCE(p_earning, 0), 0);
  v_hold_hours INTEGER;
  v_earning_id UUID;
  v_creator_today NUMERIC;
  v_campaign_today NUMERIC;
  v_platform_today NUMERIC;
  v_caps platform_settings%ROWTYPE;
  v_category TEXT;
  v_creator_visible BOOLEAN;
BEGIN
  SELECT campaign_id, creator_id, status, accounted_at
    INTO v_view_campaign, v_view_creator, v_view_status, v_accounted_at
  FROM views WHERE id = p_view_id FOR UPDATE;
  IF v_view_campaign IS NULL OR v_view_campaign <> p_campaign_id OR v_view_creator <> p_creator_id THEN
    RETURN jsonb_build_object('processed', FALSE, 'valid', FALSE, 'reason', 'integrity_mismatch');
  END IF;
  IF v_accounted_at IS NOT NULL THEN
    RETURN jsonb_build_object('processed', TRUE, 'valid', v_view_status = 'valid', 'duplicate', TRUE);
  END IF;

  SELECT creator_id, status INTO v_owner, v_campaign_status FROM campaigns WHERE id = p_campaign_id;
  SELECT status INTO v_creator_status FROM profiles WHERE id = p_creator_id;
  IF NOT v_valid OR v_view_status <> 'valid' THEN
    v_valid := FALSE;
    v_reason := COALESCE((SELECT invalid_reason FROM views WHERE id = p_view_id), 'invalid_traffic');
  ELSIF v_owner IS NULL OR v_owner <> p_creator_id OR v_campaign_status <> 'active' THEN
    v_valid := FALSE; v_reason := 'campaign_inactive';
  ELSIF v_creator_status IS NULL OR v_creator_status <> 'active' THEN
    v_valid := FALSE; v_reason := 'account_blocked';
  END IF;

  IF v_valid THEN
    -- Serialize cap checks in a stable order. This makes concurrent requests
    -- see prior committed earnings before crediting the next view.
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:platform-earnings'));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:creator:' || p_creator_id::TEXT));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:campaign:' || p_campaign_id::TEXT));
    SELECT * INTO v_caps FROM platform_settings WHERE id = 1;
    v_earning := LEAST(v_earning, COALESCE(v_caps.max_earnings_per_view, 0));
    IF v_earning < 0 THEN v_earning := 0; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_creator_today FROM earnings
      WHERE creator_id = p_creator_id AND type = 'view_earning' AND created_at >= NOW() - INTERVAL '24 hours';
    SELECT COALESCE(SUM(amount), 0) INTO v_campaign_today FROM earnings
      WHERE campaign_id = p_campaign_id AND type = 'view_earning' AND created_at >= NOW() - INTERVAL '24 hours';
    SELECT COALESCE(SUM(amount), 0) INTO v_platform_today FROM earnings
      WHERE type = 'view_earning' AND created_at >= NOW() - INTERVAL '24 hours';
    IF v_creator_today + v_earning > COALESCE(v_caps.creator_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'creator_daily_cap';
    ELSIF v_campaign_today + v_earning > COALESCE(v_caps.campaign_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'campaign_daily_cap';
    ELSIF v_platform_today + v_earning > COALESCE(v_caps.platform_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'platform_daily_cap';
    END IF;
  END IF;

  IF v_valid AND v_earning > 0 THEN
    SELECT COALESCE(earning_holding_hours, 24) INTO v_hold_hours FROM platform_settings WHERE id = 1;
    INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
    VALUES (p_creator_id, p_campaign_id, p_view_id, 'view_earning', v_earning,
            COALESCE(p_description, 'View earning'), NOW() + (COALESCE(v_hold_hours, 24) * INTERVAL '1 hour'))
    ON CONFLICT DO NOTHING RETURNING id INTO v_earning_id;
    IF v_earning_id IS NULL THEN
      RETURN jsonb_build_object('processed', FALSE, 'valid', FALSE, 'reason', 'duplicate_view');
    END IF;
  END IF;

  IF v_valid THEN
    UPDATE campaigns SET total_views = total_views + 1, valid_views = valid_views + 1,
      total_earnings = total_earnings + v_earning WHERE id = p_campaign_id;
    UPDATE profiles SET total_views = total_views + 1, valid_views = valid_views + 1,
      total_earnings = total_earnings + v_earning,
      pending_earnings = pending_earnings + v_earning WHERE id = p_creator_id;
    PERFORM public.recalculate_creator_level(p_creator_id);
    UPDATE views SET earnings = v_earning, status = 'valid', invalid_reason = NULL, accounted_at = NOW(), validated_at = COALESCE(validated_at, NOW()) WHERE id = p_view_id;
    RETURN jsonb_build_object('processed', TRUE, 'valid', TRUE, 'earning', v_earning);
  END IF;

  -- Non-paid outcome. The view row is always updated (admin analytics keep
  -- the full picture), but creator-facing counters only move for categories
  -- a creator is allowed to see.
  v_category := public.classify_view_outcome('invalid', COALESCE(v_reason, 'invalid_traffic'));
  v_creator_visible := public.view_category_is_creator_visible(v_category);

  UPDATE views SET status = 'invalid', earnings = 0, invalid_reason = COALESCE(v_reason, 'invalid_traffic'), accounted_at = NOW(), validated_at = COALESCE(validated_at, NOW()) WHERE id = p_view_id;

  IF v_creator_visible THEN
    UPDATE campaigns SET total_views = total_views + 1, invalid_views = invalid_views + 1 WHERE id = p_campaign_id;
    UPDATE profiles SET total_views = total_views + 1, invalid_views = invalid_views + 1 WHERE id = p_creator_id;
  END IF;

  -- The reason is returned to the SERVER caller (the earnings engine) for
  -- logging/admin attribution. The public route never forwards it onward.
  RETURN jsonb_build_object('processed', TRUE, 'valid', FALSE, 'reason', COALESCE(v_reason, 'invalid_traffic'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO service_role;

-- ------------------------------------------------------------------
-- 6. Admin analytics aggregates (server-side, no raw rows, no raw IPs)
-- ------------------------------------------------------------------
-- Returns one row per safe category. The admin dashboard renders the totals
-- from this instead of downloading thousands of `views` rows into a browser.
CREATE OR REPLACE FUNCTION public.admin_view_traffic_summary(
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_campaign_id UUID DEFAULT NULL,
  p_creator_id UUID DEFAULT NULL
)
RETURNS TABLE (category TEXT, views BIGINT, earnings NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Identity is derived server-side from the session. A creator calling this
  -- RPC directly gets nothing, so the anti-fraud breakdown cannot leak.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason)) AS category,
    COUNT(*)::BIGINT AS views,
    COALESCE(SUM(v.earnings), 0)::NUMERIC AS earnings
  FROM public.views v
  WHERE (p_since IS NULL OR v.created_at >= p_since)
    AND (p_campaign_id IS NULL OR v.campaign_id = p_campaign_id)
    AND (p_creator_id IS NULL OR v.creator_id = p_creator_id)
  GROUP BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_view_traffic_summary(TIMESTAMPTZ, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_view_traffic_summary(TIMESTAMPTZ, UUID, UUID)
  TO authenticated, service_role;

-- Daily paid vs non-paid trend for the admin traffic-quality chart.
CREATE OR REPLACE FUNCTION public.admin_view_traffic_daily(
  p_days INTEGER DEFAULT 14
)
RETURNS TABLE (day DATE, total BIGINT, paid BIGINT, duplicates BIGINT, fraud_blocked BIGINT, earnings NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (date_trunc('day', v.created_at))::DATE AS day,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE v.status = 'valid')::BIGINT AS paid,
    COUNT(*) FILTER (
      WHERE COALESCE(v.traffic_category,
        public.classify_view_outcome(v.status::TEXT, v.invalid_reason))
        IN ('duplicate_24h', 'duplicate_device')
    )::BIGINT AS duplicates,
    COUNT(*) FILTER (
      WHERE COALESCE(v.traffic_category,
        public.classify_view_outcome(v.status::TEXT, v.invalid_reason))
        IN ('bot_or_automation', 'vpn_or_proxy', 'suspicious_traffic')
    )::BIGINT AS fraud_blocked,
    COALESCE(SUM(v.earnings), 0)::NUMERIC AS earnings
  FROM public.views v
  WHERE v.created_at >= NOW() - (v_days || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_view_traffic_daily(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_view_traffic_daily(INTEGER) TO authenticated, service_role;

-- Top visitor countries for the admin dashboard chart.
-- The dashboard previously downloaded one row per view and counted them in
-- the server component; on a large `views` table that is an unbounded read.
-- The GROUP BY happens in the database and only the top N rows are returned.
-- No IP, ip_hash, fingerprint or user agent is exposed — country only.
CREATE OR REPLACE FUNCTION public.admin_view_country_stats(
  p_days INTEGER DEFAULT 7,
  p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (country_code TEXT, views BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days  INTEGER := LEAST(GREATEST(COALESCE(p_days, 7), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(v.country_code, 'XX')::TEXT AS country_code,
    COUNT(*)::BIGINT AS views
  FROM public.views v
  WHERE v.created_at >= NOW() - (v_days || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_view_country_stats(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_view_country_stats(INTEGER, INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. Creator-safe analytics view
-- ------------------------------------------------------------------
-- security_invoker keeps the existing `creators_read_own_views` RLS policy in
-- force, so a creator still only sees their own campaigns. On top of that,
-- every anti-fraud category is filtered OUT, and no ip_hash, visitor_ip,
-- fraud_score, invalid_reason or traffic_category column is exposed.
DROP VIEW IF EXISTS public.creator_campaign_traffic;
CREATE VIEW public.creator_campaign_traffic
WITH (security_invoker = true) AS
SELECT
  v.creator_id,
  v.campaign_id,
  v.country_code,
  date_trunc('day', v.created_at) AS day,
  COUNT(*) FILTER (WHERE v.status = 'valid')::BIGINT AS valid_views,
  COALESCE(SUM(v.earnings) FILTER (WHERE v.status = 'valid'), 0)::NUMERIC AS earnings
FROM public.views v
WHERE public.view_category_is_creator_visible(
        COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason))
      )
GROUP BY v.creator_id, v.campaign_id, v.country_code, date_trunc('day', v.created_at);

REVOKE ALL ON public.creator_campaign_traffic FROM PUBLIC, anon;
GRANT SELECT ON public.creator_campaign_traffic TO authenticated;

-- ------------------------------------------------------------------
-- 8. Column-level privacy reassertion
-- ------------------------------------------------------------------
-- `views` already has: REVOKE ALL FROM anon, authenticated (0008) plus a
-- SELECT grant for authenticated, gated by RLS. Restate it so the new
-- columns inherit the same boundary and no client can ever write them.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.views FROM anon, authenticated;

-- ============================================================
-- End migration 0020
-- ============================================================
