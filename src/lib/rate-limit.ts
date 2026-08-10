/**
 * Simple in-memory rate limiter.
 * For production, replace with Upstash Redis + @upstash/ratelimit.
 */
const store = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
