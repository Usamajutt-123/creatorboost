-- ============================================================
-- CreatorBoost Migration 0021 — Privacy, atomic accounting, authorization
-- ------------------------------------------------------------
-- Additive only. Migrations 0001-0020 are already applied and are NOT
-- edited. Nothing here changes the CPM formula, the creator-level
-- multiplier, the earning caps, the holding period, the withdrawal fee
-- model, authentication or the product's business rules.
--
-- WHAT THIS MIGRATION DOES
--
--  1. ADMIN AUTHORIZATION: is_admin()/is_super_admin() now additionally
--     require profiles.status = 'active'. A suspended or banned admin keeps
--     the role but loses every database-level admin capability.
--
--  2. CREATOR RAW TRAFFIC ACCESS: the `views` table is no longer readable by
--     the `authenticated` role at all. Creators read a curated projection
--     (`creator_view_analytics`) that contains no IP, ip_hash, fingerprint,
--     user agent, fraud score, bot/VPN flag, invalid_reason or traffic
--     category, and only earning-eligible / creator-visible traffic.
--
--  3. AGGREGATE LEAKAGE: campaign_summary / campaign_daily_stats /
--     campaign_country_stats / creator_campaign_traffic are redefined so a
--     creator can no longer infer hidden duplicate/bot/proxy traffic from a
--     total. Admin analytics keep the complete traffic-quality picture
--     through the admin RPCs from migration 0020.
--
--  4. ATOMIC VIEW + EARNING: `record_view_and_credit()` performs validation,
--     duplicate checks, caps, view insert, ledger insert, counters, pending
--     balance and referral commission inside ONE transaction.
--
--  5. DUPLICATE WINDOW: the storage-level uniqueness bucket now follows the
--     configured `platform_settings.duplicate_ip_window_hours` instead of a
--     fixed UTC day, so the constraint agrees with the configured rule.
--
--  6. CPM COUNTRY: signup metadata can no longer promote a creator into a
--     premium CPM country. Trusted provisioning happens through
--     `provision_cpm_country()` (service-role only).
--
--  7. Referral ledger precision, withdrawal account-details exposure,
--     supported withdrawal methods, signup_enabled/maintenance_mode
--     enforcement and supporting indexes.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Admin authorization must consider account status
-- ------------------------------------------------------------------
-- A privileged role is only honoured while the account itself is active.
-- Creators are unaffected: they never satisfy the role predicate anyway.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT TRUE FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
  ), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT TRUE FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND status = 'active'
  ), FALSE);
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'TRUE only for an ACTIVE admin/super_admin. Suspended or banned admins lose every database-level privilege.';
COMMENT ON FUNCTION public.is_super_admin() IS
  'TRUE only for an ACTIVE super_admin.';

-- The withdrawal RPCs from 0008 call is_admin(); they therefore inherit the
-- active-status requirement automatically. Reassert the guard explicitly on
-- the ledger-affecting ones so the intent is visible in schema-as-code.
--   approve_withdrawal / pay_withdrawal / reject_withdrawal -> is_admin()

-- ------------------------------------------------------------------
-- 2. Creator-safe traffic projection
-- ------------------------------------------------------------------
-- Coarse device bucket. Derived from the stored user agent INSIDE the
-- database, so a creator receives a category and never the raw UA string.
CREATE OR REPLACE FUNCTION public.view_device_category(p_user_agent TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_user_agent, '')) LIKE '%ipad%'
      OR (lower(COALESCE(p_user_agent, '')) LIKE '%android%'
          AND lower(COALESCE(p_user_agent, '')) NOT LIKE '%mobile%') THEN 'tablet'
    WHEN lower(COALESCE(p_user_agent, '')) LIKE '%mobile%'
      OR lower(COALESCE(p_user_agent, '')) LIKE '%android%'
      OR lower(COALESCE(p_user_agent, '')) LIKE '%iphone%' THEN 'mobile'
    ELSE 'desktop'
  END;
$$;

-- Row-level creator analytics.
--
-- SECURITY: this is a SECURITY DEFINER view (the PostgreSQL default). The
-- `views` table grant is removed from `authenticated` below, so a creator can
-- ONLY reach traffic data through this projection, and the WHERE clause —
-- not a client filter — decides which rows they see.
--
-- EXPOSED   : campaign, country, coarse device bucket, timestamp, earning
-- NEVER     : visitor_ip, ip_hash, device_fingerprint, user_agent,
--             fraud_score, is_bot/is_vpn/is_proxy/is_emulator,
--             invalid_reason, traffic_category, eligibility_window_start
DROP VIEW IF EXISTS public.creator_view_analytics;
CREATE VIEW public.creator_view_analytics AS
SELECT
  v.id,
  v.creator_id,
  v.campaign_id,
  v.country_code,
  public.view_device_category(v.user_agent) AS device_category,
  v.created_at,
  v.earnings
