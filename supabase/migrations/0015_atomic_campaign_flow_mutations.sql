-- Campaign rows and their custom flow pages must be written in one database
-- transaction. The constraint triggers added by 0014 are deferred until the
-- transaction commits; separate PostgREST requests are separate transactions
-- and therefore cannot satisfy the invariant for a custom flow.
--
-- Flow semantics (final): the existing Normal task page is always the
-- implicit first stage of a custom flow and is NOT stored in campaign_pages.
-- The flow label counts total visitor pages including that task page:
--   normal  → task page → destination                    (0 custom pages)
--   4_pages → task page + 3 custom pages → destination
--   5_pages → task page + 4 custom pages → destination

-- ------------------------------------------------------------
-- Page-count invariant. This re-defines the enforcement function CREATED IN
-- 0014 (which is already applied and therefore not modified on disk). The
-- deferred constraint triggers 0014 created keep working untouched: they
-- reference this function by OID and CREATE OR REPLACE preserves the OID.
-- Only the expected counts change (4→3, 5→4 custom pages) so the invariant
-- now covers "custom pages AFTER the existing Normal task page".
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
    WHEN '4_pages' THEN 3
    WHEN '5_pages' THEN 4
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

CREATE OR REPLACE FUNCTION public.save_campaign_with_pages(
  p_campaign JSONB,
  p_pages JSONB,
  p_campaign_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_campaign_id UUID;
  v_flow public.campaign_flow_type;
  v_expected_pages INTEGER;
  v_page_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account cannot manage campaigns' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_campaign) IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_pages, '[]'::JSONB)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Campaign payload is invalid' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_campaign->>'status', '') NOT IN ('draft', 'active', 'paused') THEN
    RAISE EXCEPTION 'Campaign status is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_flow := COALESCE(p_campaign->>'flow_type', 'normal')::public.campaign_flow_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Campaign flow type is invalid' USING ERRCODE = '22023';
  END;

  -- Custom pages only: the Normal task page is implicit stage 1.
  v_expected_pages := CASE v_flow
    WHEN 'normal' THEN 0
    WHEN '4_pages' THEN 3
    WHEN '5_pages' THEN 4
  END;
  v_page_count := jsonb_array_length(COALESCE(p_pages, '[]'::JSONB));

  IF v_page_count <> v_expected_pages THEN
    RAISE EXCEPTION 'Campaign flow % requires exactly % pages, found %',
      v_flow, v_expected_pages, v_page_count
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_pages, '[]'::JSONB)) WITH ORDINALITY AS page(value, ordinality)
    WHERE page.ordinality <= 3
      AND COALESCE(page.value->>'image_url', '') <> ''
      AND page.value->>'image_url' !~* '^https?://[^[:space:]]+$'
  ) THEN
    RAISE EXCEPTION 'Campaign page image must be an http(s) URL' USING ERRCODE = '22023';
  END IF;

  IF p_campaign_id IS NULL THEN
    INSERT INTO public.campaigns (
      creator_id, name, slug, description, category, destination_url,
      thumbnail_url, banner_url, status, tasks, task_metadata, expires_at,
      flow_type
    ) VALUES (
      v_user_id,
      p_campaign->>'name',
      p_campaign->>'slug',
      NULLIF(p_campaign->>'description', ''),
      (p_campaign->>'category')::public.campaign_category,
      COALESCE(p_campaign->>'destination_url', ''),
      NULLIF(p_campaign->>'thumbnail_url', ''),
      NULLIF(p_campaign->>'banner_url', ''),
      (p_campaign->>'status')::public.campaign_status,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_campaign->'tasks', '[]'::JSONB))),
      COALESCE(p_campaign->'task_metadata', '{}'::JSONB),
      NULLIF(p_campaign->>'expires_at', '')::TIMESTAMPTZ,
      v_flow
    )
    RETURNING id INTO v_campaign_id;
  ELSE
    UPDATE public.campaigns
    SET name = p_campaign->>'name',
        description = NULLIF(p_campaign->>'description', ''),
        category = (p_campaign->>'category')::public.campaign_category,
        destination_url = COALESCE(p_campaign->>'destination_url', ''),
        thumbnail_url = NULLIF(p_campaign->>'thumbnail_url', ''),
        banner_url = NULLIF(p_campaign->>'banner_url', ''),
        status = (p_campaign->>'status')::public.campaign_status,
        tasks = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_campaign->'tasks', '[]'::JSONB))),
        task_metadata = COALESCE(p_campaign->'task_metadata', '{}'::JSONB),
        expires_at = NULLIF(p_campaign->>'expires_at', '')::TIMESTAMPTZ,
        flow_type = v_flow
    WHERE id = p_campaign_id
      AND creator_id = v_user_id
      AND deleted_at IS NULL
    RETURNING id INTO v_campaign_id;

    IF v_campaign_id IS NULL THEN
      RAISE EXCEPTION 'Campaign not found or could not be updated' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.campaign_pages WHERE campaign_id = v_campaign_id;
  END IF;

  -- Positions are generated from array order rather than trusted from the
  -- caller, and they are CUSTOM-page positions (1..3 / 1..4) — never the
  -- overall flow position (the Normal task page is implicit stage 1).
  -- Campaign-level name/description are the only content source. Media and
  -- button text are restricted by custom-page position: pages after
  -- custom-page 3 are always stripped of media/action data.
  INSERT INTO public.campaign_pages (
    campaign_id, position, title, description, image_url, button_text
  )
  SELECT
    v_campaign_id,
    page.ordinality::INTEGER,
    p_campaign->>'name',
    NULLIF(p_campaign->>'description', ''),
    CASE WHEN page.ordinality <= 3 THEN NULLIF(page.value->>'image_url', '') ELSE NULL END,
    CASE WHEN page.ordinality <= 3 THEN NULLIF(page.value->>'button_text', '') ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p_pages, '[]'::JSONB)) WITH ORDINALITY AS page(value, ordinality);

  RETURN v_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_campaign_with_pages(JSONB, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_campaign_with_pages(JSONB, JSONB, UUID) TO authenticated;
