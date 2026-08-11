-- ============================================================
-- CreatorBoost Migration 0003 — Schema Alignment
-- ------------------------------------------------------------
-- Brings the database schema into alignment with the application
-- code. The app referenced columns/tables that did not exist:
--   * campaigns.deleted_at          (soft delete)
--   * campaigns.task_metadata       (task configuration JSON)
--   * withdrawal_method_config      (per-method withdrawal settings)
-- Also adds the earnings-lifecycle columns to `profiles` so the
-- balance model can separate pending earnings, available balance
-- and in-transit withdrawal hold.
--
-- Idempotent (safe to re-run on a fresh project).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. campaigns: soft-delete + task metadata
-- ------------------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS task_metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_creator_deleted
  ON campaigns(creator_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_status_deleted
  ON campaigns(status, deleted_at);

-- ------------------------------------------------------------------
-- 2. withdrawal_method_config  (per-method limits / fees / enabled)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawal_method_config (
  id             SERIAL PRIMARY KEY,
  method         TEXT UNIQUE NOT NULL,
  label          TEXT NOT NULL,
  icon           TEXT DEFAULT '💳',
  enabled        BOOLEAN DEFAULT TRUE NOT NULL,
  min_amount     NUMERIC(10,2) DEFAULT 1.00 NOT NULL,
  max_amount     NUMERIC(10,2) DEFAULT 10000.00 NOT NULL,
  fee_percentage NUMERIC(5,2)  DEFAULT 0 NOT NULL,
  sort_order     INTEGER DEFAULT 0 NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO withdrawal_method_config (method, label, icon, min_amount, max_amount, fee_percentage, sort_order) VALUES
  ('jazzcash', 'JazzCash',      '💳', 1, 10000, 0, 1),
  ('easypaisa','EasyPaisa',     '💳', 1, 10000, 0, 2),
  ('paypal',   'PayPal',        '💳', 1, 10000, 2, 3),
  ('binance',  'Binance Pay',   '💳', 1, 10000, 0, 4),
  ('usdt',     'USDT (TRC20)',  '🪙', 1, 10000, 0, 5),
  ('bank',     'Bank Transfer', '🏦', 10, 100000, 1, 6)
ON CONFLICT (method) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_wmc_enabled ON withdrawal_method_config(enabled, sort_order);

-- ------------------------------------------------------------------
-- 3. profiles: earnings-lifecycle columns
--    pending_earnings   -> earnings awaiting the holding-period release
--    withdrawal_hold    -> amount locked inside an in-progress withdrawal
--    (available_balance stays as the withdrawable amount)
--    (pending_balance   -> legacy; no longer written by the engine)
-- ------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pending_earnings NUMERIC(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS withdrawal_hold NUMERIC(12,2) DEFAULT 0 NOT NULL;

-- ------------------------------------------------------------------
-- 4. platform_settings: earnings-caps (configurable, all enforced
--    server-side by the earnings engine)
-- ------------------------------------------------------------------
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS max_earnings_per_view NUMERIC(10,4) DEFAULT 1.0000 NOT NULL,
  ADD COLUMN IF NOT EXISTS max_views_per_device_per_day INTEGER DEFAULT 20 NOT NULL,
  ADD COLUMN IF NOT EXISTS max_views_per_ip_per_day INTEGER DEFAULT 200 NOT NULL,
  ADD COLUMN IF NOT EXISTS creator_daily_earning_cap NUMERIC(12,2) DEFAULT 500.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS campaign_daily_earning_cap NUMERIC(12,2) DEFAULT 200.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS platform_daily_earning_cap NUMERIC(12,2) DEFAULT 10000.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS earning_holding_hours INTEGER DEFAULT 24 NOT NULL,
  ADD COLUMN IF NOT EXISTS support_email TEXT DEFAULT 'support@creatorboost.io';

-- ------------------------------------------------------------------
-- 5. views: idempotency key (replay protection) + device hash column
-- ------------------------------------------------------------------
ALTER TABLE views ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE views ADD COLUMN IF NOT EXISTS ip_hash TEXT;

-- A replayed request (same creator + idempotency key) must not create
-- a second earning. NULL keys are excluded from uniqueness so the
-- constraint is optional/idempotent-only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_views_creator_idempotency
  ON views(creator_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Speed up duplicate + cap lookups
CREATE INDEX IF NOT EXISTS idx_views_creator_created ON views(creator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_views_creator_ip_hash  ON views(creator_id, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_views_campaign_created ON views(campaign_id, created_at);
