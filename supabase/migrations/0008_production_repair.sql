-- ============================================================
-- CreatorBoost Migration 0008 — Production Repair
-- ------------------------------------------------------------
-- Closes authorization/ledger gaps found during the production audit:
--   * public campaign reads no longer expose destination_url
--   * task URLs are validated for every task type
--   * balances retain six decimal places (per-view earnings are fractional)
--   * one view can be accounted/credited exactly once
--   * referral credit and earnings release are race-safe
--   * public/client table privileges are column-safe, not just RLS-safe
--   * storage, referral clicks, audit logs and withdrawal method config have RLS
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Fractional ledger precision
-- ------------------------------------------------------------------
-- A typical $5 CPM view is $0.005. NUMERIC(12,2) rounded each individual
-- view to cents and caused balance/counter drift. Keep six decimals until a
-- creator requests a cents-based withdrawal.
ALTER TABLE profiles
  ALTER COLUMN total_earnings TYPE NUMERIC(14,6) USING total_earnings::NUMERIC(14,6),
  ALTER COLUMN pending_balance TYPE NUMERIC(14,6) USING pending_balance::NUMERIC(14,6),
  ALTER COLUMN available_balance TYPE NUMERIC(14,6) USING available_balance::NUMERIC(14,6),
  ALTER COLUMN referral_earnings TYPE NUMERIC(14,6) USING referral_earnings::NUMERIC(14,6),
  ALTER COLUMN pending_earnings TYPE NUMERIC(14,6) USING pending_earnings::NUMERIC(14,6),
  ALTER COLUMN withdrawal_hold TYPE NUMERIC(14,6) USING withdrawal_hold::NUMERIC(14,6);
  DROP POLICY IF EXISTS creators_insert_own_campaigns ON campaigns;
DROP POLICY IF EXISTS creators_update_own_campaigns ON campaigns;
ALTER TABLE campaigns
  ALTER COLUMN total_earnings TYPE NUMERIC(14,6) USING total_earnings::NUMERIC(14,6);

ALTER TABLE views ADD COLUMN IF NOT EXISTS accounted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_views_unaccounted ON views(id) WHERE accounted_at IS NULL;

-- Exactly one creator earning may be produced for a view. Referral bonuses
-- have their own partial unique index from 0007, so both ledger rows remain
-- possible for a referred creator's valid view.
CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_view_earning
  ON earnings(view_id) WHERE type = 'view_earning' AND view_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. Database constraints for operator-controlled financial settings
