-- ============================================================
-- CreatorBoost Migration 0017 — Security Fixes
-- ============================================================
-- Addresses five security issues:
--   1. Country CPM manipulation: adds admin-only cpm_country_code column
--   2. (No DB change — UA fix is application-side only)
--   3. Race-safe 24h duplicate-IP RPC
--   4. (No DB change — service worker is client-side only)
--   5. Database-backed atomic rate limiter
-- ============================================================

-- ------------------------------------------------------------------
-- FIX 1: cpm_country_code — the CPM-relevant country that only
--         admins / service_role can write.  Creators keep their
--         editable country_code for display, but the earnings
--         engine reads cpm_country_code.
-- ------------------------------------------------------------------

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cpm_country_code TEXT;

-- Existing rows: seed from the current country_code so nothing changes
-- for existing creators.
UPDATE profiles SET cpm_country_code = upper(trim(country_code))
  WHERE cpm_country_code IS NULL
    AND country_code IS NOT NULL
    AND country_code ~ '^[A-Za-z]{2}$';

-- Ensure the column is restricted: only service_role and admins may
-- write cpm_country_code.  The authenticated column grant from 0008
-- covers (username, full_name, avatar_url, bio, country_code) only,
-- so cpm_country_code is already invisible to authenticated UPDATE.
-- But explicitly verify the column grant does NOT include it.
-- (No-op if the column wasn't already granted; this is a guard.)
DO $$
BEGIN
  -- Re-grant the exact allowed columns to be safe.
  REVOKE ALL ON TABLE profiles FROM authenticated;
  GRANT SELECT ON TABLE profiles TO authenticated;
  GRANT UPDATE (username, full_name, avatar_url, bio, country_code) ON TABLE profiles TO authenticated;
END $$;

-- Partial index to speed up the earnings-engine lookup.
CREATE INDEX IF NOT EXISTS idx_profiles_cpm_country_code
  ON profiles(cpm_country_code) WHERE cpm_country_code IS NOT NULL;

-- ------------------------------------------------------------------
-- FIX 3: Race-safe duplicate-IP check + view insert RPC
-- ------------------------------------------------------------------
-- Combines the 24-hour same-IP duplicate check with advisory locking
-- inside a single RPC so two concurrent requests cannot both credit
-- earnings for the same campaign + hashed IP within 24 hours.
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock_key BIGINT;
  v_duplicate BOOLEAN := FALSE;
  v_view_id UUID;
BEGIN
  -- Advisory lock per (campaign + IP hash) to serialize concurrent
  -- requests for the same campaign from the same IP.
  v_lock_key := ('x' || left(encode(
    digest(p_campaign_id::TEXT || ':' || COALESCE(p_ip_hash, ''), 'sha256'),
    'hex'), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Check for an existing valid view within the window.
  IF p_ip_hash IS NOT NULL AND p_status = 'valid' THEN
    IF EXISTS (
      SELECT 1 FROM views
      WHERE campaign_id = p_campaign_id
        AND ip_hash = p_ip_hash
        AND status = 'valid'
        AND created_at >= NOW() - (p_ip_window_hours || ' hours')::INTERVAL
    ) THEN
      v_duplicate := TRUE;
    END IF;
  END IF;

  -- If duplicate found within window, force the view to invalid.
  IF v_duplicate THEN
    p_status := 'invalid';
    p_invalid_reason := 'duplicate_ip_24h';
    p_earnings := 0;
    p_validated_at := NULL;
  END IF;

  -- Insert the view (duplicate or not — for audit trail).
  INSERT INTO views (
    campaign_id, creator_id, visitor_ip, ip_hash, country_code,
    device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
    fraud_score, status, invalid_reason, cpm_rate, earnings,
    tasks_completed, validated_at, idempotency_key
  ) VALUES (
    p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, p_country_code,
    p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
    p_is_emulator, p_fraud_score, p_status, p_invalid_reason,
    p_cpm_rate, p_earnings, p_tasks_completed, p_validated_at,
    p_idempotency_key
  ) RETURNING id INTO v_view_id;

  RETURN jsonb_build_object(
    'view_id', v_view_id,
    'duplicate_ip', v_duplicate,
    'status', p_status,
    'earnings', p_earnings
  );
END;
$$;

-- Update the handle_new_user trigger to also set cpm_country_code on signup.
-- The initial value is seeded from the signup form country. After that, only
-- admins can change it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral_code TEXT;
  v_referred_by UUID;
  v_username TEXT;
  v_base_username TEXT;
  v_country TEXT;
BEGIN
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

  -- Validate and normalize the country code for both columns.
  v_country := CASE WHEN COALESCE(new.raw_user_meta_data ->> 'country_code', '') ~ '^[A-Za-z]{2}$'
    THEN upper(new.raw_user_meta_data ->> 'country_code') ELSE NULL END;

  INSERT INTO public.profiles (
    id, username, full_name, email, referral_code, referred_by,
    country_code, cpm_country_code,
    status, email_verified_at
  ) VALUES (
    new.id, v_username, new.raw_user_meta_data ->> 'full_name', new.email,
    v_referral_code, v_referred_by,
    v_country, v_country,  -- cpm_country_code seeded from signup country
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

-- Also update the profiles_role_guard to prevent client from modifying
-- cpm_country_code even if they try via direct UPDATE (defense in depth).
CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(COALESCE(NEW.full_name, '')) > 120 OR length(COALESCE(NEW.bio, '')) > 1_000 THEN
    RAISE EXCEPTION 'Profile text is too long';
  END IF;
  IF NEW.country_code IS NOT NULL AND btrim(NEW.country_code) !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'Country code must contain two letters';
  END IF;
  -- cpm_country_code is admin/service_role only. Block any authenticated
  -- user from changing it directly.
  IF NEW.cpm_country_code IS DISTINCT FROM OLD.cpm_country_code THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND session_user NOT IN ('postgres', 'supabase_admin')
       AND NOT public.is_super_admin() THEN
      -- Silently revert to old value instead of raising, so the creator's
      -- other profile edits (name, bio, country_code) still succeed.
      NEW.cpm_country_code := OLD.cpm_country_code;
    END IF;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only a super admin can change user roles';
    END IF;
    IF auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Only service_role may call this RPC.
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
-- FIX 5: Database-backed atomic rate limiter
-- ------------------------------------------------------------------
-- Each call atomically increments a counter for a (key, window) pair
-- and returns whether the caller is still within the limit.
-- The table doubles as the store; a cleanup function prunes old rows.
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- RLS: nobody selects/reads from this table through PostgREST.
ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON rate_limit_entries FOR ALL
  USING (FALSE) WITH CHECK (FALSE);

-- The RPC is SECURITY DEFINER so it bypasses RLS internally.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  -- Round current time down to the window boundary.
  v_window_start := to_timestamp(
    floor(extract(EPOCH FROM NOW()) / p_window_seconds) * p_window_seconds
  );

  -- Upsert: increment or create the counter row.
  INSERT INTO rate_limit_entries (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limit_entries.count + 1
  RETURNING count INTO v_current_count;

  -- Return TRUE if within limit, FALSE if over.
  RETURN v_current_count <= p_limit;
END;
$$;

-- Cleanup: remove expired rate limit windows (called periodically).
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limit_entries
  WHERE window_start < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Only service_role may call these RPCs.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;

-- ============================================================
-- End migration 0017
-- ============================================================
