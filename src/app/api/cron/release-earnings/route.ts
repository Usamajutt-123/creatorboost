import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/cron/release-earnings
 *
 * Releases matured pending earnings into creators' available balance
 * (earning holding period). Call from a scheduler (e.g. Vercel Cron /
 * GitHub Actions) with header `x-cron-secret` set to CRON_SECRET.
 * Financial operation -> service-role only.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Cron not configured (CRON_SECRET missing)' }, { status: 500 });
  }
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    // release_matured_earnings is idempotent and race-safe: it only moves
    // earnings whose available_at has passed and marks them released, so
    // running the job twice can never double-credit.
    const { data, error } = await supabase.rpc('release_matured_earnings');
    if (error) {
      console.error('[cron] release_matured_earnings failed', error);
      return NextResponse.json({ error: 'Release failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, creatorsReleased: Number(data) || 0 });
  } catch (e) {
    console.error('[cron] unexpected error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
