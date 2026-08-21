-- ============================================================
-- CreatorBoost Migration 0022 — Monetized Unlock Flow + Shortener System
-- ------------------------------------------------------------
-- Turns the existing unlock campaigns into a full monetized flow:
--
--   Unlock Link (/unlock/[slug])   — existing task page
--        ↓
--   /go/[slug]/1 .. /go/[slug]/N   — admin-configured educational
--                                     shortener steps (ads + countdown)
--        ↓
--   Final destination (securely resolved server-side)
--
-- Additive only. Migrations 0001-0021 are already applied and are NOT
-- edited. Nothing here changes the CPM formula, the creator-level
-- multiplier, the earnings caps, the holding period, the withdrawal
-- model, authentication or the existing unlock/destination fallback.
--
-- WHAT THIS MIGRATION ADDS
--
--   1. monetization_settings    — single-row global flow settings
--   2. monetization_steps       — admin-managed shortener steps
--                                (title, rich content, countdown, order)
--   3. monetization_ad_slots    — per-page ad configuration (task page
--                                + every step, 3 slots per page)
--   4. monetization_payout_settings — creator share, per-view payout
--                                bounds, fraud adjustment
--   5. monetization_revenue     — manual/imported gross ad revenue
--                                ledger (clearly labeled manual)
--   6. flow_sessions            — secure visitor flow sessions
--   7. flow_events              — funnel analytics (task starts through
--                                qualified destination visits)
--   8. record_view_and_credit() — extended with p_flow_session_id so a
--                                qualified flow completion is attributed
--                                to its session atomically
--   9. Admin + creator analytics RPCs (funnel, geo, devices, revenue)
--
-- The creator earnings formula is unchanged:
--   earning_per_view = (country_tier.cpm_default × creator_level.cpm_multiplier)
--                      / 1000, adjusted by the configured creator share and
--                      fraud adjustment, then clamped to the payout bounds.
-- ============================================================

-- ============================================================
-- 1. GLOBAL MONETIZATION SETTINGS (single row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monetization_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforce single row

  -- Master switches
  flow_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  task_page_ads_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  progress_bar_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  educational_content_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  final_redirect_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  test_mode BOOLEAN DEFAULT FALSE NOT NULL,

  -- Flow shape
  steps_count INTEGER DEFAULT 4 NOT NULL CHECK (steps_count BETWEEN 1 AND 12),
  default_countdown_seconds INTEGER DEFAULT 10 NOT NULL
    CHECK (default_countdown_seconds BETWEEN 1 AND 120),
  session_ttl_minutes INTEGER DEFAULT 30 NOT NULL
    CHECK (session_ttl_minutes BETWEEN 5 AND 240),

  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id)
);

INSERT INTO public.monetization_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. SHORTENER STEPS (admin-managed, global for all campaigns)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monetization_steps (
  id SERIAL PRIMARY KEY,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 12),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  subtitle TEXT CHECK (subtitle IS NULL OR char_length(subtitle) <= 300),
  intro TEXT CHECK (intro IS NULL OR char_length(intro) <= 2000),
  -- Rich content. Sanitized server-side before storage AND before render.
  body_html TEXT CHECK (body_html IS NULL OR char_length(body_html) <= 30000),
  icon TEXT CHECK (icon IS NULL OR char_length(icon) <= 16),
  image_url TEXT CHECK (image_url IS NULL OR char_length(image_url) <= 2000),
  button_text TEXT CHECK (button_text IS NULL OR char_length(button_text) <= 60),
  countdown_seconds INTEGER NOT NULL DEFAULT 10 CHECK (countdown_seconds BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (position)
);

CREATE INDEX IF NOT EXISTS idx_monetization_steps_position
  ON public.monetization_steps (position);

DO $$ BEGIN
  CREATE TRIGGER trg_monetization_steps_updated
    BEFORE UPDATE ON public.monetization_steps
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the four default educational steps. `body_html` only ever uses the
-- sanitizer's allowlist (see src/lib/monetization/sanitize.ts).
INSERT INTO public.monetization_steps
  (position, title, subtitle, intro, body_html, icon, button_text, countdown_seconds, status)
VALUES
(1, 'What is CreatorBoost?',
 'The platform powering this unlock link',
 'CreatorBoost is a creator monetization platform that turns a single unlock link into tasks, a short monetized redirect flow, and clear analytics for the creator.',
 '<p>You just completed the tasks on the previous page — well done! Before we send you to your destination, here is a quick look at the platform that made this possible.</p><h2>One link, an entire growth engine</h2><p>Creators use <strong>CreatorBoost</strong> to grow their audience and earn from their traffic at the same time. Every link combines unlocking and short links into one automatic flow.</p><div class="grid-2"><div class="card"><div class="card-icon">🔗</div><div class="card-title">Unlock links</div><div class="card-body">A creator picks a destination and the tasks visitors must complete. CreatorBoost publishes one public unlock link.</div></div><div class="card"><div class="card-icon">💰</div><div class="card-title">Monetize your audience</div><div class="card-body">Legitimate traffic passes through a short, ad-supported redirect flow so creators earn from every visit.</div></div><div class="card"><div class="card-icon">📊</div><div class="card-title">Track performance</div><div class="card-body">Clicks, task completions, unlocks, flow steps, countries, devices and earnings — all visible in the creator dashboard.</div></div><div class="card"><div class="card-icon">⚡</div><div class="card-title">Task-based growth</div><div class="card-body">Creators use task-based links to turn visitors into subscribers, followers and members of their community.</div></div></div><p>CreatorBoost verifies every visitor server-side, separates real traffic from automated traffic, and only counts qualified views toward creator earnings.</p>',
 '🎓', 'Continue', 10, 'enabled'),

