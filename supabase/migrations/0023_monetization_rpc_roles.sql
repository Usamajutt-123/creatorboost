-- ============================================================
-- CreatorBoost Migration 0023 — Monetization RPC role fix
-- ------------------------------------------------------------
-- 0022's admin analytics RPCs (and the step reorder RPC) guarded
-- themselves with `IF NOT public.is_admin() THEN RAISE`. That gate
-- reads auth.uid(), which is NULL for the service-role client the
-- admin panel uses — so every admin RPC call raised "Admin privileges
-- required" and the monetization pages rendered empty.
--
-- FIX (same model as record_view_and_credit):
--   * the SQL-level gate is removed,
--   * EXECUTE is revoked from PUBLIC/anon/authenticated and granted
--     to service_role ONLY, so PostgREST blocks browser roles at the
--     GRANT boundary,
--   * the application layer keeps requireAdmin() (active admin check)
--     in front of every call — defense in depth, no behavior change
--     for authorized admins.
--
-- Function bodies are otherwise identical to 0022 (same aggregates,
-- same preview/test-mode exclusions). Additive: safe whether or not
-- 0022 has already been applied.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Overview
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH bounds AS (
    SELECT NOW() AS now_ts,
           date_trunc('day', NOW()) AS today_start
  ),
  aggregates AS (
    SELECT
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type IN ('step_complete') AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_steps_completed,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_flow_starts_dup
    FROM public.flow_events e, bounds b
  ),
  payouts AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0) AS today_payout,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)  AS d7_payout,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) AS d30_payout
    FROM public.earnings
    WHERE type = 'view_earning'
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ),
  gross AS (
    SELECT
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date = CURRENT_DATE), 0) AS today_gross,
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS d7_gross,
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date >= CURRENT_DATE - INTERVAL '29 days'), 0) AS d30_gross
    FROM public.monetization_revenue
  )
  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'flowStarts', COALESCE(a.today_flow_starts, 0),
      'destinations', COALESCE(a.today_destinations, 0),
      'qualified', COALESCE(a.today_qualified, 0),
      'creatorPayout', COALESCE(p.today_payout, 0),
      'grossRevenue', COALESCE(g.today_gross, 0)
    ),
    'd7', jsonb_build_object(
      'flowStarts', COALESCE(a.d7_flow_starts, 0),
      'destinations', COALESCE(a.d7_destinations, 0),
      'qualified', COALESCE(a.d7_qualified, 0),
      'creatorPayout', COALESCE(p.d7_payout, 0),
      'grossRevenue', COALESCE(g.d7_gross, 0)
    ),
    'd30', jsonb_build_object(
      'flowStarts', COALESCE(a.d30_flow_starts, 0),
      'destinations', COALESCE(a.d30_destinations, 0),
      'qualified', COALESCE(a.d30_qualified, 0),
      'creatorPayout', COALESCE(p.d30_payout, 0),
      'grossRevenue', COALESCE(g.d30_gross, 0),
      'stepsCompleted', COALESCE(a.d30_steps_completed, 0)
    ),
    'completionRate', CASE WHEN COALESCE(a.d30_flow_starts_dup, 0) > 0
      THEN ROUND(COALESCE(a.d30_destinations, 0)::NUMERIC / a.d30_flow_starts_dup * 100, 2) ELSE 0 END
  ) INTO v_result
  FROM aggregates a, payouts p, gross g;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_overview() TO service_role;