-- ------------------------------------------------------------------
ALTER TABLE country_tiers DROP CONSTRAINT IF EXISTS country_tiers_cpm_range;
ALTER TABLE country_tiers ADD CONSTRAINT country_tiers_cpm_range
  CHECK (cpm_min >= 0 AND cpm_max >= cpm_min AND cpm_default >= cpm_min AND cpm_default <= cpm_max AND payout_percentage BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE creator_levels DROP CONSTRAINT IF EXISTS creator_levels_valid_values;
ALTER TABLE creator_levels ADD CONSTRAINT creator_levels_valid_values
  CHECK (min_views >= 0 AND cpm_multiplier >= 0) NOT VALID;
ALTER TABLE withdrawal_method_config DROP CONSTRAINT IF EXISTS withdrawal_method_config_valid_values;
ALTER TABLE withdrawal_method_config ADD CONSTRAINT withdrawal_method_config_valid_values
  CHECK (min_amount > 0 AND max_amount >= min_amount AND fee_percentage BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_valid_caps;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_valid_caps
  CHECK (
    min_withdrawal >= 0
    AND referral_percentage BETWEEN 0 AND 100
    AND max_earnings_per_view >= 0
    AND max_views_per_device_per_day >= 0
    AND max_views_per_ip_per_day >= 0
    AND creator_daily_earning_cap >= 0
    AND campaign_daily_earning_cap >= 0
    AND platform_daily_earning_cap >= 0
    AND earning_holding_hours >= 0
  ) NOT VALID;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_no_self_referral;
ALTER TABLE profiles ADD CONSTRAINT profiles_no_self_referral
  CHECK (referred_by IS NULL OR referred_by <> id) NOT VALID;
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_no_self_referral;
ALTER TABLE referrals ADD CONSTRAINT referrals_no_self_referral
  CHECK (referrer_id <> referred_id) NOT VALID;

-- ------------------------------------------------------------------
-- 3. Campaign data validation (server action + DB defence in depth)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_campaign_payload()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task TEXT;
  v_metadata JSONB;
  v_allowed TEXT[] := ARRAY[
    'youtube_subscribe','youtube_like','youtube_comment','watch_video',
    'telegram_join','discord_join','instagram_follow','tiktok_follow',
    'facebook_follow','twitter_follow','website_visit','file_download','custom'
  ];
BEGIN
  -- Counter-only writes originate from the protected accounting RPC. Do not
  -- reject a legacy campaign while its immutable financial counters change.
  IF TG_OP = 'UPDATE'
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.slug IS NOT DISTINCT FROM OLD.slug
    AND NEW.description IS NOT DISTINCT FROM OLD.description
    AND NEW.category IS NOT DISTINCT FROM OLD.category
    AND NEW.destination_url IS NOT DISTINCT FROM OLD.destination_url
    AND NEW.thumbnail_url IS NOT DISTINCT FROM OLD.thumbnail_url
    AND NEW.banner_url IS NOT DISTINCT FROM OLD.banner_url
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.tasks IS NOT DISTINCT FROM OLD.tasks
    AND NEW.task_metadata IS NOT DISTINCT FROM OLD.task_metadata
    AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
  THEN
    RETURN NEW;
  END IF;

  NEW.name := btrim(NEW.name);
  IF length(NEW.name) = 0 OR length(NEW.name) > 150 THEN
    RAISE EXCEPTION 'Campaign name must be between 1 and 150 characters';
  END IF;
  IF NEW.description IS NOT NULL AND length(NEW.description) > 2000 THEN
    RAISE EXCEPTION 'Campaign description is too long';
  END IF;
  IF NEW.slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR length(NEW.slug) > 100 THEN
    RAISE EXCEPTION 'Campaign slug is invalid';
  END IF;
  IF NEW.destination_url IS NULL THEN
    RAISE EXCEPTION 'Campaign destination URL is required';
  END IF;
  IF NEW.destination_url <> '' AND NEW.destination_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Campaign destination must be an http(s) URL';
  END IF;
  IF NEW.status = 'active' AND NEW.destination_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'An active campaign needs an http(s) destination URL';
  END IF;
  IF NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Thumbnail URL must be an http(s) URL';
  END IF;
  IF NEW.banner_url IS NOT NULL AND NEW.banner_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Banner URL must be an http(s) URL';
  END IF;

  IF NEW.status = 'active' AND (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NOW()) THEN
    RAISE EXCEPTION 'Active campaign expiry must be in the future';
  END IF;
  IF NEW.status = 'active' AND (NEW.tasks IS NULL OR cardinality(NEW.tasks) = 0) THEN
    RAISE EXCEPTION 'An active campaign needs at least one task';
  END IF;
  IF cardinality(NEW.tasks) > cardinality(v_allowed) THEN
    RAISE EXCEPTION 'Too many campaign tasks';
  END IF;
  IF NEW.tasks IS NOT NULL AND cardinality(NEW.tasks) <> (SELECT COUNT(DISTINCT task) FROM unnest(NEW.tasks) AS task) THEN
    RAISE EXCEPTION 'Campaign task types must be unique';
  END IF;
  IF jsonb_typeof(NEW.task_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Campaign task metadata must be an object';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.task_metadata) AS key WHERE NOT (key = ANY(COALESCE(NEW.tasks, ARRAY[]::TEXT[])))) THEN
    RAISE EXCEPTION 'Task metadata contains an unknown task';
  END IF;

  FOREACH v_task IN ARRAY COALESCE(NEW.tasks, ARRAY[]::TEXT[]) LOOP
    IF NOT (v_task = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Campaign contains an unsupported task type';
    END IF;
    v_metadata := NEW.task_metadata -> v_task;
    IF jsonb_typeof(v_metadata) <> 'object' OR COALESCE(v_metadata ->> 'url', '') !~* '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'Every campaign task needs a valid http(s) URL';
    END IF;
    IF v_task = 'custom' AND (length(btrim(COALESCE(v_metadata ->> 'title', ''))) = 0 OR length(v_metadata ->> 'title') > 120) THEN
      RAISE EXCEPTION 'Custom task needs a title up to 120 characters';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_payload_validation ON campaigns;
CREATE TRIGGER trg_campaign_payload_validation
  BEFORE INSERT OR UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_payload();

-- ------------------------------------------------------------------
-- 4. Safe public campaign projection; destination_url remains private
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS public_read_active_campaigns ON campaigns;
DROP POLICY IF EXISTS creators_read_own_campaigns ON campaigns;
CREATE POLICY creators_read_own_campaigns ON campaigns FOR SELECT TO authenticated
  USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS creators_insert_own_campaigns ON campaigns;
CREATE POLICY creators_insert_own_campaigns ON campaigns FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = creator_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status = 'active')
    AND total_views = 0 AND valid_views = 0 AND invalid_views = 0 AND total_earnings = 0
  );

DROP POLICY IF EXISTS creators_update_own_campaigns ON campaigns;
CREATE POLICY creators_update_own_campaigns ON campaigns FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (
    auth.uid() = creator_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status = 'active')
  );

CREATE OR REPLACE VIEW public.public_campaigns
WITH (security_barrier = true) AS
SELECT
  id, slug, name, description, category, thumbnail_url, banner_url,
  tasks, task_metadata, created_at, updated_at
FROM public.campaigns
WHERE status = 'active'
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > NOW());