(2, 'How CreatorBoost Unlock Links Work',
 'From destination URL to unlock link in minutes',
 'Here is the complete journey of an unlock link — from the moment a creator publishes it to the moment a visitor reaches the destination.',
 '<p>CreatorBoost keeps the creator workflow simple: a destination URL, a set of tasks, and one published link.</p><ol><li><strong>Creator adds a destination URL</strong> — the page visitors want to reach.</li><li><strong>Creator selects tasks</strong> — subscribe, follow, visit, or a custom task.</li><li><strong>Creator publishes the link</strong> — CreatorBoost generates one public unlock link.</li><li><strong>Visitor opens the link</strong> — the task page appears with the creator''s branding.</li><li><strong>Visitor completes the required tasks</strong> — progress updates live.</li><li><strong>Visitor unlocks the link</strong> — the monetized redirect flow begins.</li><li><strong>CreatorBoost runs the shortener flow</strong> — useful pages, ads and a countdown.</li><li><strong>Visitor reaches the final destination</strong> — securely redirected to the original URL.</li></ol><h2>The journey, visually</h2><div class="timeline"><div class="timeline-step"><span class="timeline-dot">1</span><div class="card"><div class="card-title">Tasks</div><div class="card-body">Visitor completes the required tasks</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">2</span><div class="card"><div class="card-title">Complete</div><div class="card-body">All tasks are marked complete</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">3</span><div class="card"><div class="card-title">Unlock</div><div class="card-body">The unlock button activates</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">4</span><div class="card"><div class="card-title">Shortener</div><div class="card-body">The monetized step flow runs</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">5</span><div class="card"><div class="card-title">Destination</div><div class="card-body">The original URL opens</div></div></div></div>',
 '🧭', 'Continue', 10, 'enabled'),

(3, 'How URL Shortening Works',
 'Short links, redirects and honest analytics',
 'This page is part of a short, monetized redirect flow. Here is how short links work — and why CreatorBoost handles them securely.',
 '<p><strong>URL shortening</strong> takes a long destination URL and gives it a short, shareable address. When someone opens the short link, the shortener looks up the original destination and redirects the visitor to it.</p><div class="timeline"><div class="timeline-step"><span class="timeline-dot">1</span><div class="card"><div class="card-title">Long URL</div><div class="card-body">The creator''s original destination</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">2</span><div class="card"><div class="card-title">CreatorBoost short link</div><div class="card-body">One compact, branded link to share anywhere</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">3</span><div class="card"><div class="card-title">Monetized redirect</div><div class="card-body">Useful pages with ads and a short countdown</div></div></div><div class="timeline-arrow">↓</div><div class="timeline-step"><span class="timeline-dot">4</span><div class="card"><div class="card-title">Destination</div><div class="card-body">The visitor lands on the original URL</div></div></div></div><h2>Why short links are useful</h2><ul><li><strong>Easier sharing</strong> — short links fit anywhere: bios, chats, posts, videos.</li><li><strong>One link forever</strong> — the creator can update the destination without changing the link.</li><li><strong>Analytics built in</strong> — every step is measured.</li></ul><h2>What CreatorBoost measures</h2><ul><li>Clicks and task completions</li><li>Unlocks and shortener flow starts</li><li>Step-by-step completion</li><li>Countries and devices</li><li>Referral sources</li><li>Completion rates and qualified views</li></ul><p>CreatorBoost stores no private personal information. Traffic is measured as aggregate, anonymous analytics, and every redirect is validated server-side before a visitor is sent anywhere.</p>',
 '🔗', 'Continue', 10, 'enabled'),

(4, 'CreatorBoost Tips for Better Links',
 'Make every unlock link earn more',
 'Ten practical tips creators use to build links that convert visitors into community members — and into earnings.',
 '<p>Your destination is almost ready. While the timer runs, here is how creators get the most out of CreatorBoost:</p><h2>Tips for better links</h2><ul class="checklist"><li><strong>Use a clear destination URL</strong> — send visitors exactly where they expect to go.</li><li><strong>Choose relevant tasks</strong> — tasks that match your audience complete far more often.</li><li><strong>Avoid unnecessary tasks</strong> — every extra task costs completions. Keep it short.</li><li><strong>Use a good thumbnail</strong> — a clear image makes your link look professional.</li><li><strong>Make task requirements understandable</strong> — visitors should instantly know what to do.</li><li><strong>Monitor analytics</strong> — countries, devices and drop-off steps show where to improve.</li><li><strong>Understand audience GEO</strong> — where your audience lives changes how links perform.</li><li><strong>Share links responsibly</strong> — real audiences, real communities, real growth.</li><li><strong>Avoid spam</strong> — spam traffic is filtered by the fraud engine and earns nothing.</li><li><strong>Avoid fraudulent traffic</strong> — bots and automation are detected and never qualify.</li></ul><div class="note"><strong>Build trust with your audience.</strong> A link that consistently delivers is a link people open again.</div>',
 '💡', 'Continue to destination', 10, 'enabled')
ON CONFLICT (position) DO NOTHING;

