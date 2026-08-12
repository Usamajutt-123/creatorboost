-- ============================================================
-- CreatorBoost Migration 0011 — Admin announcement notifications
-- ------------------------------------------------------------
-- Reuses the existing announcements history table and notifications
-- table. Announcement delivery is performed atomically by a protected
-- SECURITY DEFINER function so the browser never receives service-role
-- credentials and creators cannot choose notification recipients.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Extend the existing announcements table for delivery history.
--    Existing public/site announcements remain compatible. In-app
--    announcements created below use active = FALSE so a targeted
--    announcement is not exposed through the legacy public policy.
-- ------------------------------------------------------------------
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all_creators',
  ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Constraints are intentionally additive. The existing `type` column is
-- reused for announcement, important, maintenance, and update values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'announcements_recipient_count_nonnegative'
      AND conrelid = 'public.announcements'::regclass
  ) THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_recipient_count_nonnegative
      CHECK (recipient_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'announcements_audience_valid'
      AND conrelid = 'public.announcements'::regclass
  ) THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_audience_valid
      CHECK (audience IN ('all_creators', 'active_creators', 'suspended_creators', 'banned_creators', 'specific_creators'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'announcements_status_valid'
      AND conrelid = 'public.announcements'::regclass
  ) THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_status_valid
      CHECK (status IN ('sending', 'sent', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_announcements_history_created
  ON public.announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_sent_by
  ON public.announcements(sent_by);
CREATE INDEX IF NOT EXISTS idx_profiles_role_status
  ON public.profiles(role, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_idempotency_key
  ON public.announcements(idempotency_key);

-- The legacy table had a public read policy but no client write policy.
-- Make the write restriction explicit, while retaining public reads for
-- legacy active/site announcements.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.announcements FROM anon, authenticated;

-- Notification writes remain server-only. Creators can only SELECT their
-- own notifications and UPDATE the read flag under migration 0010's RLS
-- policy/column grants.
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.notifications FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Atomic, server-only announcement delivery.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_admin_announcement(
  p_admin_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_audience TEXT,
  p_recipient_ids UUID[] DEFAULT '{}'::UUID[],
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_announcement_id UUID;
  v_existing announcements%ROWTYPE;
  v_recipient_ids UUID[];
  v_recipient_count INTEGER := 0;
  v_title TEXT;
  v_message TEXT;
  v_key TEXT;
BEGIN
  -- This function is callable only by the server's service-role client,
  -- but it still verifies the acting admin ID against the database. The
  -- ID is never trusted from a browser; the server action derives it from
  -- the authenticated session before invoking this function.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_admin_id
      AND role IN ('admin', 'super_admin')
      AND status NOT IN ('suspended', 'banned')
  ) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  v_title := btrim(COALESCE(p_title, ''));
  v_message := btrim(COALESCE(p_message, ''));
  v_key := btrim(COALESCE(p_idempotency_key, ''));

  IF length(v_title) < 1 OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'Announcement title is invalid';
  END IF;
  IF length(v_message) < 1 OR length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Announcement message is invalid';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('announcement', 'important', 'maintenance', 'update') THEN
    RAISE EXCEPTION 'Announcement type is invalid';
  END IF;
  IF p_audience IS NULL OR p_audience NOT IN (
    'all_creators', 'active_creators', 'suspended_creators', 'banned_creators', 'specific_creators'
  ) THEN
    RAISE EXCEPTION 'Announcement audience is invalid';
  END IF;
  IF length(v_key) < 16 OR length(v_key) > 100 THEN
    RAISE EXCEPTION 'Announcement idempotency key is invalid';
  END IF;

  v_recipient_ids := COALESCE(p_recipient_ids, '{}'::UUID[]);
  SELECT ARRAY(
    SELECT DISTINCT requested.id
    FROM unnest(v_recipient_ids) AS requested(id)
    WHERE requested.id IS NOT NULL
  ) INTO v_recipient_ids;

  IF p_audience = 'specific_creators' AND COALESCE(array_length(v_recipient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one creator';
  END IF;

  -- Never allow a caller to turn arbitrary profile IDs into recipients.
  -- Specific audiences must contain creator profiles only; all other
  -- audience modes derive recipients exclusively from role/status.
  IF p_audience = 'specific_creators' AND EXISTS (
    SELECT 1
    FROM unnest(v_recipient_ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = requested.id AND p.role = 'creator'
    )
  ) THEN
    RAISE EXCEPTION 'Specific audience contains an invalid creator';
  END IF;

  -- Insert the history row first. A unique idempotency key makes retries
  -- and double-clicks return the original result without sending again.
  INSERT INTO public.announcements (
    title, body, type, active, starts_at, audience, recipient_count,
    sent_by, sent_at, status, idempotency_key
  )
  VALUES (
    v_title, v_message, p_type, FALSE, NOW(), p_audience, 0,
    p_admin_id, NULL, 'sending', v_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_announcement_id;

  IF v_announcement_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.announcements
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'Announcement could not be created';
    END IF;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'duplicate', TRUE,
      'announcement_id', v_existing.id,
      'recipient_count', v_existing.recipient_count,
      'status', v_existing.status
    );
  END IF;

  -- One set-based INSERT handles all creators efficiently, including
  -- suspended and banned creators when the audience is all_creators.
  WITH recipient_rows AS MATERIALIZED (
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'creator'
      AND (
        p_audience = 'all_creators'
        OR (p_audience = 'active_creators' AND p.status = 'active')
        OR (p_audience = 'suspended_creators' AND p.status = 'suspended')
        OR (p_audience = 'banned_creators' AND p.status = 'banned')
        OR (p_audience = 'specific_creators' AND p.id = ANY(v_recipient_ids))
      )
  ), inserted_notifications AS (
    INSERT INTO public.notifications (
      user_id, type, title, message, link, metadata
    )
    SELECT
      recipient_rows.id,
      'announcement'::notification_type,
      v_title,
      v_message,
      '/dashboard/notifications',
      jsonb_build_object(
        'announcement_id', v_announcement_id,
        'announcement_type', p_type,
        'audience', p_audience
      )
    FROM recipient_rows
    RETURNING id
  )
  SELECT COUNT(*) INTO v_recipient_count FROM inserted_notifications;

  UPDATE public.announcements
  SET recipient_count = v_recipient_count,
      sent_at = NOW(),
      status = 'sent'
  WHERE id = v_announcement_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'duplicate', FALSE,
    'announcement_id', v_announcement_id,
    'recipient_count', v_recipient_count,
    'status', 'sent'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_admin_announcement(UUID, TEXT, TEXT, TEXT, TEXT, UUID[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_admin_announcement(UUID, TEXT, TEXT, TEXT, TEXT, UUID[], TEXT)
  TO service_role;

-- Make sure realtime continues to publish the same notifications table;
-- this is idempotent and does not create a second notification channel.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
