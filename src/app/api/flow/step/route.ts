import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient } from '@/lib/supabase/server';
import { coerceFlowType, flowRequiredPageCount } from '@/lib/flow';
import {
  advanceStepToken,
  createInitialStepToken,
  FLOW_COMPLETION_COOKIE,
  FLOW_COMPLETION_MAX_AGE_SECONDS,
} from '@/lib/flow-token';

/**
 * POST /api/flow/step
 *
 * Server-authoritative progression through a campaign's custom-page flow.
 *
 * There is no `multiplier`, `earning`, `completedPages` or `flowType`
 * field in the accepted body — the client only says "I finished this
 * page". The server:
 *
 *   1. Reads `campaigns.flow_type` for the given campaignId.
 *   2. Verifies the previous step's HMAC token from a per-campaign
 *      HttpOnly cookie.
 *   3. Refuses anything except step = previous + 1.
 *   4. Once the last step is reached, issues a short-lived completion
 *      cookie whose payload includes the flow session id.
 *
 * The completion cookie is verified by /api/views/record before the
 * multiplier is applied. A refresh/replay of the completion cookie is
 * blocked by the unique index on (creator_id, flow_session_id) in
 * `views` — see migration 0014.
 */

const bodySchema = z.object({
  campaignId: z.string().uuid(),
  step: z.number().int().min(0).max(5).optional(),
  action: z.enum(['start', 'advance']).optional().default('advance'),
}).strict();

function cookieName(campaignId: string) {
  // Per-campaign cookie so opening two campaigns doesn't cross-contaminate
  // their session ids. Cookie names are limited to ASCII; UUIDs are safe.
  return `${FLOW_COMPLETION_COOKIE}_${campaignId}`;
}

function stepCookieName(campaignId: string) {
  return `${FLOW_COMPLETION_COOKIE}_step_${campaignId}`;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || 'unknown';
  try {
    const allowed = await rateLimit(`flowstep:${ip}`, 120, 60_000);
    if (!allowed) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { campaignId, step, action } = parsed.data;

    const admin = createAdminClient();
    const { data: campaign, error } = await admin
      .from('campaigns')
      .select('id, status, deleted_at, expires_at, flow_type')
      .eq('id', campaignId)
      .maybeSingle();
    if (error) {
      console.error('[flow/step] campaign lookup failed', error.message);
      return NextResponse.json({ error: 'Campaign lookup failed' }, { status: 500 });
    }
    if (!campaign || campaign.deleted_at || campaign.status !== 'active') {
      return NextResponse.json({ error: 'Campaign is unavailable' }, { status: 404 });
    }
    if (campaign.expires_at && new Date(campaign.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Campaign has expired' }, { status: 410 });
    }
    const flowType = coerceFlowType(campaign.flow_type);
    if (flowType === 'normal') {
      return NextResponse.json({ error: 'This campaign does not use a custom flow' }, { status: 400 });
    }
    const total = flowRequiredPageCount(flowType);

    if (action === 'start') {
      const init = createInitialStepToken(campaign.id, flowType);
      if (!init) {
        return NextResponse.json({ error: 'Flow service is not configured' }, { status: 503 });
      }
      const response = NextResponse.json({ ok: true, step: 0, total });
      response.cookies.set({
        name: stepCookieName(campaign.id),
        value: init.token,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 10,
      });
      return response;
    }

    const cookieToken = request.cookies.get(stepCookieName(campaign.id))?.value ?? null;
    const nextStep = typeof step === 'number' ? step : NaN;
    const result = advanceStepToken({
      token: cookieToken,
      campaignId: campaign.id,
      flowType,
      nextStep,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.done) {
      const response = NextResponse.json({ ok: true, done: true, step: total, total });
      // Store the completion token per-campaign. HttpOnly + SameSite=Lax
      // means the browser cannot read it or send it cross-site; it is
      // consumed by /api/views/record and cleared there.
      response.cookies.set({
        name: cookieName(campaign.id),
        value: result.completionToken,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: FLOW_COMPLETION_MAX_AGE_SECONDS,
      });
      // Clear the step cookie so it can't be replayed.
      response.cookies.set({
        name: stepCookieName(campaign.id),
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
      return response;
    }

    const response = NextResponse.json({ ok: true, done: false, step: result.step, total });
    response.cookies.set({
      name: stepCookieName(campaign.id),
      value: result.token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10,
    });
    return response;
  } catch (err) {
    console.error('[flow/step] unexpected error', err);
    return NextResponse.json({ error: 'Flow step failed' }, { status: 500 });
  }
}