-- ============================================================
-- 3. PER-PAGE AD SLOTS (admin controlled, never hardcoded)
-- ============================================================
-- page_key is either 'task_page' or 'step_<position>'. A slot only renders
-- when it is enabled AND has renderable code/url (or the platform is in
-- test mode, which renders a labeled placeholder instead).
CREATE TABLE IF NOT EXISTS public.monetization_ad_slots (
  id SERIAL PRIMARY KEY,
  page_key TEXT NOT NULL CHECK (
    page_key = 'task_page' OR page_key ~ '^step_[1-9][0-9]?$'
  ),
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  enabled BOOLEAN DEFAULT FALSE NOT NULL,
  network TEXT NOT NULL DEFAULT 'adsterra'
    CHECK (network IN ('adsterra', 'monetag', 'custom', 'placeholder')),
  format TEXT NOT NULL DEFAULT 'native_banner'
    CHECK (format IN ('native_banner', 'standard_banner', 'social_bar',
                      'popunder', 'multitag', 'onclick', 'inpage_push',
                      'vignette', 'other')),
  zone_id TEXT CHECK (zone_id IS NULL OR char_length(zone_id) <= 200),
  code TEXT CHECK (code IS NULL OR char_length(code) <= 10000),
  url TEXT CHECK (url IS NULL OR char_length(url) <= 2000),
  placement TEXT NOT NULL DEFAULT 'bottom' CHECK (placement IN ('top', 'middle', 'bottom')),
  device_target TEXT NOT NULL DEFAULT 'all' CHECK (device_target IN ('all', 'desktop', 'mobile')),
  priority INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'every_view' CHECK (frequency IN ('once_per_session', 'every_view')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_key, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_monetization_ad_slots_page
  ON public.monetization_ad_slots (page_key, slot_number);

DO $$ BEGIN
  CREATE TRIGGER trg_monetization_ad_slots_updated
    BEFORE UPDATE ON public.monetization_ad_slots
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Default configuration (matches the product spec). Slots ship enabled but
-- WITHOUT code, so nothing renders publicly until an admin pastes their own
-- network snippet. In test mode they render as labeled placeholders.
INSERT INTO public.monetization_ad_slots
  (page_key, slot_number, enabled, network, format, placement, device_target, priority)
VALUES
  ('task_page', 1, TRUE, 'adsterra', 'native_banner',    'middle', 'all', 1),
  ('task_page', 2, TRUE, 'monetag',  'multitag',         'bottom', 'all', 2),
  ('step_1',    1, TRUE, 'adsterra', 'native_banner',    'middle', 'all', 1),
  ('step_1',    2, TRUE, 'adsterra', 'standard_banner',  'bottom', 'all', 2),
  ('step_2',    1, TRUE, 'monetag',  'multitag',         'middle', 'all', 1),
  ('step_2',    2, TRUE, 'adsterra', 'native_banner',    'bottom', 'all', 2),
  ('step_3',    1, TRUE, 'adsterra', 'social_bar',       'middle', 'all', 1),
  ('step_3',    2, TRUE, 'monetag',  'multitag',         'bottom', 'all', 2),
  ('step_4',    1, TRUE, 'adsterra', 'native_banner',    'middle', 'all', 1),
  ('step_4',    2, TRUE, 'monetag',  'multitag',         'bottom', 'all', 2)
ON CONFLICT (page_key, slot_number) DO NOTHING;

-- ============================================================
-- 4. PAYOUT SETTINGS (single row)
-- ============================================================
-- Country CPM lives in country_tiers (existing), the level multiplier in
-- creator_levels (existing). This row only adds the monetization-specific
-- adjustments applied on top of the existing formula.
CREATE TABLE IF NOT EXISTS public.monetization_payout_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Fraction of the computed per-view earning credited to the creator.
  creator_share_percent NUMERIC(5,2) DEFAULT 100.00 NOT NULL
    CHECK (creator_share_percent BETWEEN 0 AND 100),

  -- Per-view payout bounds (applied after share + fraud adjustment).
  min_payout_per_view NUMERIC(8,5) DEFAULT 0.00050 NOT NULL
    CHECK (min_payout_per_view >= 0),
  max_payout_per_view NUMERIC(8,5) DEFAULT 0.05000 NOT NULL
    CHECK (max_payout_per_view >= 0),

  -- When a view is still valid but its fraud score reaches the threshold,
  -- earnings are reduced by fraud_adjustment_percent (0 = no adjustment).
  fraud_adjustment_percent NUMERIC(5,2) DEFAULT 0.00 NOT NULL
    CHECK (fraud_adjustment_percent BETWEEN 0 AND 100),
  fraud_adjustment_threshold NUMERIC(5,2) DEFAULT 40.00 NOT NULL
    CHECK (fraud_adjustment_threshold BETWEEN 0 AND 100),

  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id)
);

INSERT INTO public.monetization_payout_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. GROSS REVENUE LEDGER (manual until a provider API is configured)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monetization_revenue (
  id SERIAL PRIMARY KEY,
  revenue_date DATE NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('adsterra', 'monetag', 'other')),
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  revenue NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  country CHAR(2),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_monetization_revenue_date
  ON public.monetization_revenue (revenue_date DESC);

