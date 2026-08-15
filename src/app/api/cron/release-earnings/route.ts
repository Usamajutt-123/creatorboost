import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

function matchesSecret(candidate: string | null, secret: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Scheduled maintenance job (Vercel Cron, see vercel.json).
 *
 *  1. Releases matured earnings (pending -> available).
 *  2. Prunes expired rate-limit windows.
 *
 * `cleanup_rate_limits()` has existed since migration 0017 but was never
 * scheduled, so `rate_limit_entries` grew without bound — one row per
 * (key, window) forever, slowing every `check_rate_limit()` upsert. It runs
 * here rather than on its own cron entry because it is a cheap DELETE and the
 * existing schedule/authorization is already in place.
 *
 * The cleanup is BEST EFFORT: a failure is logged and reported, but it never
 * fails the earnings release, which is the financially important half.
 *
 * Vercel Cron sends Authorization: Bearer CRON_SECRET; external schedulers
 * can continue using x-cron-secret.
 */
async function release(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 });
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  if (!matchesSecret(request.headers.get('x-cron-secret'), secret) && !matchesSecret(bearer, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('release_matured_earnings');
    if (error) {
      console.error('[cron] release_matured_earnings failed', error);
      return NextResponse.json({ error: 'Release failed' }, { status: 500 });
    }

    let rateLimitsPruned: number | null = null;
    try {
      const { data: pruned, error: cleanupError } = await supabase.rpc('cleanup_rate_limits');
      if (cleanupError) console.error('[cron] cleanup_rate_limits failed', cleanupError);
      else rateLimitsPruned = Number(pruned) || 0;
    } catch (cleanupError) {
      console.error('[cron] cleanup_rate_limits threw', cleanupError);
    }

    return NextResponse.json({
      ok: true,
      creatorsReleased: Number(data) || 0,
      rateLimitsPruned,
    });
  } catch (error) {
    console.error('[cron] unexpected error', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return release(request);
}

export async function POST(request: NextRequest) {
  return release(request);
}
