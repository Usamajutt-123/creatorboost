import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

/**
 * POST /api/referrals/click
 * Records a referral link click ({ code }) when the code exists.
 * Used by /signup?ref=CODE so the "Link Clicks" counter is real data.
 * Anonymous insert is allowed by RLS; the code is validated server-side.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req) || 'unknown';
  const allowed = await rateLimit(`referral-click:${ip}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const code = (body as { code?: string })?.code;
  if (typeof code !== 'string' || !/^[a-z0-9]{4,32}$/i.test(code)) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', code.toLowerCase())
      .maybeSingle();
    if (!data) {
      // Unknown code: record nothing, respond neutrally (don't leak codes).
      return NextResponse.json({ ok: false });
    }
    const { error } = await supabase.from('referral_clicks').insert({
      referral_code: code.toLowerCase(),
      visitor_ip: ip === 'unknown' ? null : ip,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) || null,
    });
    if (error) {
      console.error('[referral] click insert failed', error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[referral] click error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
