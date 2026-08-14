-- ============================================================
-- CreatorBoost Migration 0018 — Manual admin notifications only
-- ------------------------------------------------------------
-- Future notification rows may be created only by the protected Admin /
-- Super Admin announcement flow introduced in 0011. Existing notification
-- history is intentionally retained. Legacy automatic writers are suppressed
-- without raising, so campaign/financial/support operations keep their normal
-- transactional behavior while creating no notification row.
-- ============================================================

-- Creators can read and mark read only manual admin announcement rows. This
-- keeps legacy automatic history in place while removing it from user feeds.
DROP POLICY IF EXISTS users_read_own_notifications ON public.notifications;
DROP POLICY IF EXISTS users_update_own_notifications ON public.notifications;

CREATE POLICY users_read_own_notifications ON public.notifications
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND type = 'announcement'::notification_type
  );

CREATE POLICY users_update_own_notifications ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND type = 'announcement'::notification_type
  )
  WITH CHECK (
    auth.uid() = user_id
    AND type = 'announcement'::notification_type
  );

-- Verify every new row against the announcement history and its authorized
-- sender. Returning NULL from a BEFORE INSERT trigger safely suppresses legacy
-- automatic INSERT statements instead of failing and rolling back the campaign,
-- earnings, withdrawal, referral, or support operation that attempted one.
CREATE OR REPLACE FUNCTION public.enforce_manual_admin_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_announcement_id_text TEXT;
  v_announcement_id UUID;
BEGIN
  IF NEW.type IS DISTINCT FROM 'announcement'::notification_type THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(NEW.metadata) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  v_announcement_id_text := NEW.metadata ->> 'announcement_id';
  IF COALESCE(v_announcement_id_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_announcement_id := v_announcement_id_text::UUID;

  IF NOT EXISTS (
    SELECT 1
    FROM public.announcements announcement
    JOIN public.profiles sender ON sender.id = announcement.sent_by
    JOIN public.profiles recipient ON recipient.id = NEW.user_id
    WHERE announcement.id = v_announcement_id
      AND announcement.idempotency_key IS NOT NULL
      AND announcement.active = FALSE
      AND announcement.status IN ('sending', 'sent')
      AND announcement.title = NEW.title
      AND announcement.body = NEW.message
      AND announcement.type = NEW.metadata ->> 'announcement_type'
      AND announcement.audience = NEW.metadata ->> 'audience'
      AND sender.role IN ('admin', 'super_admin')
      AND sender.status NOT IN ('suspended', 'banned')
      AND recipient.role = 'creator'
      AND NEW.link = '/dashboard/notifications'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_manual_admin_notification()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_manual_admin_only ON public.notifications;
CREATE TRIGGER trg_notifications_manual_admin_only
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_admin_notification();

-- The generic service-role helpers existed for automatic application events.
-- Keep their signatures for deployment compatibility, but make them no-ops.
-- Manual delivery does not use either helper; it uses send_admin_announcement.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

-- Stop the database-side automatic support-ticket path entirely. The support
-- flow itself and its email confirmation remain unchanged.
DROP TRIGGER IF EXISTS trg_support_ticket_notify ON public.support_tickets;

-- Keep creators unable to create or delete notification rows. Their only write
-- remains the existing column-level UPDATE grant for the read flag.
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read) ON TABLE public.notifications TO authenticated;
