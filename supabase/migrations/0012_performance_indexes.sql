-- ============================================================
-- CreatorBoost Migration 0012 — Performance Indexes
-- ------------------------------------------------------------
-- Targeted indexes for the exact filter/sort patterns the app
-- runs on every authenticated request. Each index below serves
-- at least one real query (see usage notes); nothing speculative.
--
-- Idempotent (safe to re-run). No schema, policy, or data
-- changes — read/write behavior is identical, only index access
-- changes.
-- ============================================================

-- Dashboard: `earnings WHERE creator_id = X [AND created_at >= T]
--            [ORDER BY created_at DESC LIMIT n]`
-- Used by /dashboard (today/yesterday/week totals, recent activity,
-- 30-day chart), /dashboard/analytics equivalents, and the admin
-- user detail modal. Previously the planner had to choose between
-- idx_earnings_creator(creator_id) and idx_earnings_created
-- (created_at) and could not serve both the equality and the range
-- in one scan.
CREATE INDEX IF NOT EXISTS idx_earnings_creator_created
  ON earnings(creator_id, created_at DESC);

-- Admin withdrawals queue: `ORDER BY created_at DESC LIMIT 200`
-- and creator history: `WHERE user_id = X ORDER BY created_at DESC`.
-- The old idx_withdrawals_user(user_id) served the equality but not
-- the sort.
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at
  ON withdrawals(created_at DESC);

-- Admin campaign management: `ORDER BY created_at DESC LIMIT 200`
-- (also the first key of the announcement picker's profile search).
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
  ON campaigns(created_at DESC);

-- Admin user management: `ORDER BY created_at DESC LIMIT 200` and
-- the announcement creator picker `ORDER BY created_at DESC LIMIT 50`.
CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON profiles(created_at DESC);

-- Admin support queue: `ORDER BY updated_at DESC LIMIT 200`.
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at
  ON support_tickets(updated_at DESC);

-- Admin ticket detail: `ticket_messages WHERE ticket_id IN (...)
-- ORDER BY created_at` (the ticket_messages table previously had no
-- index on its join column at all).
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
  ON ticket_messages(ticket_id, created_at);