FROM public.views v
WHERE v.status = 'valid'
  AND COALESCE(v.earning_eligible, v.status = 'valid')
  AND (v.creator_id = auth.uid() OR public.is_admin());

REVOKE ALL ON public.creator_view_analytics FROM PUBLIC, anon;
GRANT SELECT ON public.creator_view_analytics TO authenticated;

COMMENT ON VIEW public.creator_view_analytics IS
  'Creator-safe per-view projection: earning-eligible traffic only, own rows only, no IP/fingerprint/user-agent/fraud column.';

-- ------------------------------------------------------------------
-- 3. Creator-facing aggregates must exclude hidden security traffic
-- ------------------------------------------------------------------
-- These three views existed since 0007 with `security_invoker = true` and
-- counted EVERY row in `views`, including duplicate/bot/proxy traffic. A
-- creator could subtract valid from total and infer exactly how much of
-- their traffic the anti-fraud layer rejected, and why it changed over time.
--
-- They keep their names, their columns and their consumers. What changes:
--   * only creator-visible traffic is counted (0020's classifier decides),
--   * `invalid_views` counts only creator-visible business rejections
--     (earning caps, campaign/account state) — never security traffic,
--   * row access is enforced in the view instead of relying on a table grant.
DROP VIEW IF EXISTS public.campaign_summary;
CREATE VIEW public.campaign_summary AS
SELECT
  v.campaign_id,
  COUNT(*)                                                                   AS total_views,
  COUNT(*) FILTER (WHERE v.status = 'valid')                                 AS valid_views,
  COUNT(*) FILTER (WHERE v.status <> 'valid')                                AS invalid_views,
  COALESCE(SUM(v.earnings), 0)                                               AS total_earnings,
  COUNT(*) FILTER (WHERE v.created_at > NOW() - INTERVAL '24 hours')         AS views_24h,
  COUNT(*) FILTER (WHERE v.created_at > NOW() - INTERVAL '7 days')           AS views_7d,
  COUNT(*) FILTER (WHERE v.created_at > NOW() - INTERVAL '30 days')          AS views_30d
FROM public.views v
WHERE public.view_category_is_creator_visible(
        COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason)))
  AND (v.creator_id = auth.uid() OR public.is_admin())
GROUP BY v.campaign_id;

DROP VIEW IF EXISTS public.campaign_daily_stats;
CREATE VIEW public.campaign_daily_stats AS
SELECT
  v.campaign_id,
  DATE_TRUNC('day', v.created_at)                     AS day,
  COUNT(*)                                            AS views,
  COUNT(*) FILTER (WHERE v.status = 'valid')          AS valid,
  COALESCE(SUM(v.earnings), 0)                        AS earnings
FROM public.views v
WHERE public.view_category_is_creator_visible(
        COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason)))
  AND (v.creator_id = auth.uid() OR public.is_admin())
GROUP BY v.campaign_id, DATE_TRUNC('day', v.created_at);

DROP VIEW IF EXISTS public.campaign_country_stats;
CREATE VIEW public.campaign_country_stats AS
SELECT
  v.campaign_id,
  v.country_code,
  COUNT(*)                                            AS views,
  COUNT(*) FILTER (WHERE v.status = 'valid')          AS valid,
  COUNT(*) FILTER (WHERE v.status <> 'valid')         AS invalid
FROM public.views v
WHERE public.view_category_is_creator_visible(
        COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason)))
  AND (v.creator_id = auth.uid() OR public.is_admin())
GROUP BY v.campaign_id, v.country_code;

REVOKE ALL ON public.campaign_summary, public.campaign_daily_stats, public.campaign_country_stats
  FROM PUBLIC, anon;
GRANT SELECT ON public.campaign_summary, public.campaign_daily_stats, public.campaign_country_stats
  TO authenticated;

-- 0020's creator aggregate was `security_invoker`; it must now enforce its own
-- row scope because the underlying table grant is gone.
DROP VIEW IF EXISTS public.creator_campaign_traffic;
CREATE VIEW public.creator_campaign_traffic AS
SELECT
  v.creator_id,
  v.campaign_id,
  v.country_code,
  date_trunc('day', v.created_at) AS day,
  COUNT(*) FILTER (WHERE v.status = 'valid')::BIGINT AS valid_views,
  COALESCE(SUM(v.earnings) FILTER (WHERE v.status = 'valid'), 0)::NUMERIC AS earnings
