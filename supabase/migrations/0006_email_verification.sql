-- ============================================================
-- CreatorBoost Migration 0006 — Email Verification Activation
-- ------------------------------------------------------------
-- When a user confirms their email (auth.users.email_confirmed_at
-- transitions from NULL to set), set the profile status to 'active'
-- so they can access protected creator functionality.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_email_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (OLD.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles
      SET status = 'active', email_verified_at = NOW()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_confirmation ON auth.users;
CREATE TRIGGER trg_email_confirmation
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_email_confirmation();