-- ------------------------------------------------------------
-- 2. Funnel
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_funnel(p_days INTEGER DEFAULT 30)
RETURNS TABLE (stage TEXT, count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  RETURN QUERY
  WITH stage_order (stage, ord) AS (
    VALUES ('task_start', 1), ('task_complete', 2), ('unlock', 3),
           ('flow_start', 4), ('step_start', 5), ('step_complete', 6),
           ('destination_visit', 7), ('qualified', 8)
  )
  SELECT s.stage, COALESCE(t.c, 0)::BIGINT
  FROM stage_order s
  LEFT JOIN (
    SELECT event_type AS stage, COUNT(*) AS c
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY event_type
    UNION ALL
    SELECT 'qualified', COUNT(*)
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND qualified AND NOT preview_mode
      AND NOT test_mode
  ) t ON t.stage = s.stage
  ORDER BY s.ord;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_funnel(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_funnel(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 3. Step-by-step dropoff
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_step_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE (step INTEGER, started BIGINT, completed BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(st.step, sc.step, 0)::INTEGER AS step,
    COALESCE(st.started, 0)::BIGINT,
    COALESCE(sc.completed, 0)::BIGINT
  FROM (
    SELECT step, COUNT(*) AS started
    FROM public.flow_events
    WHERE event_type = 'step_start'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY step
  ) st
  FULL OUTER JOIN (
    SELECT step, COUNT(*) AS completed
    FROM public.flow_events
    WHERE event_type = 'step_complete'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY step
  ) sc ON st.step = sc.step
  ORDER BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_step_stats(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_step_stats(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 4. Daily trend
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_daily(p_days INTEGER DEFAULT 14)
RETURNS TABLE (
  day DATE, flow_starts BIGINT, destinations BIGINT, qualified BIGINT,
  creator_payout NUMERIC, gross_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
BEGIN
  RETURN QUERY
  SELECT
    d.day,
    COALESCE(e.flow_starts, 0)::BIGINT,
    COALESCE(e.destinations, 0)::BIGINT,
    COALESCE(e.qualified, 0)::BIGINT,
    COALESCE(p.payout, 0)::NUMERIC,
    COALESCE(r.gross, 0)::NUMERIC
  FROM (
    SELECT generate_series(
      (CURRENT_DATE - (v_days - 1))::DATE, CURRENT_DATE::DATE, INTERVAL '1 day'
    )::DATE AS day
  ) d
  LEFT JOIN (
    SELECT date_trunc('day', created_at)::DATE AS day,
           COUNT(*) FILTER (WHERE event_type = 'flow_start') AS flow_starts,
           COUNT(*) FILTER (WHERE event_type = 'destination_visit') AS destinations,
           COUNT(*) FILTER (WHERE qualified) AS qualified
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL AND NOT preview_mode
      AND NOT test_mode
    GROUP BY 1
  ) e ON e.day = d.day
  LEFT JOIN (
    SELECT date_trunc('day', created_at)::DATE AS day, COALESCE(SUM(amount), 0) AS payout
    FROM public.earnings
    WHERE type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
    GROUP BY 1
  ) p ON p.day = d.day
  LEFT JOIN (
    SELECT revenue_date AS day, COALESCE(SUM(revenue), 0) AS gross
    FROM public.monetization_revenue
    WHERE revenue_date >= CURRENT_DATE - (v_days - 1)
    GROUP BY 1
  ) r ON r.day = d.day
  ORDER BY d.day;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_daily(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_daily(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 5. Countries
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_countries(
  p_days INTEGER DEFAULT 7, p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (country_code TEXT, events BIGINT, qualified BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 7), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(country_code, 'XX')::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE qualified)::BIGINT
  FROM public.flow_events
  WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT preview_mode
    AND NOT test_mode
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_countries(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_countries(INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 6. Devices
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_devices(p_days INTEGER DEFAULT 7)
RETURNS TABLE (device TEXT, events BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 7), 1), 365);
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(device_category, 'unknown')::TEXT,
    COUNT(*)::BIGINT
  FROM public.flow_events
  WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT preview_mode
    AND NOT test_mode
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_devices(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_devices(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 7. Top creators
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_top_creators(
  p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (creator_id UUID, username TEXT, qualified BIGINT, payout NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
BEGIN
  RETURN QUERY
  SELECT
    e.creator_id,
    COALESCE(p.username, 'user')::TEXT,
    COUNT(*) FILTER (WHERE e.qualified)::BIGINT AS qualified,
    COALESCE(SUM(earn.amount), 0)::NUMERIC AS payout
  FROM public.flow_events e
  LEFT JOIN public.profiles p ON p.id = e.creator_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM public.earnings
    WHERE creator_id = e.creator_id
      AND type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ) earn ON TRUE
  WHERE e.created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT e.preview_mode
    AND NOT e.test_mode
  GROUP BY e.creator_id, p.username
  ORDER BY qualified DESC, payout DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_top_creators(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_top_creators(INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 8. Top campaigns
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_monetization_top_campaigns(
  p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (campaign_id UUID, campaign_name TEXT, slug TEXT, qualified BIGINT, payout NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
BEGIN
  RETURN QUERY
  SELECT
    e.campaign_id,
    COALESCE(c.name, 'Campaign')::TEXT,
    COALESCE(c.slug, '')::TEXT,
    COUNT(*) FILTER (WHERE e.qualified)::BIGINT AS qualified,
    COALESCE(SUM(earn.amount), 0)::NUMERIC AS payout
  FROM public.flow_events e
  LEFT JOIN public.campaigns c ON c.id = e.campaign_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM public.earnings
    WHERE campaign_id = e.campaign_id
      AND type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ) earn ON TRUE
  WHERE e.created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT e.preview_mode
    AND NOT e.test_mode
  GROUP BY e.campaign_id, c.name, c.slug
  ORDER BY qualified DESC, payout DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_top_campaigns(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monetization_top_campaigns(INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 9. Step reorder (transactional, service-role only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_monetization_steps(p_ids INTEGER[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id INTEGER;
  v_pos INTEGER;
  v_total INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.monetization_steps;
  IF v_total = 0 OR COALESCE(array_length(p_ids, 1), 0) <> v_total THEN
    RAISE EXCEPTION 'Reorder list must contain every step exactly once'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (SELECT COUNT(DISTINCT x) FROM unnest(p_ids) AS x) <> v_total THEN
    RAISE EXCEPTION 'Reorder list contains duplicates' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) AS x
    WHERE NOT EXISTS (SELECT 1 FROM public.monetization_steps s WHERE s.id = x)
  ) THEN
    RAISE EXCEPTION 'Reorder list contains unknown steps' USING ERRCODE = 'check_violation';
  END IF;

  -- Free the occupied positions first (negatives cannot collide with the
  -- 1..12 CHECK constraint range), then assign the final order.
  v_pos := 0;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_pos := v_pos - 1;
    UPDATE public.monetization_steps SET position = v_pos WHERE id = v_id;
  END LOOP;

  v_pos := 0;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_pos := v_pos + 1;
    UPDATE public.monetization_steps SET position = v_pos WHERE id = v_id;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'count', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_monetization_steps(INTEGER[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_monetization_steps(INTEGER[]) TO service_role;

COMMENT ON FUNCTION public.admin_monetization_overview() IS
  'Admin monetization overview. EXECUTE is granted to service_role only (browser roles are blocked at the GRANT boundary); the application enforces the active-admin check before calling.';

-- ============================================================
-- End migration 0023
-- ============================================================