REVOKE ALL ON public.public_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_campaigns TO anon, authenticated;

-- Older summary views could otherwise inherit a definer and expose all data.
REVOKE ALL ON public.daily_earnings_summary, public.country_traffic_summary, public.platform_stats FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- 5. Enable RLS everywhere and use table/column grants as a second wall
-- ------------------------------------------------------------------
ALTER TABLE withdrawal_method_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_insert_referral_clicks ON referral_clicks;
DROP POLICY IF EXISTS public_insert_devices ON device_fingerprints;

-- Remove API credentials from every public ad_networks row. Admin reads go
-- through server actions with the service role after an explicit role check.
DROP POLICY IF EXISTS public_read_ad_networks ON ad_networks;

-- Public platform configuration is intentionally a narrow projection. Fraud
-- thresholds and earning caps are not exposed to traffic sources.
DROP POLICY IF EXISTS public_read_platform_settings ON platform_settings;
CREATE OR REPLACE VIEW public.public_platform_settings
WITH (security_barrier = true) AS
SELECT id, site_name, site_tagline, support_email, min_withdrawal, withdrawal_methods
FROM public.platform_settings WHERE id = 1;
REVOKE ALL ON public.public_platform_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_platform_settings TO anon, authenticated;

-- Ticket users may create/read only their own ticket; staff replies are made
-- by protected server actions. An anonymous ticket is scoped to NULL rows and
-- does not grant a browser access to any other ticket.
DROP POLICY IF EXISTS users_manage_own_tickets ON support_tickets;
DROP POLICY IF EXISTS users_read_own_tickets ON support_tickets;
DROP POLICY IF EXISTS users_insert_own_tickets ON support_tickets;
CREATE POLICY users_read_own_tickets ON support_tickets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY users_insert_own_tickets ON support_tickets FOR INSERT TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND user_id IS NULL)
  );

DROP POLICY IF EXISTS users_read_own_ticket_messages ON ticket_messages;
DROP POLICY IF EXISTS users_insert_own_ticket_messages ON ticket_messages;
CREATE POLICY users_read_own_ticket_messages ON ticket_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()));
CREATE POLICY users_insert_own_ticket_messages ON ticket_messages FOR INSERT TO anon, authenticated
  WITH CHECK (
    is_admin = FALSE
    AND (
      (auth.uid() IS NOT NULL AND user_id = auth.uid() AND EXISTS (
        SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()))
      OR
      (auth.uid() IS NULL AND user_id IS NULL AND EXISTS (
        SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id IS NULL))
    )
  );

-- Admin browser sessions should not directly mutate financial state. Their
-- server actions use service_role after requireAdmin() and audit every write.
DROP POLICY IF EXISTS admins_manage_withdrawals ON withdrawals;

REVOKE ALL ON TABLE profiles FROM anon, authenticated;
GRANT SELECT ON TABLE profiles TO authenticated;
GRANT UPDATE (username, full_name, avatar_url, bio, country_code) ON TABLE profiles TO authenticated;

REVOKE ALL ON TABLE campaigns FROM anon, authenticated;
GRANT SELECT ON TABLE campaigns TO authenticated;
GRANT INSERT (creator_id, name, slug, description, category, destination_url, thumbnail_url, banner_url, status, tasks, expires_at, deleted_at, task_metadata) ON TABLE campaigns TO authenticated;
GRANT UPDATE (name, description, category, destination_url, thumbnail_url, banner_url, status, tasks, expires_at, deleted_at, task_metadata) ON TABLE campaigns TO authenticated;

