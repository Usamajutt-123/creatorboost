-- ============================================================
-- CreatorBoost Seed Data & Admin Setup
-- Run AFTER migrations to set up the first admin user
-- ============================================================

-- Promote a user to super_admin (replace email)
-- UPDATE profiles SET role = 'super_admin' WHERE email = 'you@example.com';

-- Add an announcement (visible site-wide)
INSERT INTO announcements (title, body, type, active, starts_at)
VALUES (
  'Welcome to CreatorBoost!',
  'Start creating campaigns and earn from every valid view. Reach Gold tier to unlock 25% higher CPM rates!',
  'info',
  true,
  NOW()
);

-- Make sure platform_settings row exists (it should from migration)
INSERT INTO platform_settings (id, site_name, site_tagline, support_email, min_withdrawal, referral_percentage)
VALUES (1, 'CreatorBoost', 'Grow Your Audience. Earn From Every Valid View.', 'support@creatorboost.io', 10.00, 10.00)
ON CONFLICT (id) DO NOTHING;

-- Verify country tiers
SELECT tier, COUNT(*) as countries, AVG(cpm_default) as avg_cpm
FROM country_tiers
GROUP BY tier
ORDER BY tier;

-- Verify levels
SELECT name, min_views, cpm_multiplier FROM creator_levels ORDER BY min_views;