FROM public.views v
WHERE public.view_category_is_creator_visible(
        COALESCE(v.traffic_category, public.classify_view_outcome(v.status::TEXT, v.invalid_reason)))
  AND (v.creator_id = auth.uid() OR public.is_admin())
GROUP BY v.creator_id, v.campaign_id, v.country_code, date_trunc('day', v.created_at);

REVOKE ALL ON public.creator_campaign_traffic FROM PUBLIC, anon;
GRANT SELECT ON public.creator_campaign_traffic TO authenticated;

-- ------------------------------------------------------------------
-- 4. Remove creator access to the RAW views table
-- ------------------------------------------------------------------
-- Hiding the columns in React is not a boundary. The boundary is here: no
-- SELECT grant for browser roles, and no creator SELECT policy. Server code
-- uses the service role; admin analytics use the SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS creators_read_own_views ON public.views;
REVOKE ALL ON TABLE public.views FROM anon, authenticated;

COMMENT ON TABLE public.views IS
  'Raw traffic + anti-fraud evidence. NOT readable by anon/authenticated. Creators read public.creator_view_analytics; admins use the admin_view_* RPCs or the service role.';

-- ------------------------------------------------------------------
-- 5. Duplicate-window bucket follows the CONFIGURED window
-- ------------------------------------------------------------------
-- 0020 bucketed the unique index by a fixed UTC day (floor(epoch/86400)),
-- which silently disagreed with `platform_settings.duplicate_ip_window_hours`
-- whenever an operator configured anything other than 24. The bucket size is
-- now read from the same setting the RPC uses.
CREATE OR REPLACE FUNCTION public.duplicate_window_seconds()
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE((SELECT duplicate_ip_window_hours FROM public.platform_settings WHERE id = 1), 24),
    1
  )::INTEGER * 3600;
$$;

CREATE OR REPLACE FUNCTION public.views_attribution_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_seconds INTEGER;
BEGIN
  -- Derived, never accepted from a caller (defense in depth for any future
  -- code path that inserts into `views` directly).
  NEW.traffic_category := public.classify_view_outcome(NEW.status::TEXT, NEW.invalid_reason);
  NEW.earning_eligible := (NEW.status = 'valid');

  IF NOT NEW.earning_eligible THEN
    NEW.earnings := 0;
  END IF;

  IF NEW.earning_eligible AND NEW.ip_hash IS NOT NULL THEN
    v_window_seconds := public.duplicate_window_seconds();
    NEW.eligibility_window_start := to_timestamp(
      floor(extract(EPOCH FROM COALESCE(NEW.created_at, NOW())) / v_window_seconds) * v_window_seconds
    );
  ELSE
    NEW.eligibility_window_start := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- The unique index itself is unchanged (campaign_id, ip_hash, window bucket);
-- only the bucket size moved from "fixed 24h" to "configured window". The
-- rolling-window EXISTS check inside the RPC remains the primary rule and is
-- strictly stronger; the index is the concurrency backstop.