-- ============================================================
-- 6. FLOW SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 12),
  total_steps INTEGER NOT NULL DEFAULT 4 CHECK (total_steps BETWEEN 1 AND 12),
  current_step_started_at TIMESTAMPTZ,
  tasks_completed TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  -- Coarse binding (network prefix + UA hash, same technique as the unlock
  -- token) so a copied session id cannot be replayed from elsewhere.
  subject_hash TEXT,
  preview_mode BOOLEAN NOT NULL DEFAULT FALSE,
  test_mode BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_campaign ON public.flow_sessions (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_expires ON public.flow_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_creator ON public.flow_sessions (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_subject ON public.flow_sessions (subject_hash) WHERE subject_hash IS NOT NULL;

-- ============================================================
-- 7. FLOW EVENTS (funnel analytics; no PII beyond country/device bucket)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_session_id UUID REFERENCES public.flow_sessions(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'task_start', 'task_complete', 'unlock', 'flow_start',
    'step_start', 'step_complete', 'destination_visit'
  )),
  step INTEGER CHECK (step IS NULL OR step BETWEEN 0 AND 12),
  qualified BOOLEAN NOT NULL DEFAULT FALSE,
  test_mode BOOLEAN NOT NULL DEFAULT FALSE,
  preview_mode BOOLEAN NOT NULL DEFAULT FALSE,
  country_code CHAR(2),
  device_category TEXT CHECK (device_category IS NULL OR device_category IN ('mobile', 'desktop', 'tablet')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_events_campaign ON public.flow_events (campaign_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_events_creator ON public.flow_events (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_events_session ON public.flow_events (flow_session_id, event_type, step);
CREATE INDEX IF NOT EXISTS idx_flow_events_type_created ON public.flow_events (event_type, created_at DESC);

-- Idempotency for step lifecycle events: a refresh can never double-count.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_flow_events_step_lifecycle
  ON public.flow_events (flow_session_id, event_type, step)
  WHERE flow_session_id IS NOT NULL AND event_type IN ('step_start', 'step_complete');

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================
-- Public visitors interact ONLY through server code (API routes + server
-- components) which uses the service role. No anon table access exists.
-- Creators read their own funnel aggregates; admins manage everything.

ALTER TABLE public.monetization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monetization_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monetization_ad_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monetization_payout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monetization_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_events ENABLE ROW LEVEL SECURITY;

-- Admins only (all mutation happens through authorized server actions).
DROP POLICY IF EXISTS monetization_settings_admin_all ON public.monetization_settings;
CREATE POLICY monetization_settings_admin_all ON public.monetization_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS monetization_steps_admin_all ON public.monetization_steps;
CREATE POLICY monetization_steps_admin_all ON public.monetization_steps
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS monetization_ad_slots_admin_all ON public.monetization_ad_slots;
CREATE POLICY monetization_ad_slots_admin_all ON public.monetization_ad_slots
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS monetization_payout_admin_all ON public.monetization_payout_settings;
CREATE POLICY monetization_payout_admin_all ON public.monetization_payout_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS monetization_revenue_admin_all ON public.monetization_revenue;
CREATE POLICY monetization_revenue_admin_all ON public.monetization_revenue
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS flow_sessions_admin_read ON public.flow_sessions;
CREATE POLICY flow_sessions_admin_read ON public.flow_sessions
  FOR SELECT USING (public.is_admin());

-- Creators read their own funnel events for the dashboard; admins read all.
-- No client can INSERT/UPDATE/DELETE: events are written by server code.
DROP POLICY IF EXISTS flow_events_creator_read ON public.flow_events;
CREATE POLICY flow_events_creator_read ON public.flow_events
  FOR SELECT USING (creator_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 9. record_view_and_credit() — flow session attribution
-- ============================================================
-- Identical financial logic to migration 0021; the only additions are the
-- optional p_flow_session_id parameter and its inclusion in the view INSERT,
-- so a qualified flow completion is linked to its session atomically and the
-- pre-existing unique index uniq_views_flow_session (creator, flow_session)
-- makes a completed flow non-replayable at the storage layer.
--
-- NOTE: the signature gains one parameter, so CREATE OR REPLACE would leave
-- the 0021 overload behind and make the bare-name COMMENT/REVOKE ambiguous.
-- The old signature is dropped first (its body is fully replaced below).
DROP FUNCTION IF EXISTS public.record_view_and_credit(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC,
  TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TEXT, INTEGER, TEXT, NUMERIC
);

CREATE OR REPLACE FUNCTION public.record_view_and_credit(
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
  p_idempotency_key TEXT,
  p_ip_window_hours INTEGER DEFAULT 24,
  p_description TEXT DEFAULT NULL,
  p_referral_percentage NUMERIC DEFAULT NULL,
  p_flow_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key       BIGINT;
  v_view_id        UUID;
  v_status         view_status;
  v_reason         TEXT := p_invalid_reason;
  v_country        CHAR(2);
  v_earning        NUMERIC(14,6) := GREATEST(COALESCE(p_earnings, 0), 0);
  v_valid          BOOLEAN;
  v_caps           platform_settings%ROWTYPE;
  v_campaign_owner UUID;
  v_campaign_state campaign_status;
  v_creator_state  user_status;
  v_creator_today  NUMERIC;
  v_campaign_today NUMERIC;
  v_platform_today NUMERIC;
  v_hold_hours     INTEGER;
  v_earning_id     UUID;
  v_existing       RECORD;
  v_category       TEXT;
  v_creator_visible BOOLEAN;
  v_window_hours   INTEGER := GREATEST(COALESCE(p_ip_window_hours, 24), 1);
  v_referrer       UUID;
  v_commission     NUMERIC(14,6);
  v_pct            NUMERIC;
  v_flow_session   TEXT := NULLIF(btrim(COALESCE(p_flow_session_id, '')), '');
BEGIN
  -- ---------------------------------------------------------------
  -- 0. Idempotency: a replay returns the ORIGINAL outcome and never
  --    creates a second view or a second ledger row.
  -- ---------------------------------------------------------------
  IF COALESCE(btrim(p_idempotency_key), '') <> '' THEN
    SELECT id, status, invalid_reason, earnings
      INTO v_existing
    FROM views
    WHERE creator_id = p_creator_id AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'processed', TRUE,
        'replayed', TRUE,
        'view_id', v_existing.id,
        'valid', v_existing.status = 'valid',
        'earning', COALESCE(v_existing.earnings, 0),
        'reason', v_existing.invalid_reason,
        'traffic_category', public.classify_view_outcome(v_existing.status::TEXT, v_existing.invalid_reason)
      );
    END IF;
  END IF;

  v_country := CASE
    WHEN COALESCE(p_country_code, '') ~ '^[A-Za-z]{2}$' THEN upper(p_country_code)::CHAR(2)
    ELSE NULL
  END;

  v_valid := (p_status = 'valid');
  IF NOT v_valid THEN
    v_earning := 0;
    v_reason  := COALESCE(NULLIF(btrim(COALESCE(p_invalid_reason, '')), ''), 'invalid_traffic');
  END IF;

  -- ---------------------------------------------------------------
  -- 1. Campaign + creator state (server-side truth, never the client's)
  -- ---------------------------------------------------------------
  IF v_valid THEN
    SELECT creator_id, status INTO v_campaign_owner, v_campaign_state
    FROM campaigns WHERE id = p_campaign_id AND deleted_at IS NULL;
    SELECT status INTO v_creator_state FROM profiles WHERE id = p_creator_id;

    IF v_campaign_owner IS NULL OR v_campaign_owner <> p_creator_id OR v_campaign_state <> 'active' THEN
      v_valid := FALSE; v_reason := 'campaign_inactive'; v_earning := 0;
    ELSIF v_creator_state IS NULL OR v_creator_state <> 'active' THEN
      v_valid := FALSE; v_reason := 'account_blocked'; v_earning := 0;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Duplicate window for this campaign + hashed IP.
  -- ---------------------------------------------------------------
  IF v_valid AND p_ip_hash IS NOT NULL THEN
    v_lock_key := ('x' || left(encode(
      digest(p_campaign_id::TEXT || ':' || p_ip_hash, 'sha256'), 'hex'), 16))::BIT(64)::BIGINT;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    IF EXISTS (
      SELECT 1 FROM views
      WHERE campaign_id = p_campaign_id
        AND ip_hash = p_ip_hash
        AND status = 'valid'
        AND created_at >= NOW() - (v_window_hours || ' hours')::INTERVAL
    ) THEN
      v_valid := FALSE; v_reason := 'duplicate_ip_24h'; v_earning := 0;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Caps (same order and logic as 0021).
  -- ---------------------------------------------------------------
  SELECT * INTO v_caps FROM platform_settings WHERE id = 1;

  IF v_valid THEN
    v_earning := LEAST(v_earning, GREATEST(COALESCE(v_caps.max_earnings_per_view, 0), 0));
    IF v_earning < 0 THEN v_earning := 0; END IF;
  END IF;

  IF v_valid AND v_earning > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:platform-earnings'));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:creator:' || p_creator_id::TEXT));
    PERFORM pg_advisory_xact_lock(hashtext('creatorboost:campaign:' || p_campaign_id::TEXT));

    SELECT creator_earnings_today, campaign_earnings_today, platform_earnings_today
      INTO v_creator_today, v_campaign_today, v_platform_today
    FROM public.view_cap_snapshot(p_creator_id, p_campaign_id, NULL, NULL, 24);

    IF v_creator_today + v_earning > COALESCE(v_caps.creator_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'creator_daily_cap'; v_earning := 0;
    ELSIF v_campaign_today + v_earning > COALESCE(v_caps.campaign_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'campaign_daily_cap'; v_earning := 0;
    ELSIF v_platform_today + v_earning > COALESCE(v_caps.platform_daily_earning_cap, 0) THEN
      v_valid := FALSE; v_reason := 'platform_daily_cap'; v_earning := 0;
    END IF;
  END IF;

  v_status := CASE WHEN v_valid THEN 'valid'::view_status ELSE 'invalid'::view_status END;
  IF NOT v_valid THEN v_earning := 0; END IF;

  -- ---------------------------------------------------------------
  -- 4. Insert the view (now with flow session attribution).
  -- ---------------------------------------------------------------
  BEGIN
    INSERT INTO views (
      campaign_id, creator_id, visitor_ip, ip_hash, country_code,
      device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
      fraud_score, status, invalid_reason, cpm_rate, earnings,
      tasks_completed, validated_at, accounted_at, idempotency_key,
      flow_session_id
    ) VALUES (
      p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country,
      p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
      p_is_emulator, p_fraud_score, v_status,
      CASE WHEN v_valid THEN NULL ELSE v_reason END,
      p_cpm_rate, v_earning,
      to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
      CASE WHEN v_valid THEN NOW() ELSE NULL END,
      NOW(),
      NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
      v_flow_session
    )
    RETURNING id INTO v_view_id;
  EXCEPTION
    WHEN unique_violation THEN
      v_valid := FALSE;
      v_reason := 'duplicate_ip_24h';
      v_earning := 0;
      v_status := 'invalid'::view_status;

      INSERT INTO views (
        campaign_id, creator_id, visitor_ip, ip_hash, country_code,
        device_fingerprint, user_agent, is_vpn, is_proxy, is_bot, is_emulator,
        fraud_score, status, invalid_reason, cpm_rate, earnings,
        tasks_completed, validated_at, accounted_at, idempotency_key
      ) VALUES (
        p_campaign_id, p_creator_id, p_visitor_ip, p_ip_hash, v_country,
        p_device_fingerprint, p_user_agent, p_is_vpn, p_is_proxy, p_is_bot,
        p_is_emulator, p_fraud_score, v_status, v_reason, p_cpm_rate, 0,
        to_jsonb(COALESCE(p_tasks_completed, ARRAY[]::TEXT[])),
        NULL, NOW(), NULL   -- the original row keeps the idempotency key
      )
      RETURNING id INTO v_view_id;
  END;

  -- ---------------------------------------------------------------
  -- 5. Ledger + counters + pending balance + referral, same transaction.
  -- ---------------------------------------------------------------
  IF v_valid AND v_earning > 0 THEN
    v_hold_hours := COALESCE(v_caps.earning_holding_hours, 24);

    INSERT INTO earnings (creator_id, campaign_id, view_id, type, amount, description, available_at)
    VALUES (p_creator_id, p_campaign_id, v_view_id, 'view_earning', v_earning,
            COALESCE(p_description, 'View earning'),
            NOW() + (v_hold_hours * INTERVAL '1 hour'))
    RETURNING id INTO v_earning_id;

    IF v_earning_id IS NULL THEN
      RAISE EXCEPTION 'earning ledger insert failed for view %', v_view_id;
    END IF;
  END IF;

  IF v_valid THEN
    UPDATE campaigns
      SET total_views = total_views + 1,
          valid_views = valid_views + 1,
          total_earnings = total_earnings + v_earning
      WHERE id = p_campaign_id;

    UPDATE profiles
      SET total_views = total_views + 1,
          valid_views = valid_views + 1,
          total_earnings = total_earnings + v_earning,
          pending_earnings = pending_earnings + v_earning
      WHERE id = p_creator_id;

    PERFORM public.recalculate_creator_level(p_creator_id);

    IF v_earning > 0 THEN
      SELECT referred_by INTO v_referrer FROM profiles WHERE id = p_creator_id;
      IF v_referrer IS NOT NULL AND v_referrer <> p_creator_id THEN
        v_pct := COALESCE(p_referral_percentage, v_caps.referral_percentage, 0);
        v_commission := LEAST(GREATEST(v_earning * v_pct / 100.0, 0), v_earning);
        IF v_commission > 0 THEN
          PERFORM public.credit_referral_commission(v_referrer, v_commission, p_creator_id, v_view_id);
        END IF;
      END IF;
    END IF;
  ELSE
    v_category := public.classify_view_outcome('invalid', v_reason);
    v_creator_visible := public.view_category_is_creator_visible(v_category);
    IF v_creator_visible THEN
      UPDATE campaigns SET total_views = total_views + 1, invalid_views = invalid_views + 1
        WHERE id = p_campaign_id;
      UPDATE profiles SET total_views = total_views + 1, invalid_views = invalid_views + 1
        WHERE id = p_creator_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed', TRUE,
    'replayed', FALSE,
    'view_id', v_view_id,
    'valid', v_valid,
    'earning', v_earning,
    'reason', CASE WHEN v_valid THEN NULL ELSE v_reason END,
    'traffic_category', public.classify_view_outcome(v_status::TEXT, CASE WHEN v_valid THEN NULL ELSE v_reason END)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_view_and_credit(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN,
  NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TEXT, INTEGER, TEXT, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_view_and_credit(
  UUID, UUID, INET, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN,
  NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT[], TEXT, INTEGER, TEXT, NUMERIC, TEXT
) TO service_role;

COMMENT ON FUNCTION public.record_view_and_credit IS
  'Atomic view + earning transaction. 0022 adds optional flow session attribution (p_flow_session_id) for qualified monetized-flow completions.';

-- ============================================================
-- 10. ADMIN ANALYTICS RPCs
-- ============================================================
-- All aggregates are computed in the database and gated by is_admin().
-- No raw IP, fingerprint, user agent or session id is ever returned.

-- 10a. Overview: today / 7d / 30d aggregates in one round trip.
CREATE OR REPLACE FUNCTION public.admin_monetization_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  WITH bounds AS (
    SELECT NOW() AS now_ts,
           date_trunc('day', NOW()) AS today_start
  ),
  aggregates AS (
    SELECT
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.today_start AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS today_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '7 days' AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS d7_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_flow_starts,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'destination_visit' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_destinations,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.qualified AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_qualified,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type IN ('step_complete') AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_steps_completed,
      COUNT(*) FILTER (WHERE e.created_at >= b.now_ts - INTERVAL '30 days' AND e.event_type = 'flow_start' AND NOT e.preview_mode
      AND NOT e.test_mode) AS d30_flow_starts_dup
    FROM public.flow_events e, bounds b
  ),
  payouts AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0) AS today_payout,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)  AS d7_payout,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) AS d30_payout
    FROM public.earnings
    WHERE type = 'view_earning'
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ),
  gross AS (
    SELECT
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date = CURRENT_DATE), 0) AS today_gross,
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS d7_gross,
      COALESCE(SUM(revenue) FILTER (WHERE revenue_date >= CURRENT_DATE - INTERVAL '29 days'), 0) AS d30_gross
    FROM public.monetization_revenue
  )
  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'flowStarts', COALESCE(a.today_flow_starts, 0),
      'destinations', COALESCE(a.today_destinations, 0),
      'qualified', COALESCE(a.today_qualified, 0),
      'creatorPayout', COALESCE(p.today_payout, 0),
      'grossRevenue', COALESCE(g.today_gross, 0)
    ),
    'd7', jsonb_build_object(
      'flowStarts', COALESCE(a.d7_flow_starts, 0),
      'destinations', COALESCE(a.d7_destinations, 0),
      'qualified', COALESCE(a.d7_qualified, 0),
      'creatorPayout', COALESCE(p.d7_payout, 0),
      'grossRevenue', COALESCE(g.d7_gross, 0)
    ),
    'd30', jsonb_build_object(
      'flowStarts', COALESCE(a.d30_flow_starts, 0),
      'destinations', COALESCE(a.d30_destinations, 0),
      'qualified', COALESCE(a.d30_qualified, 0),
      'creatorPayout', COALESCE(p.d30_payout, 0),
      'grossRevenue', COALESCE(g.d30_gross, 0),
      'stepsCompleted', COALESCE(a.d30_steps_completed, 0)
    ),
    'completionRate', CASE WHEN COALESCE(a.d30_flow_starts_dup, 0) > 0
      THEN ROUND(COALESCE(a.d30_destinations, 0)::NUMERIC / a.d30_flow_starts_dup * 100, 2) ELSE 0 END
  ) INTO v_result
  FROM aggregates a, payouts p, gross g;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_overview() TO authenticated, service_role;

