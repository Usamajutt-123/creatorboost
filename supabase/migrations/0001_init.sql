-- ============================================================
-- CreatorBoost Database Schema
-- All CPM, payout, and configuration values are dynamic
-- and managed by the admin through the dashboard.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- for geo / country lookups

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TYPE user_role AS ENUM ('creator', 'admin', 'super_admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'pending_verification');
CREATE TYPE user_level AS ENUM ('bronze', 'silver', 'gold', 'platinum', 'diamond');

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  email TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  country_code CHAR(2),
  role user_role DEFAULT 'creator' NOT NULL,
  status user_status DEFAULT 'pending_verification' NOT NULL,
  level user_level DEFAULT 'bronze' NOT NULL,

  -- Earnings (denormalized for fast reads)
  total_earnings NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  available_balance NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  referral_earnings NUMERIC(12, 2) DEFAULT 0 NOT NULL,

  -- Stats
  total_views BIGINT DEFAULT 0 NOT NULL,
  valid_views BIGINT DEFAULT 0 NOT NULL,
  invalid_views BIGINT DEFAULT 0 NOT NULL,

  -- 2FA
  two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  two_factor_secret TEXT,

  -- Referral
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Metadata
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_profiles_referral_code ON profiles(referral_code);
CREATE INDEX idx_profiles_referred_by ON profiles(referred_by);
CREATE INDEX idx_profiles_level ON profiles(level);
CREATE INDEX idx_profiles_country ON profiles(country_code);

-- ============================================================
-- 2. PLATFORM SETTINGS (single-row, fully configurable)
-- ============================================================
CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforce single row

  -- Brand
  site_name TEXT DEFAULT 'CreatorBoost' NOT NULL,
  site_tagline TEXT,
  support_email TEXT,
  site_announcement TEXT,
  site_announcement_active BOOLEAN DEFAULT FALSE NOT NULL,

  -- Withdrawal
  min_withdrawal NUMERIC(10, 2) DEFAULT 10.00 NOT NULL,
  withdrawal_methods TEXT[] DEFAULT ARRAY['jazzcash','easypaisa','paypal','binance','usdt','bank'] NOT NULL,

  -- Referral
  referral_percentage NUMERIC(5, 2) DEFAULT 10.00 NOT NULL,

  -- Fraud
  fraud_detection_sensitivity TEXT DEFAULT 'medium' CHECK (fraud_detection_sensitivity IN ('low','medium','high','strict')),
  vpn_block_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  duplicate_device_block BOOLEAN DEFAULT TRUE NOT NULL,
  duplicate_ip_window_hours INTEGER DEFAULT 24 NOT NULL,

  -- Maintenance
  maintenance_mode BOOLEAN DEFAULT FALSE NOT NULL,
  signup_enabled BOOLEAN DEFAULT TRUE NOT NULL,

  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO platform_settings (id) VALUES (1);

-- ============================================================
-- 3. COUNTRY TIERS (dynamic CPM rates per country)
-- ============================================================
CREATE TYPE tier_name AS ENUM ('tier_1', 'tier_2', 'tier_3', 'tier_4');

CREATE TABLE country_tiers (
  id SERIAL PRIMARY KEY,
  country_code CHAR(2) UNIQUE NOT NULL,
  country_name TEXT NOT NULL,
  tier tier_name NOT NULL,

  -- Dynamic CPM in USD (set by admin)
  cpm_min NUMERIC(6, 2) NOT NULL,
  cpm_max NUMERIC(6, 2) NOT NULL,
  cpm_default NUMERIC(6, 2) NOT NULL,

  -- Payout percentage (admin can override per country)
  payout_percentage NUMERIC(5, 2) DEFAULT 70.00 NOT NULL,

  active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_country_tiers_tier ON country_tiers(tier);
CREATE INDEX idx_country_tiers_code ON country_tiers(country_code);

-- Seed with default tier rates (admin can override anytime)
INSERT INTO country_tiers (country_code, country_name, tier, cpm_min, cpm_max, cpm_default) VALUES
  -- Tier 1
  ('US','United States','tier_1',4.00,6.00,5.00),
  ('CA','Canada','tier_1',4.00,6.00,5.00),
  ('GB','United Kingdom','tier_1',4.00,6.00,5.00),
  ('DE','Germany','tier_1',4.00,6.00,5.00),
  ('AU','Australia','tier_1',4.00,6.00,5.00),
  ('NZ','New Zealand','tier_1',4.00,6.00,5.00),
  ('CH','Switzerland','tier_1',4.50,6.50,5.50),
  ('NO','Norway','tier_1',4.00,6.00,5.00),
  ('SE','Sweden','tier_1',4.00,6.00,5.00),
  ('DK','Denmark','tier_1',4.00,6.00,5.00),
  -- Tier 2
  ('FR','France','tier_2',2.00,3.50,2.75),
  ('IT','Italy','tier_2',2.00,3.50,2.75),
  ('ES','Spain','tier_2',2.00,3.50,2.75),
  ('AE','UAE','tier_2',2.50,4.00,3.25),
  ('SA','Saudi Arabia','tier_2',2.00,3.50,2.75),
  ('JP','Japan','tier_2',2.50,4.00,3.25),
  ('KR','South Korea','tier_2',2.00,3.50,2.75),
  ('SG','Singapore','tier_2',2.50,4.00,3.25),
  ('BE','Belgium','tier_2',2.00,3.50,2.75),
  ('NL','Netherlands','tier_2',2.50,4.00,3.25),
  -- Tier 3
  ('IN','India','tier_3',0.50,1.50,1.00),
  ('PK','Pakistan','tier_3',0.50,1.50,1.00),
  ('BD','Bangladesh','tier_3',0.50,1.50,1.00),
  ('ID','Indonesia','tier_3',0.50,1.50,1.00),
  ('BR','Brazil','tier_3',0.50,1.50,1.00),
  ('MX','Mexico','tier_3',0.50,1.50,1.00),
  ('PH','Philippines','tier_3',0.50,1.50,1.00),
  ('EG','Egypt','tier_3',0.50,1.20,0.85),
  ('NG','Nigeria','tier_3',0.50,1.20,0.85),
  ('VN','Vietnam','tier_3',0.50,1.20,0.85),
  ('TR','Turkey','tier_3',0.50,1.50,1.00),
  ('TH','Thailand','tier_3',0.50,1.20,0.85);

-- ============================================================
-- 4. CREATOR LEVELS (Bronze → Diamond, all editable)
-- ============================================================
CREATE TABLE creator_levels (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  level user_level UNIQUE NOT NULL,
  min_views BIGINT NOT NULL,
  cpm_multiplier NUMERIC(4, 2) DEFAULT 1.00 NOT NULL, -- applied on top of country tier
  perks JSONB DEFAULT '[]'::jsonb NOT NULL,
  badge_color TEXT DEFAULT '#8b5cf6' NOT NULL,
  priority_support BOOLEAN DEFAULT FALSE NOT NULL,
  fast_withdrawal BOOLEAN DEFAULT FALSE NOT NULL,
  verified_badge BOOLEAN DEFAULT FALSE NOT NULL,
  premium_analytics BOOLEAN DEFAULT FALSE NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO creator_levels (name, level, min_views, cpm_multiplier, perks, badge_color, priority_support, fast_withdrawal, verified_badge, premium_analytics, sort_order) VALUES
  ('Bronze','bronze',0,1.00,'["Basic CPM rates","Standard support"]','#cd7f32',FALSE,FALSE,FALSE,FALSE,1),
  ('Silver','silver',100000,1.10,'["+10% CPM","Priority queue"]','#c0c0c0',FALSE,FALSE,FALSE,FALSE,2),
  ('Gold','gold',1000000,1.25,'["+25% CPM","Verified badge","Priority support"]','#ffd700',TRUE,FALSE,TRUE,FALSE,3),
  ('Platinum','platinum',5000000,1.50,'["+50% CPM","Fast withdrawals","Premium analytics"]','#8b5cf6',TRUE,TRUE,TRUE,TRUE,4),
  ('Diamond','diamond',10000000,2.00,'["+100% CPM","VIP support","Custom features","Account manager"]','#60a5fa',TRUE,TRUE,TRUE,TRUE,5);

-- ============================================================
-- 5. AD NETWORKS (revenue sources)
-- ============================================================
CREATE TYPE ad_network_status AS ENUM ('active', 'paused', 'inactive');

CREATE TABLE ad_networks (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status ad_network_status DEFAULT 'active' NOT NULL,

  -- API configuration (stored encrypted in production)
  api_key TEXT,
  publisher_id TEXT,

  -- Revenue stats (auto-updated)
  total_revenue NUMERIC(14, 2) DEFAULT 0 NOT NULL,
  monthly_revenue NUMERIC(14, 2) DEFAULT 0 NOT NULL,
  avg_cpm NUMERIC(8, 4) DEFAULT 0 NOT NULL,

  -- Weight for traffic distribution
  weight INTEGER DEFAULT 50 NOT NULL CHECK (weight BETWEEN 0 AND 100),

  -- Geographic targeting
  allowed_countries TEXT[] DEFAULT ARRAY[]::TEXT[],
  blocked_countries TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Fill rate
  fill_rate NUMERIC(5, 2) DEFAULT 95.00 NOT NULL,

  config JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO ad_networks (name, slug, weight, fill_rate, avg_cpm) VALUES
  ('Monetag','monetag',40,96.5,1.20),
  ('Adsterra','adsterra',30,94.2,0.95),
  ('Google AdSense','adsense',25,98.1,2.40),
  ('HilltopAds','hilltopads',5,89.0,0.60);

-- ============================================================
-- 6. CAMPAIGNS
-- ============================================================
CREATE TYPE campaign_status AS ENUM ('draft','active','paused','expired','banned');
CREATE TYPE campaign_category AS ENUM ('youtube_growth','instagram_growth','tiktok_growth','telegram_growth','discord_growth','website_traffic','app_install','other');

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category campaign_category DEFAULT 'other' NOT NULL,
  destination_url TEXT NOT NULL,

  -- Media
  thumbnail_url TEXT,
  banner_url TEXT,

  -- Status
  status campaign_status DEFAULT 'draft' NOT NULL,

  -- Tasks (array of task types)
  tasks TEXT[] DEFAULT '{}' NOT NULL,

  -- Aggregated stats
  total_views BIGINT DEFAULT 0 NOT NULL,
  valid_views BIGINT DEFAULT 0 NOT NULL,
  invalid_views BIGINT DEFAULT 0 NOT NULL,
  total_earnings NUMERIC(12, 2) DEFAULT 0 NOT NULL,

  -- Settings
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_campaigns_creator ON campaigns(creator_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_slug ON campaigns(slug);

-- ============================================================
-- 7. VIEWS (the heart of the earnings engine)
-- ============================================================
CREATE TYPE view_status AS ENUM ('pending','valid','invalid','flagged');
CREATE TYPE invalid_reason AS ENUM ('bot','vpn','proxy','emulator','duplicate_device','duplicate_ip','click_spam','abnormal_traffic','other');

CREATE TABLE views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Visitor
  visitor_ip INET,
  country_code CHAR(2),
  device_fingerprint TEXT,
  user_agent TEXT,

  -- Fraud signals
  is_vpn BOOLEAN DEFAULT FALSE NOT NULL,
  is_proxy BOOLEAN DEFAULT FALSE NOT NULL,
  is_bot BOOLEAN DEFAULT FALSE NOT NULL,
  is_emulator BOOLEAN DEFAULT FALSE NOT NULL,
  fraud_score NUMERIC(5, 2) DEFAULT 0 NOT NULL,

  -- Status
  status view_status DEFAULT 'pending' NOT NULL,
  invalid_reason invalid_reason,

  -- Earnings (denormalized for fast aggregation)
  cpm_rate NUMERIC(8, 4),
  earnings NUMERIC(10, 6) DEFAULT 0 NOT NULL,

  -- Tasks completed
  tasks_completed JSONB DEFAULT '[]'::jsonb NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  validated_at TIMESTAMPTZ
);

CREATE INDEX idx_views_campaign ON views(campaign_id);
CREATE INDEX idx_views_creator ON views(creator_id);
CREATE INDEX idx_views_status ON views(status);
CREATE INDEX idx_views_created ON views(created_at DESC);
CREATE INDEX idx_views_ip ON views(visitor_ip);
CREATE INDEX idx_views_device ON views(device_fingerprint);
CREATE INDEX idx_views_country ON views(country_code);

-- ============================================================
-- 8. EARNINGS LEDGER (immutable, append-only)
-- ============================================================
CREATE TYPE earning_type AS ENUM ('view_earning','referral_bonus','level_bonus','admin_adjustment','refund');

CREATE TABLE earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  view_id UUID REFERENCES views(id) ON DELETE SET NULL,

  type earning_type NOT NULL,
  amount NUMERIC(12, 6) NOT NULL,
  currency CHAR(3) DEFAULT 'USD' NOT NULL,

  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_earnings_creator ON earnings(creator_id);
CREATE INDEX idx_earnings_created ON earnings(created_at DESC);
CREATE INDEX idx_earnings_type ON earnings(type);

-- ============================================================
-- 9. WITHDRAWALS
-- ============================================================
CREATE TYPE withdraw_method AS ENUM ('jazzcash','easypaisa','paypal','binance','usdt','bank');
CREATE TYPE withdraw_status AS ENUM ('pending','approved','rejected','paid','cancelled');

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) DEFAULT 'USD' NOT NULL,
  method withdraw_method NOT NULL,

  -- Account details (encrypted in production)
  account_details JSONB NOT NULL,

  status withdraw_status DEFAULT 'pending' NOT NULL,
  rejection_reason TEXT,
  transaction_id TEXT,
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- ============================================================
-- 10. REFERRALS
-- ============================================================
CREATE TYPE referral_status AS ENUM ('active','inactive');

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  total_clicks BIGINT DEFAULT 0 NOT NULL,
  total_commission NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  status referral_status DEFAULT 'active' NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(referrer_id, referred_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referred ON referrals(referred_id);

CREATE TABLE referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code TEXT NOT NULL,
  visitor_ip INET,
  user_agent TEXT,
  country_code CHAR(2),
  converted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_referral_clicks_code ON referral_clicks(referral_code);
CREATE INDEX idx_referral_clicks_created ON referral_clicks(created_at DESC);

-- ============================================================
-- 11. NOTIFICATIONS
-- ============================================================
CREATE TYPE notification_type AS ENUM ('earning','withdrawal','campaign','referral','system','announcement');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read BOOLEAN DEFAULT FALSE NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ============================================================
-- 12. SUPPORT TICKETS
-- ============================================================
CREATE TYPE ticket_status AS ENUM ('open','in_progress','resolved','closed');
CREATE TYPE ticket_priority AS ENUM ('low','medium','high','urgent');

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  status ticket_status DEFAULT 'open' NOT NULL,
  priority ticket_priority DEFAULT 'medium' NOT NULL,
  assigned_to UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 13. ANNOUNCEMENTS
-- ============================================================
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT DEFAULT 'info' NOT NULL,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 14. AUDIT LOG (admin actions)
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ============================================================
-- 15. SESSIONS / DEVICE TRACKING (for fraud detection)
-- ============================================================
CREATE TABLE device_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  country_code CHAR(2),
  first_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  visit_count INTEGER DEFAULT 1 NOT NULL,
  flagged BOOLEAN DEFAULT FALSE NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX idx_devices_fingerprint ON device_fingerprints(fingerprint);
CREATE INDEX idx_devices_ip ON device_fingerprints(ip_address);

-- ============================================================
-- TRIGGERS & FUNCTIONS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_code TEXT;
  ref_by UUID;
BEGIN
  -- generate unique referral code
  ref_code := lower(substring(md5(new.id::text || new.email), 1, 8));
  WHILE EXISTS (SELECT 1 FROM profiles WHERE referral_code = ref_code) LOOP
    ref_code := lower(substring(md5(random()::text), 1, 8));
  END LOOP;

  -- check referred_by
  IF new.raw_user_meta_data->>'referral_code' IS NOT NULL THEN
    SELECT id INTO ref_by FROM profiles WHERE referral_code = new.raw_user_meta_data->>'referral_code';
  END IF;

  INSERT INTO public.profiles (id, username, full_name, email, referral_code, referred_by, country_code)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'username', 'user_' || substring(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'full_name',
    new.email,
    ref_code,
    ref_by,
    new.raw_user_meta_data->>'country_code'
  );

  -- create referral record if applicable
  IF ref_by IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id) VALUES (ref_by, new.id);
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_withdrawals_updated BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_country_tiers_updated BEFORE UPDATE ON country_tiers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_creator_levels_updated BEFORE UPDATE ON creator_levels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ad_networks_updated BEFORE UPDATE ON ad_networks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE views ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "public_read_country_tiers" ON country_tiers FOR SELECT USING (active = true);
CREATE POLICY "public_read_creator_levels" ON creator_levels FOR SELECT USING (active = true);
CREATE POLICY "public_read_ad_networks" ON ad_networks FOR SELECT USING (status = 'active');
CREATE POLICY "public_read_announcements" ON announcements FOR SELECT USING (active = true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()));
CREATE POLICY "public_read_platform_settings" ON platform_settings FOR SELECT USING (true);

-- Profile policies
CREATE POLICY "users_read_own_profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own_profile" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "public_read_username" ON profiles FOR SELECT USING (true); -- public usernames

-- Campaign policies
CREATE POLICY "public_read_active_campaigns" ON campaigns FOR SELECT USING (status = 'active' OR auth.uid() = creator_id);
CREATE POLICY "creators_manage_own_campaigns" ON campaigns FOR ALL USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);

-- Views policies (creators see their own)
CREATE POLICY "creators_read_own_views" ON views FOR SELECT USING (auth.uid() = creator_id);
CREATE POLICY "public_insert_views" ON views FOR INSERT WITH CHECK (true);

-- Earnings
CREATE POLICY "users_read_own_earnings" ON earnings FOR SELECT USING (auth.uid() = creator_id);

-- Withdrawals
CREATE POLICY "users_manage_own_withdrawals" ON withdrawals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Referrals
CREATE POLICY "users_read_own_referrals" ON referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "public_insert_referral_clicks" ON referral_clicks FOR INSERT WITH CHECK (true);

-- Notifications
CREATE POLICY "users_read_own_notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_update_own_notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- Tickets
CREATE POLICY "users_manage_own_tickets" ON support_tickets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_read_own_ticket_messages" ON ticket_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
);
CREATE POLICY "users_insert_own_ticket_messages" ON ticket_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
);

