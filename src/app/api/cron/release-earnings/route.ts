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
 * Releases only matured earnings. Vercel Cron sends Authorization: Bearer
 * CRON_SECRET; external schedulers can continue using x-cron-secret.
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
    return NextResponse.json({ ok: true, creatorsReleased: Number(data) || 0 });
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