-- 10b. Funnel: one count per stage.
CREATE OR REPLACE FUNCTION public.admin_monetization_funnel(p_days INTEGER DEFAULT 30)
RETURNS TABLE (stage TEXT, count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH stage_order (stage, ord) AS (
    VALUES ('task_start', 1), ('task_complete', 2), ('unlock', 3),
           ('flow_start', 4), ('step_start', 5), ('step_complete', 6),
           ('destination_visit', 7), ('qualified', 8)
  )
  SELECT s.stage, COALESCE(t.c, 0)::BIGINT
  FROM stage_order s
  LEFT JOIN (
    SELECT event_type AS stage, COUNT(*) AS c
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY event_type
    UNION ALL
    SELECT 'qualified', COUNT(*)
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND qualified AND NOT preview_mode
      AND NOT test_mode
  ) t ON t.stage = s.stage
  ORDER BY s.ord;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_funnel(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_funnel(INTEGER) TO authenticated, service_role;

-- 10c. Step-by-step dropoff.
CREATE OR REPLACE FUNCTION public.admin_monetization_step_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE (step INTEGER, started BIGINT, completed BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(st.step, sc.step, 0)::INTEGER AS step,
    COALESCE(st.started, 0)::BIGINT,
    COALESCE(sc.completed, 0)::BIGINT
  FROM (
    SELECT step, COUNT(*) AS started
    FROM public.flow_events
    WHERE event_type = 'step_start'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY step
  ) st
  FULL OUTER JOIN (
    SELECT step, COUNT(*) AS completed
    FROM public.flow_events
    WHERE event_type = 'step_complete'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND NOT preview_mode
      AND NOT test_mode
    GROUP BY step
  ) sc ON st.step = sc.step
  ORDER BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_step_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_step_stats(INTEGER) TO authenticated, service_role;

-- 10d. Daily trend.
CREATE OR REPLACE FUNCTION public.admin_monetization_daily(p_days INTEGER DEFAULT 14)
RETURNS TABLE (
  day DATE, flow_starts BIGINT, destinations BIGINT, qualified BIGINT,
  creator_payout NUMERIC, gross_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.day,
    COALESCE(e.flow_starts, 0)::BIGINT,
    COALESCE(e.destinations, 0)::BIGINT,
    COALESCE(e.qualified, 0)::BIGINT,
    COALESCE(p.payout, 0)::NUMERIC,
    COALESCE(r.gross, 0)::NUMERIC
  FROM (
    SELECT generate_series(
      (CURRENT_DATE - (v_days - 1))::DATE, CURRENT_DATE::DATE, INTERVAL '1 day'
    )::DATE AS day
  ) d
  LEFT JOIN (
    SELECT date_trunc('day', created_at)::DATE AS day,
           COUNT(*) FILTER (WHERE event_type = 'flow_start') AS flow_starts,
           COUNT(*) FILTER (WHERE event_type = 'destination_visit') AS destinations,
           COUNT(*) FILTER (WHERE qualified) AS qualified
    FROM public.flow_events
    WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL AND NOT preview_mode
      AND NOT test_mode
    GROUP BY 1
  ) e ON e.day = d.day
  LEFT JOIN (
    SELECT date_trunc('day', created_at)::DATE AS day, COALESCE(SUM(amount), 0) AS payout
    FROM public.earnings
    WHERE type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
    GROUP BY 1
  ) p ON p.day = d.day
  LEFT JOIN (
    SELECT revenue_date AS day, COALESCE(SUM(revenue), 0) AS gross
    FROM public.monetization_revenue
    WHERE revenue_date >= CURRENT_DATE - (v_days - 1)
    GROUP BY 1
  ) r ON r.day = d.day
  ORDER BY d.day;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_daily(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_daily(INTEGER) TO authenticated, service_role;

-- 10e. Country + device breakdowns.
CREATE OR REPLACE FUNCTION public.admin_monetization_countries(
  p_days INTEGER DEFAULT 7, p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (country_code TEXT, events BIGINT, qualified BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 7), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(country_code, 'XX')::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE qualified)::BIGINT
  FROM public.flow_events
  WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT preview_mode
      AND NOT test_mode
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_countries(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_countries(INTEGER, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_monetization_devices(p_days INTEGER DEFAULT 7)
RETURNS TABLE (device TEXT, events BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 7), 1), 365);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(device_category, 'unknown')::TEXT,
    COUNT(*)::BIGINT
  FROM public.flow_events
  WHERE created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT preview_mode
      AND NOT test_mode
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_devices(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_devices(INTEGER) TO authenticated, service_role;

-- 10f. Top creators / campaigns by qualified views and payout.
CREATE OR REPLACE FUNCTION public.admin_monetization_top_creators(
  p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (creator_id UUID, username TEXT, qualified BIGINT, payout NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.creator_id,
    COALESCE(p.username, 'user')::TEXT,
    COUNT(*) FILTER (WHERE e.qualified)::BIGINT AS qualified,
    COALESCE(SUM(earn.amount), 0)::NUMERIC AS payout
  FROM public.flow_events e
  LEFT JOIN public.profiles p ON p.id = e.creator_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM public.earnings
    WHERE creator_id = e.creator_id
      AND type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ) earn ON TRUE
  WHERE e.created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT e.preview_mode
      AND NOT e.test_mode
  GROUP BY e.creator_id, p.username
  ORDER BY qualified DESC, payout DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_top_creators(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_top_creators(INTEGER, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_monetization_top_campaigns(
  p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (campaign_id UUID, campaign_name TEXT, slug TEXT, qualified BIGINT, payout NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.campaign_id,
    COALESCE(c.name, 'Campaign')::TEXT,
    COALESCE(c.slug, '')::TEXT,
    COUNT(*) FILTER (WHERE e.qualified)::BIGINT AS qualified,
    COALESCE(SUM(earn.amount), 0)::NUMERIC AS payout
  FROM public.flow_events e
  LEFT JOIN public.campaigns c ON c.id = e.campaign_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM public.earnings
    WHERE campaign_id = e.campaign_id
      AND type = 'view_earning'
      AND created_at >= NOW() - (v_days || ' days')::INTERVAL
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ) earn ON TRUE
  WHERE e.created_at >= NOW() - (v_days || ' days')::INTERVAL
    AND NOT e.preview_mode
      AND NOT e.test_mode
  GROUP BY e.campaign_id, c.name, c.slug
  ORDER BY qualified DESC, payout DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monetization_top_campaigns(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monetization_top_campaigns(INTEGER, INTEGER) TO authenticated, service_role;

-- ============================================================
-- 11. CREATOR ANALYTICS RPCs
-- ============================================================
-- Identity is always derived server-side from auth.uid(). Creators can only
-- ever see their own funnel aggregates; nothing about another creator's
-- traffic, and no preview/test rows leak (those are filtered).

CREATE OR REPLACE FUNCTION public.creator_monetization_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'taskStarts', COALESCE(COUNT(*) FILTER (WHERE event_type = 'task_start'), 0),
    'taskCompletes', COALESCE(COUNT(*) FILTER (WHERE event_type = 'task_complete'), 0),
    'unlocks', COALESCE(COUNT(*) FILTER (WHERE event_type = 'unlock'), 0),
    'flowStarts', COALESCE(COUNT(*) FILTER (WHERE event_type = 'flow_start'), 0),
    'stepCompletes', COALESCE(COUNT(*) FILTER (WHERE event_type = 'step_complete'), 0),
    'destinations', COALESCE(COUNT(*) FILTER (WHERE event_type = 'destination_visit'), 0),
    'qualified', COALESCE(COUNT(*) FILTER (WHERE qualified), 0)
  ) INTO v_result
  FROM public.flow_events
  WHERE creator_id = v_uid
    AND NOT preview_mode
    AND NOT test_mode;

  SELECT jsonb_set(v_result, '{flowEarnings}', to_jsonb(COALESCE((
    SELECT SUM(e.amount)
    FROM public.earnings e
    WHERE e.creator_id = v_uid
      AND e.type = 'view_earning'
      AND e.view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = e.view_id AND v.flow_session_id IS NOT NULL
      )
  ), 0)::NUMERIC)) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creator_monetization_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_monetization_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.creator_monetization_campaign_stats()
RETURNS TABLE (
  campaign_id UUID, campaign_name TEXT, slug TEXT, status TEXT,
  task_starts BIGINT, task_completes BIGINT, unlocks BIGINT,
  flow_starts BIGINT, step_completes BIGINT, destinations BIGINT,
  qualified BIGINT, earnings NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id AS campaign_id,
    c.name AS campaign_name,
    c.slug,
    COALESCE(c.status::TEXT, 'unknown'),
    COUNT(e.*) FILTER (WHERE e.event_type = 'task_start')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.event_type = 'task_complete')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.event_type = 'unlock')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.event_type = 'flow_start')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.event_type = 'step_complete')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.event_type = 'destination_visit')::BIGINT,
    COUNT(e.*) FILTER (WHERE e.qualified)::BIGINT,
    COALESCE(earn.amount, 0)::NUMERIC
  FROM public.campaigns c
  LEFT JOIN public.flow_events e
    ON e.campaign_id = c.id AND e.creator_id = v_uid AND NOT e.preview_mode AND NOT e.test_mode
      AND NOT e.test_mode
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS amount
    FROM public.earnings
    WHERE campaign_id = c.id
      AND creator_id = v_uid
      AND type = 'view_earning'
      AND view_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.views v
        WHERE v.id = earnings.view_id AND v.flow_session_id IS NOT NULL
      )
  ) earn ON TRUE
  WHERE c.creator_id = v_uid
    AND c.deleted_at IS NULL
  GROUP BY c.id, c.name, c.slug, c.status, earn.amount
  ORDER BY COALESCE(earn.amount, 0) DESC, c.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creator_monetization_campaign_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_monetization_campaign_stats() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.creator_monetization_countries(
  p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (country_code TEXT, events BIGINT, qualified BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(country_code, 'XX')::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE qualified)::BIGINT
  FROM public.flow_events
  WHERE creator_id = v_uid
    AND NOT preview_mode
      AND NOT test_mode
    AND created_at >= NOW() - (v_days || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creator_monetization_countries(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_monetization_countries(INTEGER, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.creator_monetization_devices(p_days INTEGER DEFAULT 30)
RETURNS TABLE (device TEXT, events BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(device_category, 'unknown')::TEXT,
    COUNT(*)::BIGINT
  FROM public.flow_events
  WHERE creator_id = v_uid
    AND NOT preview_mode
      AND NOT test_mode
    AND created_at >= NOW() - (v_days || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creator_monetization_devices(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_monetization_devices(INTEGER) TO authenticated, service_role;

-- ============================================================
-- 12. STEP REORDERING (transactional, admin only)
-- ============================================================
-- Reorders steps so the public flow follows the configured order without a
-- deployment. Runs in one transaction: a partial failure rolls everything
-- back and leaves the previous order intact. New positions start at 1.
CREATE OR REPLACE FUNCTION public.reorder_monetization_steps(p_ids INTEGER[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id INTEGER;
  v_pos INTEGER;
  v_total INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.monetization_steps;
  IF v_total = 0 OR COALESCE(array_length(p_ids, 1), 0) <> v_total THEN
    RAISE EXCEPTION 'Reorder list must contain every step exactly once'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (SELECT COUNT(DISTINCT x) FROM unnest(p_ids) AS x) <> v_total THEN
    RAISE EXCEPTION 'Reorder list contains duplicates' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) AS x
    WHERE NOT EXISTS (SELECT 1 FROM public.monetization_steps s WHERE s.id = x)
  ) THEN
    RAISE EXCEPTION 'Reorder list contains unknown steps' USING ERRCODE = 'check_violation';
  END IF;

  -- Free the occupied positions first (negatives cannot collide with the
  -- 1..12 CHECK constraint range), then assign the final order.
  v_pos := 0;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_pos := v_pos - 1;
    UPDATE public.monetization_steps SET position = v_pos WHERE id = v_id;
  END LOOP;

  v_pos := 0;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_pos := v_pos + 1;
    UPDATE public.monetization_steps SET position = v_pos WHERE id = v_id;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'count', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_monetization_steps(INTEGER[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_monetization_steps(INTEGER[]) TO authenticated, service_role;

-- ============================================================
-- End migration 0022
-- ============================================================
