/**
 * Rate limiting.
 *
 * Default store is in-memory (per process instance) which is adequate for
 * single-instance deployments and always available. For multi-instance
 * production use a distributed store (Upstash Redis) by injecting a custom
 * store via `setRateLimitStore`, or point `RATE_LIMIT_TABLE` at a Supabase
 * table. The interface is async so swapping the store is non-breaking.
 *
 * NOTE: this is a best-effort abuse-control layer, NOT the only defense.
 * Financial decisions never rely on it (see earnings engine).
 */

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();
let distributed: ((key: string, limit: number, windowMs: number) => Promise<boolean>) | null = null;

export function setRateLimitStore(fn: (key: string, limit: number, windowMs: number) => Promise<boolean>) {
  distributed = fn;
}

let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of store) {
    if (v.resetAt < now) store.delete(k);
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (distributed) return distributed(key, limit, windowMs);

  const now = Date.now();
  sweep(now);
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
