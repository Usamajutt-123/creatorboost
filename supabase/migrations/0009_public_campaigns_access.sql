-- ============================================================
-- CreatorBoost Migration 0009 — Public campaign access
-- ------------------------------------------------------------
-- public_campaigns must remain a definer-owned projection so
-- anonymous visitors can read active campaigns after the public
-- SELECT policy on campaigns was removed. security_invoker would
-- hide every row from anon and 404 valid /c/[slug] URLs.
-- Destination URL is still excluded.
-- ============================================================

CREATE OR REPLACE VIEW public.public_campaigns
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  id, slug, name, description, category, thumbnail_url, banner_url,
  tasks, task_metadata, created_at, updated_at
FROM public.campaigns
WHERE status = 'active'
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > NOW());

REVOKE ALL ON public.public_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_campaigns TO anon, authenticated;
