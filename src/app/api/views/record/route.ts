import { NextResponse, type NextRequest } from 'next/server';
import { recordView, type ValidatedCampaign } from '@/lib/earnings';
import { mapViewCheck } from '@/lib/tasks';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createClient } from '@/lib/supabase/server';
import { recordViewSchema } from '@/lib/view-schema';

/**
 * POST /api/views/record
 *
 * SECURE by design:
 *  - The client may only submit: campaignId, deviceFingerprint, userAgent,
 *    tasksCompleted, idempotencyKey. It CANNOT submit creatorId, countryCode,
 *    CPM, earning amount, fraudScore, or a valid/invalid status.
 *  - The creator, country, CPM and fraud score are all derived server-side.
 *  - Unknown/financial fields are rejected (strict schema).
 */

export async function POST(request: NextRequest) {
  // Trustworthy IP extraction (platform IP -> x-real-ip -> right-most xff).
  const ip = getClientIp(request) || 'unknown';

  try {
    const allowed = await rateLimit(`view:${ip}`, 60, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = recordViewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const { campaignId, deviceFingerprint, userAgent, tasksCompleted, idempotencyKey } = parsed.data;

    // Optional session (for self-view detection). Visitors may be anonymous.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch + verify the campaign server-side.
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, creator_id, status, slug, deleted_at, expires_at')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const result = await recordView({
      campaign: campaign as ValidatedCampaign,
      visitorIp: ip,
      userAgent: userAgent || request.headers.get('user-agent') || '',
      deviceFingerprint: deviceFingerprint || undefined,
      tasksCompleted: tasksCompleted || [],
      idempotencyKey: idempotencyKey || null,
      sessionUserId: user?.id ?? null,
    });

    // Never leak internal reasons that aid fraudsters; return a safe shape.
    // `check` is a coarse category the unlock page can act on:
    //   valid      -> view verified, earnings credited
    //   duplicate  -> same visit already counted; reward still unlocks
    //   traffic    -> visit flagged by traffic checks; recorded invalid
    //                 (no earnings) but the reward still unlocks — the
    //                 visitor completed the configured tasks
    //   campaign   -> campaign is not unlockable right now
    //   error      -> something went wrong
    // Detailed reasons stay in the DB (views.invalid_reason) for analytics.
    return NextResponse.json({
      valid: result.valid,
      duplicate: result.duplicate,
      reason: result.valid ? null : (result.duplicate ? 'duplicate' : 'invalid'),
      check: mapViewCheck(result.valid, result.duplicate, result.reason),
      earning: result.valid ? result.earning : 0,
    });
  } catch (e) {
    console.error('[views/record] unexpected error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
