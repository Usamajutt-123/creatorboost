-- ============================================================
-- CreatorBoost Migration 0019 — Country CPM + earnings repair
-- ------------------------------------------------------------
-- This migration is intentionally additive. Migrations 0014-0018 are
-- already applied and are not edited.
--
-- 1. Reassert the country_tiers RLS/table privilege boundary:
--      - anon/authenticated may read active rates only
--      - authenticated admins may SELECT/INSERT/UPDATE/DELETE
--      - creators and anonymous callers cannot write rates
-- 2. Repair the migration-0017 view-accounting RPC. Its original body
--    inserted a TEXT[] directly into the JSONB tasks_completed column and
--    inserted TEXT directly into the view_status enum. Both are valid
--    application inputs but fail at the PostgreSQL assignment boundary,
--    which left valid views without an inserted view/earning.
-- 3. Keep the existing campaign + hashed-IP + 24-hour atomic duplicate
--    protection unchanged.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. country_tiers permissions
-- ------------------------------------------------------------------
ALTER TABLE public.country_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_country_tiers" ON public.country_tiers;
CREATE POLICY "public_read_country_tiers" ON public.country_tiers
  FOR SELECT TO anon, authenticated
  USING (active = TRUE);

DROP POLICY IF EXISTS "admins_manage_country_tiers" ON public.country_tiers;
CREATE POLICY "admins_manage_country_tiers" ON public.country_tiers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Table privileges are necessary but not sufficient: RLS above remains the
-- authorization boundary. The service-role server actions continue to derive
-- the acting admin from the verified session before using their server-only
-- client.
REVOKE ALL ON TABLE public.country_tiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.country_tiers TO authenticated;
GRANT SELECT ON TABLE public.country_tiers TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.country_tiers_id_seq TO authenticated;

-- Keep the CPM country column out of creator profile writes even if a future
-- grant is added broadly. Migration 0017's trigger remains the defense in
-- depth check and continues to provision this value only at signup/admin time.
REVOKE UPDATE (cpm_country_code) ON TABLE public.profiles FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Corrected atomic view insert RPC
-- ------------------------------------------------------------------
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
BEGIN
  v_country_code := CASE
    WHEN COALESCE(p_country_code, '') ~ '^[A-Za-z]{2}$'
      THEN upper(p_country_code)::CHAR(2)
    ELSE NULL
  END;

  -- The application only records payable/non-payable outcomes. Normalize the
  -- text boundary to the database enum instead of relying on an implicit cast.
  IF p_status = 'valid' THEN
    v_status := 'valid'::view_status;
  ELSE
    v_status := 'invalid'::view_status;
    v_earnings := 0;
    v_validated_at := NULL;
  END IF;

  -- Preserve migration 0017's atomic lock: campaign + hashed IP is the key,
  -- so the same IP may still earn once per campaign and once per 24-hour
  -- window, while a different campaign remains eligible.
  v_lock_key := ('x' || left(encode(
    digest(p_campaign_id::TEXT || ':' || COALESCE(p_ip_hash, ''), 'sha256'),
    'hex'), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);

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
    -- views.tasks_completed is JSONB; the old TEXT[] -> JSONB assignment was
    -- the production accounting failure. Convert explicitly at the boundary.
    to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
    v_validated_at, p_idempotency_key
  )
  RETURNING id INTO v_view_id;

  RETURN jsonb_build_object(
    'view_id', v_view_id,
    'duplicate_ip', v_duplicate,
    'status', v_status::TEXT,
    'earnings', v_earnings
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

-- ============================================================
-- End migration 0019
-- ============================================================