-- ------------------------------------------------------------------
-- 6. Cap snapshot (one indexed aggregate round-trip instead of row dumps)
-- ------------------------------------------------------------------
-- The application used to SELECT every `earnings.amount` row for the creator,
-- the campaign and the whole platform and sum them in JavaScript. That is an
-- unbounded download on a busy platform. The same numbers are computed here
-- with SUM() over indexed ranges and returned as a single row.
CREATE OR REPLACE FUNCTION public.view_cap_snapshot(
  p_creator_id UUID,
  p_campaign_id UUID,
  p_ip_hash TEXT DEFAULT NULL,
  p_device_fingerprint TEXT DEFAULT NULL,
  p_window_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  creator_earnings_today  NUMERIC,
  campaign_earnings_today NUMERIC,
  platform_earnings_today NUMERIC,
  ip_views_today          BIGINT,
  device_views_today      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (GREATEST(COALESCE(p_window_hours, 24), 1) || ' hours')::INTERVAL;
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(e.amount) FROM earnings e
              WHERE e.creator_id = p_creator_id
                AND e.type = 'view_earning'
                AND e.created_at >= v_since), 0)::NUMERIC,
    COALESCE((SELECT SUM(e.amount) FROM earnings e
              WHERE e.campaign_id = p_campaign_id
                AND e.type = 'view_earning'
                AND e.created_at >= v_since), 0)::NUMERIC,
    COALESCE((SELECT SUM(e.amount) FROM earnings e
              WHERE e.type = 'view_earning'
                AND e.created_at >= v_since), 0)::NUMERIC,
    COALESCE((SELECT COUNT(*) FROM views v
              WHERE p_ip_hash IS NOT NULL
                AND v.creator_id = p_creator_id
                AND v.ip_hash = p_ip_hash
                AND v.created_at >= v_since), 0)::BIGINT,
    COALESCE((SELECT COUNT(*) FROM views v
              WHERE p_device_fingerprint IS NOT NULL
                AND v.creator_id = p_creator_id
                AND v.device_fingerprint = p_device_fingerprint
                AND v.created_at >= v_since), 0)::BIGINT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.view_cap_snapshot(UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.view_cap_snapshot(UUID, UUID, TEXT, TEXT, INTEGER)
  TO service_role;

-- ------------------------------------------------------------------
-- 7. ATOMIC view + earning transaction
-- ------------------------------------------------------------------
-- Previously the engine called record_view_with_ip_check() and then
-- credit_view_earning() as two separate statements, i.e. two transactions
-- from the connection's point of view. A failure between them could leave a
-- 'valid' view with no ledger row (creator underpaid, counters wrong).
--
-- This function performs the whole critical path in ONE transaction:
--
--   validate view/campaign/creator -> duplicate window -> caps -> insert view
--   -> insert earning ledger -> campaign counters -> creator counters
--   -> pending balance -> creator level -> referral commission -> commit
--
-- Everything either commits together or rolls back together.
--
-- Preserved from the existing implementation, byte-for-byte in behaviour:
--   * the per-view cap (max_earnings_per_view),
--   * the creator/campaign/platform 24h earning caps,
--   * the earning holding period (available_at),
--   * idempotency (views.idempotency_key unique index),
--   * the campaign + hashed-IP duplicate window,
--   * the creator-visibility rule for counters from 0020,
--   * referral commission via credit_referral_commission().
CREATE OR REPLACE FUNCTION public.record_view_and_credit(
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
  p_idempotency_key TEXT,
  p_ip_window_hours INTEGER DEFAULT 24,
  p_description TEXT DEFAULT NULL,
  p_referral_percentage NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key       BIGINT;
  v_view_id        UUID;
  v_status         view_status;
  v_reason         TEXT := p_invalid_reason;
  v_country        CHAR(2);
  v_earning        NUMERIC(14,6) := GREATEST(COALESCE(p_earnings, 0), 0);
  v_valid          BOOLEAN;
  v_caps           platform_settings%ROWTYPE;
  v_campaign_owner UUID;
  v_campaign_state campaign_status;
  v_creator_state  user_status;
  v_creator_today  NUMERIC;
  v_campaign_today NUMERIC;
  v_platform_today NUMERIC;
  v_hold_hours     INTEGER;
  v_earning_id     UUID;
  v_existing       RECORD;
  v_category       TEXT;
  v_creator_visible BOOLEAN;
  v_window_hours   INTEGER := GREATEST(COALESCE(p_ip_window_hours, 24), 1);
  v_referrer       UUID;
  v_commission     NUMERIC(14,6);
  v_pct            NUMERIC;
BEGIN
  -- ---------------------------------------------------------------
  -- 0. Idempotency: a replay returns the ORIGINAL outcome and never
  --    creates a second view or a second ledger row.
  -- ---------------------------------------------------------------
  IF COALESCE(btrim(p_idempotency_key), '') <> '' THEN
    SELECT id, status, invalid_reason, earnings
      INTO v_existing
    FROM views
    WHERE creator_id = p_creator_id AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'processed', TRUE,
        'replayed', TRUE,
        'view_id', v_existing.id,
        'valid', v_existing.status = 'valid',
        'earning', COALESCE(v_existing.earnings, 0),
        'reason', v_existing.invalid_reason,
        'traffic_category', public.classify_view_outcome(v_existing.status::TEXT, v_existing.invalid_reason)
      );
    END IF;
  END IF;

  v_country := CASE
    WHEN COALESCE(p_country_code, '') ~ '^[A-Za-z]{2}$' THEN upper(p_country_code)::CHAR(2)
    ELSE NULL
  END;

  v_valid := (p_status = 'valid');
  IF NOT v_valid THEN
    v_earning := 0;
    v_reason  := COALESCE(NULLIF(btrim(COALESCE(p_invalid_reason, '')), ''), 'invalid_traffic');
  END IF;

  -- ---------------------------------------------------------------
  -- 1. Campaign + creator state (server-side truth, never the client's)
  -- ---------------------------------------------------------------
  IF v_valid THEN
    SELECT creator_id, status INTO v_campaign_owner, v_campaign_state
    FROM campaigns WHERE id = p_campaign_id AND deleted_at IS NULL;
    SELECT status INTO v_creator_state FROM profiles WHERE id = p_creator_id;

    IF v_campaign_owner IS NULL OR v_campaign_owner <> p_creator_id OR v_campaign_state <> 'active' THEN
      v_valid := FALSE; v_reason := 'campaign_inactive'; v_earning := 0;
    ELSIF v_creator_state IS NULL OR v_creator_state <> 'active' THEN
      v_valid := FALSE; v_reason := 'account_blocked'; v_earning := 0;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Duplicate window for this campaign + hashed IP.
  --    The advisory lock is scoped to (campaign, ip) so traffic for a
  --    DIFFERENT campaign from the same IP never serializes behind it.
  -- ---------------------------------------------------------------
  IF v_valid AND p_ip_hash IS NOT NULL THEN
    v_lock_key := ('x' || left(encode(
      digest(p_campaign_id::TEXT || ':' || p_ip_hash, 'sha256'), 'hex'), 16))::BIT(64)::BIGINT;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    IF EXISTS (
      SELECT 1 FROM views
      WHERE campaign_id = p_campaign_id
        AND ip_hash = p_ip_hash
        AND status = 'valid'
        AND created_at >= NOW() - (v_window_hours || ' hours')::INTERVAL
    ) THEN
      v_valid := FALSE; v_reason := 'duplicate_ip_24h'; v_earning := 0;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Caps. Computed BEFORE the serializing platform lock is taken so the
  --    lock is held for the shortest possible time (scalability), then
  --    re-read under the lock so the decision stays correct.
  -- ---------------------------------------------------------------
  SELECT * INTO v_caps FROM platform_settings WHERE id = 1;

  IF v_valid THEN
    v_earning := LEAST(v_earning, GREATEST(COALESCE(v_caps.max_earnings_per_view, 0), 0));
    IF v_earning < 0 THEN v_earning := 0; END IF;
  END IF;

  IF v_valid AND v_earning > 0 THEN
    -- Locks in a STABLE order (platform -> creator -> campaign) to avoid
    -- deadlocks. Only the aggregate reads and the writes happen under them.
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:platform-earnings'));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:creator:' || p_creator_id::TEXT));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:campaign:' || p_campaign_id::TEXT));

    SELECT creator_earnings_today, campaign_earnings_today, platform_earnings_today
      INTO v_creator_today, v_campaign_today, v_platform_today
    FROM public.view_cap_snapshot(p_creator_id, p_campaign_id, NULL, NULL, 24);

    IF v_creator_today + v_earning > COALESCE(v_caps.creator_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'creator_daily_cap'; v_earning := 0;
    ELSIF v_campaign_today + v_earning > COALESCE(v_caps.campaign_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'campaign_daily_cap'; v_earning := 0;
    ELSIF v_platform_today + v_earning > COALESCE(v_caps.platform_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'platform_daily_cap'; v_earning := 0;
    END IF;
  END IF;

  v_status := CASE WHEN v_valid THEN 'valid'::view_status ELSE 'invalid'::view_status END;
  IF NOT v_valid THEN v_earning := 0; END IF;

  -- ---------------------------------------------------------------
  -- 4. Insert the view. Non-paid traffic is still recorded so admin
  --    analytics keep the full picture.
  -- ---------------------------------------------------------------
  BEGIN
    INSERT INTO views (
      campaign_id, creator_id, visitor_ip, ip_hash, country_code,
      device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
      fraud_score, status, invalid_reason, cpm_rate, earnings,
      tasks_completed, validated_at, accounted_at, idempotency_key
    ) VALUES (
      p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country,
      p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
      p_is_emulator, p_fraud_score, v_status,
      CASE WHEN v_valid THEN NULL ELSE v_reason END,
      p_cpm_rate, v_earning,
      to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
      CASE WHEN v_valid THEN NOW() ELSE NULL END,
      NOW(),
      NULLIF(btrim(COALESCE(p_idempotency_key, '')), '')
    )
    RETURNING id INTO v_view_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Either the 24h campaign+IP slot was taken by a concurrent
      -- transaction, or the idempotency key was replayed. Both mean: no
      -- second earning. Record the traffic for admins and credit nothing.
      v_valid := FALSE;
      v_reason := 'duplicate_ip_24h';
      v_earning := 0;
      v_status := 'invalid'::view_status;

      INSERT INTO views (
        campaign_id, creator_id, visitor_ip, ip_hash, country_code,
        device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
        fraud_score, status, invalid_reason, cpm_rate, earnings,
        tasks_completed, validated_at, accounted_at, idempotency_key
      ) VALUES (
        p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country,
        p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
        p_is_emulator, p_fraud_score, v_status, v_reason, p_cpm_rate, 0,
        to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
        NULL, NOW(), NULL   -- the original row keeps the idempotency key
      )
      RETURNING id INTO v_view_id;
  END;

  -- ---------------------------------------------------------------
  -- 5. Ledger + counters + pending balance + referral, same transaction.
  -- ---------------------------------------------------------------
  IF v_valid AND v_earning > 0 THEN
    v_hold_hours := COALESCE(v_caps.earning_holding_hours, 24);

    INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
    VALUES (p_creator_id, p_campaign_id, v_view_id, 'view_earning', v_earning,
            COALESCE(p_description, 'View earning'),
            NOW() + (v_hold_hours * INTERVAL '1 hour'))
    RETURNING id INTO v_earning_id;

    -- A missing ledger row must never leave a paid view behind: the whole
    -- transaction is aborted instead.
    IF v_earning_id IS NULL THEN
      RAISE EXCEPTION 'earning ledger insert failed for view %', v_view_id;
    END IF;
  END IF;

  IF v_valid THEN
    UPDATE campaigns
      SET total_views = total_views + 1,
          valid_views = valid_views + 1,
          total_earnings = total_earnings + v_earning
      WHERE id = p_campaign_id;

    UPDATE profiles
      SET total_views = total_views + 1,
          valid_views = valid_views + 1,
          total_earnings = total_earnings + v_earning,
          pending_earnings = pending_earnings + v_earning
      WHERE id = p_creator_id;

    PERFORM public.recalculate_creator_level(p_creator_id);

    -- Referral commission, inside the same transaction as the earning it is
    -- derived from. Rounding is deliberately NOT applied here: the ledger
    -- keeps 6 decimal places so fractional commissions are not lost.
    IF v_earning > 0 THEN
      SELECT referred_by INTO v_referrer FROM profiles WHERE id = p_creator_id;
      IF v_referrer IS NOT NULL AND v_referrer <> p_creator_id THEN
        v_pct := COALESCE(p_referral_percentage, v_caps.referral_percentage, 0);
        v_commission := LEAST(GREATEST(v_earning * v_pct / 100.0, 0), v_earning);
        IF v_commission > 0 THEN
          PERFORM public.credit_referral_commission(v_referrer, v_commission, p_creator_id, v_view_id);
        END IF;
      END IF;
    END IF;
  ELSE
    -- Non-paid outcome. Creator-facing counters only move for categories a
    -- creator is allowed to see; security traffic stays admin-only.
    v_category := public.classify_view_outcome('invalid', v_reason);
    v_creator_visible := public.view_category_is_creator_visible(v_category);
    IF v_creator_visible THEN
      UPDATE campaigns SET total_views = total_views + 1, invalid_views = invalid_views + 1
        WHERE id = p_campaign_id;
      UPDATE profiles SET total_views = total_views + 1, invalid_views = invalid_views + 1
        WHERE id = p_creator_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed', TRUE,
    'replayed', FALSE,
    'view_id', v_view_id,
    'valid', v_valid,
    'earning', v_earning,
    'reason', CASE WHEN v_valid THEN NULL ELSE v_reason END,
    'traffic_category', public.classify_view_outcome(v_status::TEXT, CASE WHEN v_valid THEN NULL ELSE v_reason END)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_view_and_credit(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN,
  NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TEXT, INTEGER, TEXT, NUMERIC
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_view_and_credit(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN,
  NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TEXT, INTEGER, TEXT, NUMERIC
) TO service_role;

COMMENT ON FUNCTION public.record_view_and_credit IS
  'Atomic view + earning transaction: validation, duplicate window, caps, view insert, ledger, counters, pending balance and referral commission all commit or roll back together.';

-- ------------------------------------------------------------------
-- 8. Referral ledger precision
-- ------------------------------------------------------------------
-- referrals.total_commission was NUMERIC(12,2) while the earnings ledger is
-- NUMERIC(12,6)/(14,6). Every sub-cent commission was silently rounded away
-- on accumulation. Widening the scale preserves existing values exactly
-- (no historical row changes) and stops the loss going forward.
ALTER TABLE public.referrals
  ALTER COLUMN total_commission TYPE NUMERIC(14, 6);

COMMENT ON COLUMN public.referrals.total_commission IS
  'Accumulated referral commission at ledger precision (6 dp). Historical values are unchanged; only future accumulation keeps fractions.';

-- ------------------------------------------------------------------
-- 9. Withdrawal account details are sensitive payment data
-- ------------------------------------------------------------------
-- The column stays in the table (existing withdrawals keep working), but no
-- browser role may read it. Creators do not need it — their own withdrawal
-- UI renders id/amount/method/status/date — and admins read it through the
-- service role after requireAdmin().
REVOKE SELECT (account_details) ON TABLE public.withdrawals FROM anon, authenticated;

COMMENT ON COLUMN public.withdrawals.account_details IS
  'Sensitive payment destination. Not selectable by anon/authenticated; server-side admin code reads it with the service role.';

-- ------------------------------------------------------------------
-- 10. Withdrawal methods must be processable by the database
-- ------------------------------------------------------------------
-- `withdrawals.method` is the `withdraw_method` enum. An admin could add a
-- row to withdrawal_method_config with any key, and it would appear in the
-- creator's method list but fail at request time with an enum cast error.
-- The config table is now constrained to the enum labels the RPC can process.
-- A CHECK constraint cannot contain a subquery, so the six labels of the
-- `withdraw_method` enum are enumerated literally. They are the exact set the
-- request_withdrawal RPC can cast, and the set is asserted in the test suite
-- against the enum definition so the two cannot drift apart.
ALTER TABLE public.withdrawal_method_config
  DROP CONSTRAINT IF EXISTS withdrawal_method_config_supported_method;
ALTER TABLE public.withdrawal_method_config
  ADD CONSTRAINT withdrawal_method_config_supported_method
  CHECK (method IN ('jazzcash', 'easypaisa', 'paypal', 'binance', 'usdt', 'bank'));

-- A method that cannot be processed must not stay enabled either.
UPDATE public.withdrawal_method_config
  SET enabled = FALSE
  WHERE method NOT IN ('jazzcash', 'easypaisa', 'paypal', 'binance', 'usdt', 'bank');

-- ------------------------------------------------------------------
-- 11. Trusted CPM country provisioning
-- ------------------------------------------------------------------
-- Signup metadata is client-controlled. Seeding cpm_country_code from it (as
-- 0017 did) let a creator pick a premium-tier country at signup and keep that
-- CPM permanently. The rules now are:
--
--   * profiles.country_code stays creator-editable DISPLAY data,
--   * cpm_country_code is only auto-seeded when the claimed country is NOT a
--     premium tier (tier_1 / tier_2). A premium claim is left NULL, which
--     falls back to the Global CPM — never to the premium rate,
--   * cpm_country_code can only be set afterwards by the trusted server
--     process below or by a super admin (0017's profiles_role_guard),
--   * signup_enabled is enforced here so the admin toggle actually works.
CREATE OR REPLACE FUNCTION public.trusted_signup_cpm_country(p_country TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_country, '') !~ '^[A-Za-z]{2}$' THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.country_tiers
      WHERE country_code = upper(p_country)
        AND active = TRUE
        AND tier IN ('tier_1', 'tier_2')
    ) THEN NULL          -- premium claim requires trusted provisioning
    ELSE upper(p_country)
  END;
$$;

COMMENT ON FUNCTION public.trusted_signup_cpm_country(TEXT) IS
  'Normalizes a claimed signup country and refuses to auto-assign premium (tier_1/tier_2) CPM countries from client metadata.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral_code TEXT;
  v_referred_by UUID;
  v_username TEXT;
  v_base_username TEXT;
  v_country TEXT;
  v_signup_enabled BOOLEAN;
BEGIN
  -- The admin "Allow New Signups" toggle is a real gate, not decoration.
  SELECT COALESCE(signup_enabled, TRUE) INTO v_signup_enabled
    FROM platform_settings WHERE id = 1;
  IF v_signup_enabled IS NOT NULL AND v_signup_enabled = FALSE THEN
    RAISE EXCEPTION 'Signups are currently disabled' USING ERRCODE = '42501';
  END IF;

  v_referral_code := lower(substring(md5(new.id::TEXT || new.email), 1, 8));
  WHILE EXISTS (SELECT 1 FROM profiles WHERE referral_code = v_referral_code) LOOP
    v_referral_code := lower(substring(md5(random()::TEXT), 1, 8));
  END LOOP;

  v_base_username := lower(regexp_replace(COALESCE(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'creator'), '[^a-z0-9_]+', '_', 'g'));
  v_base_username := left(trim(both '_' FROM v_base_username), 30);
  IF v_base_username = '' THEN v_base_username := 'creator'; END IF;
  v_username := v_base_username;
  WHILE EXISTS (SELECT 1 FROM profiles WHERE username = v_username) LOOP
    v_username := left(v_base_username, 21) || '_' || lower(substring(md5(random()::TEXT), 1, 8));
  END LOOP;

  IF new.raw_user_meta_data ->> 'referral_code' IS NOT NULL THEN
    SELECT id INTO v_referred_by FROM profiles
    WHERE referral_code = lower(new.raw_user_meta_data ->> 'referral_code')
    LIMIT 1;
  END IF;

  -- Display country: validated + normalized, still creator-owned.
  v_country := CASE WHEN COALESCE(new.raw_user_meta_data ->> 'country_code', '') ~ '^[A-Za-z]{2}$'
    THEN upper(new.raw_user_meta_data ->> 'country_code') ELSE NULL END;

  INSERT INTO public.profiles (
    id, username, full_name, email, referral_code, referred_by,
    country_code, cpm_country_code,
    status, email_verified_at
  ) VALUES (
    new.id, v_username, new.raw_user_meta_data ->> 'full_name', new.email,
    v_referral_code, v_referred_by,
    v_country,
    -- CPM country: never a premium tier straight from signup metadata.
    public.trusted_signup_cpm_country(v_country),
    CASE WHEN new.email_confirmed_at IS NULL THEN 'pending_verification'::user_status ELSE 'active'::user_status END,
    CASE WHEN new.email_confirmed_at IS NULL THEN NULL ELSE NOW() END
  );

  IF v_referred_by IS NOT NULL AND v_referred_by <> new.id THEN
    INSERT INTO public.referrals (referrer_id, referred_id) VALUES (v_referred_by, new.id)
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;
  END IF;
  RETURN new;
END;
$$;

-- Trusted provisioning: the server resolves the country from the request IP
-- (never from the browser) and calls this once, after authentication. It only
-- FILLS an empty value; it can never move an existing CPM country, so a
-- creator cannot re-provision themselves into a better tier.
CREATE OR REPLACE FUNCTION public.provision_cpm_country(
  p_user_id UUID,
  p_country TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country TEXT;
  v_current TEXT;
BEGIN
  IF COALESCE(p_country, '') !~ '^[A-Za-z]{2}$' THEN RETURN FALSE; END IF;
  v_country := upper(p_country);

  SELECT cpm_country_code INTO v_current FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_current, '') <> '' THEN RETURN FALSE; END IF;

  UPDATE profiles SET cpm_country_code = v_country WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_cpm_country(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_cpm_country(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.provision_cpm_country(UUID, TEXT) IS
  'Server-only, fill-once assignment of the trusted CPM country from a server-resolved (IP-derived) country. Never overwrites an existing value.';

-- ------------------------------------------------------------------
-- 12. Indexes that materially support the queries above
-- ------------------------------------------------------------------
-- Cap aggregates: SUM(amount) over (creator|campaign|type, created_at).
CREATE INDEX IF NOT EXISTS idx_earnings_creator_type_created
  ON public.earnings (creator_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_campaign_type_created
  ON public.earnings (campaign_id, type, created_at DESC)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_earnings_type_created
  ON public.earnings (type, created_at DESC);

-- Per-creator IP / device caps and the fraud frequency probe.
CREATE INDEX IF NOT EXISTS idx_views_creator_iphash_created
  ON public.views (creator_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_views_creator_device_created
  ON public.views (creator_id, device_fingerprint, created_at DESC)
  WHERE device_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_views_iphash_created
  ON public.views (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

-- Creator analytics reads (creator_view_analytics / campaign_* views).
CREATE INDEX IF NOT EXISTS idx_views_creator_valid_created
  ON public.views (creator_id, created_at DESC)
  WHERE status = 'valid';
CREATE INDEX IF NOT EXISTS idx_views_campaign_valid_created
  ON public.views (campaign_id, created_at DESC)
  WHERE status = 'valid';

-- Rate-limit lookups + cleanup sweep.
CREATE INDEX IF NOT EXISTS idx_rate_limit_window
  ON public.rate_limit_entries (window_start);

-- ------------------------------------------------------------------
-- 13. Operational settings that actually affect runtime
-- ------------------------------------------------------------------
-- A narrow, public projection so the application can read the operational
-- flags without exposing fraud thresholds or earning caps. `maintenance_mode`
-- and the announcement are consumed by the app; `signup_enabled` is ALSO
-- enforced in handle_new_user() above, so the toggle cannot be bypassed by
-- calling Supabase Auth directly.
CREATE OR REPLACE VIEW public.public_operational_settings
WITH (security_barrier = true) AS
SELECT
  id,
  maintenance_mode,
  signup_enabled,
  site_announcement,
  site_announcement_active
FROM public.platform_settings
WHERE id = 1;

REVOKE ALL ON public.public_operational_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_operational_settings TO anon, authenticated;

-- ============================================================
-- End migration 0021
-- ============================================================
