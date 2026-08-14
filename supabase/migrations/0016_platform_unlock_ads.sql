-- ============================================================
-- CreatorBoost Migration 0016 — Harden platform unlock-page ads
-- ------------------------------------------------------------
-- The ad columns already live on the single platform_settings row
-- (added in 0014). This migration deliberately does not create a
-- campaign-level ad table or any creator-configurable ad fields.
-- ============================================================

-- URL fallback values are public navigation/embed targets and must never use
-- javascript:, data:, or another non-browser-safe scheme. Existing rows are
-- not rewritten, so constraints are NOT VALID while still applying to every
-- new insert/update made by the admin-controlled settings action.
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_banner_url_http,
  ADD CONSTRAINT platform_settings_banner_url_http
    CHECK (banner_url IS NULL OR banner_url ~* '^https?://[^[:space:]]+$') NOT VALID,
  DROP CONSTRAINT IF EXISTS platform_settings_popunder_url_http,
  ADD CONSTRAINT platform_settings_popunder_url_http
    CHECK (popunder_url IS NULL OR popunder_url ~* '^https?://[^[:space:]]+$') NOT VALID;

-- RLS remains unchanged: platform_settings is updated only by the existing
-- admin/super_admin policy and the server action's requireAdmin() guard.
-- Do not expose banner/popunder fields through public_platform_settings;
-- /c/[slug] reads them server-side and sends only enabled, renderable values.
