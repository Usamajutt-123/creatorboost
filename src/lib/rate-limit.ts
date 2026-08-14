/**
 * Rate limiting.
 *
 * The primary store is a Supabase database-backed atomic rate limiter that
 * works across multiple serverless instances. An in-memory Map serves as a
 * local fast-path / fallback when the database is unavailable.
 *
 * The interface is async so swapping the store is non-breaking.
 *
 * NOTE: this is a best-effort abuse-control layer, NOT the only defense.
 * Financial decisions never rely on it (see earnings engine).
 */

import { createAdminClient } from './supabase/server';

type Entry = { count: number; resetAt: number };

/** In-memory fallback store (per-process only). */
const localStore = new Map<string, Entry>();
let lastSweep = 0;

function sweepLocal(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of localStore) {
    if (v.resetAt < now) localStore.delete(k);
  }
}

/**
 * Optional custom store injection (for tests or alternative backends).
 * When set, this overrides both local and Supabase stores.
 */
let customStore: ((key: string, limit: number, windowMs: number) => Promise<boolean>) | null = null;

export function setRateLimitStore(fn: (key: string, limit: number, windowMs: number) => Promise<boolean>) {
  customStore = fn;
}

/**
 * Database-backed rate limit check using the atomic `check_rate_limit` RPC.
 * Returns true if the request is within the limit, false if over.
 * On any database error, falls through to the local store.
 */
async function supabaseRateLimit(key: string, limit: number, windowMs: number): Promise<boolean | null> {
  try {
    const client = createAdminClient();
    // Convert windowMs to seconds for the RPC.
    const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
    const { data, error } = await client.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return null; // fall through to local
    return data === true;
  } catch {
    return null; // fall through to local
  }
}

/**
 * Check rate limit. Prefers: custom store > Supabase > in-memory local.
 * The local fallback ensures the API never silently disables rate limiting.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  // 1. Custom store (for tests).
  if (customStore) return customStore(key, limit, windowMs);

  // 2. Supabase-backed distributed store (works across instances).
  const dbResult = await supabaseRateLimit(key, limit, windowMs);
  if (dbResult !== null) return dbResult;

  // 3. In-memory fallback (single-instance only — better than nothing).
  const now = Date.now();
  sweepLocal(now);
  const entry = localStore.get(key);
  if (!entry || entry.resetAt < now) {
    localStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