REVOKE ALL ON TABLE views FROM anon, authenticated;
GRANT SELECT ON TABLE views TO authenticated;
REVOKE ALL ON TABLE earnings FROM anon, authenticated;
GRANT SELECT ON TABLE earnings TO authenticated;
REVOKE ALL ON TABLE withdrawals FROM anon, authenticated;
GRANT SELECT ON TABLE withdrawals TO authenticated;
REVOKE ALL ON TABLE referrals FROM anon, authenticated;
GRANT SELECT ON TABLE referrals TO authenticated;
REVOKE ALL ON TABLE referral_clicks FROM anon, authenticated;
REVOKE ALL ON TABLE notifications FROM anon, authenticated;
GRANT SELECT ON TABLE notifications TO authenticated;
GRANT UPDATE (read) ON TABLE notifications TO authenticated;
REVOKE ALL ON TABLE support_tickets FROM anon, authenticated;
GRANT SELECT ON TABLE support_tickets TO authenticated;
GRANT INSERT (user_id, subject, category) ON TABLE support_tickets TO anon, authenticated;
REVOKE ALL ON TABLE ticket_messages FROM anon, authenticated;
GRANT SELECT ON TABLE ticket_messages TO authenticated;
GRANT INSERT (ticket_id, user_id, message) ON TABLE ticket_messages TO anon, authenticated;
REVOKE ALL ON TABLE audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE device_fingerprints FROM anon, authenticated;
REVOKE ALL ON TABLE withdrawal_method_config FROM anon, authenticated;
GRANT SELECT ON TABLE withdrawal_method_config TO anon, authenticated;
REVOKE ALL ON TABLE ad_networks FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 6. Storage bucket used by campaign create/edit forms
-- ------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('campaigns', 'campaigns', TRUE, 5242880, ARRAY['image/png','image/jpeg','image/webp','image/avif']::TEXT[])
ON CONFLICT (id) DO UPDATE SET public = TRUE, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/avif']::TEXT[];

DROP POLICY IF EXISTS campaign_media_public_read ON storage.objects;
DROP POLICY IF EXISTS campaign_media_owner_insert ON storage.objects;
DROP POLICY IF EXISTS campaign_media_owner_update ON storage.objects;
DROP POLICY IF EXISTS campaign_media_owner_delete ON storage.objects;
CREATE POLICY campaign_media_public_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'campaigns');
CREATE POLICY campaign_media_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaigns' AND (storage.foldername(name))[1] = auth.uid()::TEXT);
CREATE POLICY campaign_media_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'campaigns' AND (storage.foldername(name))[1] = auth.uid()::TEXT)
  WITH CHECK (bucket_id = 'campaigns' AND (storage.foldername(name))[1] = auth.uid()::TEXT);
CREATE POLICY campaign_media_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campaigns' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