-- Devices
CREATE POLICY "public_insert_devices" ON device_fingerprints FOR INSERT WITH CHECK (true);

-- ============================================================
-- HELPER VIEWS (for analytics)
-- ============================================================

-- Daily earnings summary per creator
CREATE OR REPLACE VIEW daily_earnings_summary AS
SELECT
  creator_id,
  DATE_TRUNC('day', created_at) AS day,
  SUM(amount) AS total_earned,
  COUNT(*) AS event_count
FROM earnings
WHERE type = 'view_earning'
GROUP BY creator_id, DATE_TRUNC('day', created_at);

-- Country traffic summary
CREATE OR REPLACE VIEW country_traffic_summary AS
SELECT
  v.creator_id,
  v.country_code,
  COUNT(*) AS total_views,
  COUNT(*) FILTER (WHERE v.status = 'valid') AS valid_views,
  COUNT(*) FILTER (WHERE v.status = 'invalid') AS invalid_views,
  SUM(v.earnings) AS total_earnings
FROM views v
GROUP BY v.creator_id, v.country_code;

-- Platform-wide stats (admin only)
CREATE OR REPLACE VIEW platform_stats AS
SELECT
  (SELECT COUNT(*) FROM profiles WHERE role = 'creator') AS total_creators,
  (SELECT COUNT(*) FROM campaigns WHERE status = 'active') AS active_campaigns,
  (SELECT COALESCE(SUM(amount), 0) FROM earnings WHERE type = 'view_earning') AS total_payouts,
  (SELECT COALESCE(SUM(total_revenue), 0) FROM ad_networks) AS total_ad_revenue,
  (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = 'pending') AS pending_withdrawals,
  (SELECT COUNT(*) FROM views WHERE created_at > NOW() - INTERVAL '24 hours') AS views_24h;

-- ============================================================
-- DONE
-- ============================================================
