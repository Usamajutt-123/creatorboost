-- ============================================================
-- CreatorBoost Migration 0014 — Open Page + Custom Pages
-- ------------------------------------------------------------
-- Adds a strict server-controlled "flow type" to campaigns and a
-- `campaign_pages` child table that only ever holds the exact page
-- count for the flow (0 / 4 / 5). Every earning-relevant value —
-- the multiplier — is derived on the server from `flow_type` alone
-- (see src/lib/flow.ts). The migration does NOT change existing
-- CPM, country CPM, level multiplier, fraud detection, earnings
-- ledger, RLS on other tables, or any existing campaign columns.
-- Existing rows automatically default to flow_type='normal'.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum + campaigns column (backfills to 'normal')
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE campaign_flow_type AS ENUM ('normal', '4_pages', '5_pages');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS flow_type campaign_flow_type NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_campaigns_flow_type ON public.campaigns(flow_type);

-- ------------------------------------------------------------
-- 2. campaign_pages child table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  image_url TEXT CHECK (image_url IS NULL OR char_length(image_url) <= 2000),
  button_text TEXT CHECK (button_text IS NULL OR char_length(button_text) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, position)
);

CREATE INDEX IF NOT EXISTS idx_campaign_pages_campaign ON public.campaign_pages(campaign_id, position);

DO $$ BEGIN
  CREATE TRIGGER trg_campaign_pages_updated
    BEFORE UPDATE ON public.campaign_pages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 3. Strict page-count enforcement
--    Fires on any change that could break the invariant:
--      normal  -> 0 pages
--      4_pages -> exactly 4
--      5_pages -> exactly 5
--    Runs at the END of the transaction so the create-campaign +
--    insert-4-pages + insert-5-pages flow can complete atomically.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_campaign_page_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_campaign_id UUID;
  v_flow campaign_flow_type;
  v_count INTEGER;
  v_expected INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'campaigns' THEN
    v_campaign_id := NEW.id;
    v_flow := NEW.flow_type;
  ELSE
    v_campaign_id := COALESCE(NEW.campaign_id, OLD.campaign_id);
    SELECT flow_type INTO v_flow FROM public.campaigns WHERE id = v_campaign_id;
    IF v_flow IS NULL THEN
      RETURN NULL; -- campaign was cascade-deleted; nothing to enforce
    END IF;
  END IF;

  v_expected := CASE v_flow
    WHEN 'normal' THEN 0
    WHEN '4_pages' THEN 4
    WHEN '5_pages' THEN 5
  END;

  SELECT COUNT(*) INTO v_count FROM public.campaign_pages WHERE campaign_id = v_campaign_id;

  IF v_count <> v_expected THEN
    RAISE EXCEPTION
      'Campaign % flow % requires exactly % pages, found %',
      v_campaign_id, v_flow, v_expected, v_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_flow_page_count ON public.campaigns;
CREATE CONSTRAINT TRIGGER trg_campaigns_flow_page_count
  AFTER INSERT OR UPDATE OF flow_type ON public.campaigns
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_page_count();

DROP TRIGGER IF EXISTS trg_campaign_pages_flow_page_count ON public.campaign_pages;
CREATE CONSTRAINT TRIGGER trg_campaign_pages_flow_page_count
  AFTER INSERT OR UPDATE OR DELETE ON public.campaign_pages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_page_count();

-- ------------------------------------------------------------
-- 4. RLS on campaign_pages
--    - Creators can fully manage pages belonging to their own campaign.
--    - Anonymous / authenticated visitors get read-only access to
--      pages of campaigns that are already publicly visible via the
--      `public_campaigns` view (active, non-deleted, non-expired).
--    - No client can set flow_type, no client can mutate multipliers
--      (there is no multiplier column: it is a pure server function).
-- ------------------------------------------------------------
ALTER TABLE public.campaign_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_pages_owner_all ON public.campaign_pages;
CREATE POLICY campaign_pages_owner_all ON public.campaign_pages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_pages.campaign_id
        AND c.creator_id = auth.uid()
        AND c.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_pages.campaign_id
        AND c.creator_id = auth.uid()
        AND c.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS campaign_pages_public_read ON public.campaign_pages;
CREATE POLICY campaign_pages_public_read ON public.campaign_pages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_pages.campaign_id
        AND c.status = 'active'
        AND c.deleted_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at > NOW())
    )
  );

-- ------------------------------------------------------------
-- 5. Extend `public_campaigns` view with flow_type so /c/[slug]
--    can render the correct flow without exposing new fields.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.public_campaigns;
CREATE VIEW public.public_campaigns
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  id, slug, name, description, category, thumbnail_url, banner_url,
  tasks, task_metadata, flow_type, created_at, updated_at
FROM public.campaigns
WHERE status = 'active'
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > NOW());

REVOKE ALL ON public.public_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_campaigns TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. views: audit columns for the flow multiplier + replay guard
--    Nullable so all existing rows (which are 'normal', 1.00x) are
--    valid without a rewrite. A UNIQUE index on
--    (creator_id, flow_session_id) makes it impossible for a visitor
--    to reuse a completion token for two credited views even if the
--    idempotency_key check is somehow bypassed.
-- ------------------------------------------------------------
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS flow_type campaign_flow_type NOT NULL DEFAULT 'normal';
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS flow_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00
    CHECK (flow_multiplier IN (1.00, 1.25, 1.40));
ALTER TABLE public.views
  ADD COLUMN IF NOT EXISTS flow_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_views_flow_session
  ON public.views (creator_id, flow_session_id)
  WHERE flow_session_id IS NOT NULL;

-- ------------------------------------------------------------
-- 7. Centralized admin-controlled ad configuration
--    Reuses the single-row platform_settings table so no new
--    table or duplicate system is needed.
-- ------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS banner_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS banner_code TEXT CHECK (char_length(banner_code) <= 5000),
  ADD COLUMN IF NOT EXISTS banner_url TEXT CHECK (char_length(banner_url) <= 2000),
  ADD COLUMN IF NOT EXISTS popunder_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS popunder_code TEXT CHECK (char_length(popunder_code) <= 5000),
  ADD COLUMN IF NOT EXISTS popunder_url TEXT CHECK (char_length(popunder_url) <= 2000);