-- ------------------------------------------------------------------
-- 7. Auth profile creation/verification repair
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral_code TEXT;
  v_referred_by UUID;
  v_username TEXT;
  v_base_username TEXT;
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

  INSERT INTO public.profiles (
    id, username, full_name, email, referral_code, referred_by, country_code,
    status, email_verified_at
  ) VALUES (
    new.id, v_username, new.raw_user_meta_data ->> 'full_name', new.email,
    v_referral_code, v_referred_by,
    CASE WHEN COALESCE(new.raw_user_meta_data ->> 'country_code', '') ~ '^[A-Za-z]{2}$'
      THEN upper(new.raw_user_meta_data ->> 'country_code') ELSE NULL END,
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

-- OAuth providers commonly create an already-confirmed auth user, which does
-- not fire the UPDATE-only confirmation trigger from 0006. Repair old pending
-- profiles and preserve suspension/ban decisions.
UPDATE profiles p
SET status = 'active', email_verified_at = COALESCE(p.email_verified_at, u.email_confirmed_at, NOW())
FROM auth.users u
WHERE p.id = u.id
  AND p.status = 'pending_verification'
  AND u.email_confirmed_at IS NOT NULL;

-- Role and balance changes are now protected by column grants. This trigger
-- continues to protect roles while allowing SECURITY DEFINER money RPCs and
-- service-role server actions to perform their bounded updates.
CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(COALESCE(NEW.full_name, '')) > 120 OR length(COALESCE(NEW.bio, '')) > 1_000 THEN
    RAISE EXCEPTION 'Profile text is too long';
  END IF;
  IF NEW.country_code IS NOT NULL AND btrim(NEW.country_code) !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'Country code must contain two letters';
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

-- ------------------------------------------------------------------
-- 8. Race-safe financial RPCs
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT);
CREATE FUNCTION public.credit_view_earning(
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

  UPDATE views SET status = 'invalid', earnings = 0, invalid_reason = COALESCE(v_reason, 'invalid_traffic'), accounted_at = NOW(), validated_at = COALESCE(validated_at, NOW()) WHERE id = p_view_id;
  UPDATE campaigns SET total_views = total_views + 1, invalid_views = invalid_views + 1 WHERE id = p_campaign_id;
  UPDATE profiles SET total_views = total_views + 1, invalid_views = invalid_views + 1 WHERE id = p_creator_id;
  RETURN jsonb_build_object('processed', TRUE, 'valid', FALSE, 'reason', COALESCE(v_reason, 'invalid_traffic'));
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
    RETURNING p.id
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
END;
$$;

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

  -- The profile row lock serializes withdrawal attempts for this user. The
  -- pending check happens after it, preventing two simultaneous requests.
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
  RETURN jsonb_build_object('success', TRUE, 'withdrawal_id', v_withdrawal_id, 'fee', v_fee, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_withdrawal_id UUID, p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_amount NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Admin privileges required'; END IF;
  SELECT user_id, amount INTO v_user_id, v_amount FROM withdrawals WHERE id = p_withdrawal_id AND status = 'pending' FOR UPDATE;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Withdrawal is not pending'; END IF;
  IF v_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot process your own withdrawal'; END IF;
  UPDATE withdrawals SET status = 'approved', processed_at = NOW(), processed_by = auth.uid() WHERE id = p_withdrawal_id;
  INSERT INTO notifications (user_id, type, title, message) VALUES (v_user_id, 'withdrawal', 'Withdrawal approved', 'Your withdrawal of $' || v_amount || ' has been approved and will be processed shortly.');
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_tx_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_total NUMERIC; v_amount NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Admin privileges required'; END IF;
  IF length(btrim(COALESCE(p_tx_id, ''))) = 0 OR length(p_tx_id) > 200 THEN RAISE EXCEPTION 'A valid transaction ID is required'; END IF;
  SELECT user_id, amount + fee, amount INTO v_user_id, v_total, v_amount FROM withdrawals WHERE id = p_withdrawal_id AND status = 'approved' FOR UPDATE;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Withdrawal is not approved'; END IF;
  IF v_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot process your own withdrawal'; END IF;
  UPDATE withdrawals SET status = 'paid', transaction_id = btrim(p_tx_id), processed_at = NOW(), processed_by = auth.uid() WHERE id = p_withdrawal_id;
  UPDATE profiles SET withdrawal_hold = GREATEST(withdrawal_hold - v_total, 0) WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message) VALUES (v_user_id, 'withdrawal', 'Withdrawal paid', 'Your withdrawal of $' || v_amount || ' has been sent. TX: ' || btrim(p_tx_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal(p_withdrawal_id UUID, p_admin_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID; v_total NUMERIC; v_amount NUMERIC; v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Admin privileges required'; END IF;
  IF length(v_reason) = 0 OR length(v_reason) > 500 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT user_id, amount + fee, amount INTO v_user_id, v_total, v_amount FROM withdrawals WHERE id = p_withdrawal_id AND status IN ('pending', 'approved') FOR UPDATE;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Withdrawal cannot be rejected'; END IF;
  IF v_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot process your own withdrawal'; END IF;
  UPDATE withdrawals SET status = 'rejected', rejection_reason = v_reason, processed_at = NOW(), processed_by = auth.uid() WHERE id = p_withdrawal_id;
  UPDATE profiles SET withdrawal_hold = GREATEST(withdrawal_hold - v_total, 0), available_balance = available_balance + v_total WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message) VALUES (v_user_id, 'withdrawal', 'Withdrawal rejected', 'Your withdrawal of $' || v_amount || ' was rejected. Reason: ' || v_reason);
END;
$$;

-- Function execution defaults to PUBLIC in PostgreSQL. Explicitly revoke it
-- before granting only the calls that an authenticated browser may make.
REVOKE EXECUTE ON FUNCTION public.increment_view_counters(UUID, UUID, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_matured_earnings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_pending_earnings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_pending_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_creator_level(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_action(TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_withdrawal(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_withdrawal(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_withdrawal(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_view_earning(UUID, UUID, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_matured_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_pending_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_referral_commission(UUID, NUMERIC, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_action(TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT, UUID) TO service_role;

-- ============================================================
-- End migration
-- ============================================================
