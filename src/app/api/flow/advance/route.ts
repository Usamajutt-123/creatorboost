import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { recordView } from '@/lib/earnings';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidHttpUrl } from '@/lib/tasks';
import { deriveRequestSignals } from '@/lib/bot-detection';
import {
  FLOW_COOKIE,
  claimFlowCompletion,
  flowSessionMatchesRequest,
  loadFlowSession,
  recordFlowEvent,
} from '@/lib/monetization/flow-session';
import {
  deviceCategoryFromUA,
  loadActiveSteps,
  loadMonetizationSettings,
  loadPayoutSettings,
} from '@/lib/monetization/settings';
import { hasCountdownElapsed } from '@/lib/monetization/countdown';

export const dynamic = 'force-dynamic';

const advanceSchema = z
  .object({ step: z.number().int().min(1).max(12) })
  .strict();

/**
 * POST /api/flow/advance
 *
 * The only way a monetized flow step transitions. The server:
 *
 *   1. loads the session row (cookie carries only its id),
 *   2. verifies the session belongs to this browser + coarse network,
 *   3. verifies the requested step equals the session's CURRENT step,
 *   4. verifies the server-side countdown has elapsed,
 *   5. on the final step: claims completion exactly once, validates the
 *      destination, records the qualified view + creator earning through
 *      the existing earnings engine (fraud, duplicate window, caps, atomic
 *      accounting), then returns the destination.
 *
 * Nothing here trusts the client for progression, timing, eligibility or
 * the destination URL. The response never reveals why a view was or was not
 * payout-eligible.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || 'unknown';

  try {
    const allowed = await rateLimit(`flow-advance:${ip}`, 40, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const parsed = advanceSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { step } = parsed.data;

    const requestUA = request.headers.get('user-agent') || '';
    const trustedIp = ip === 'unknown' ? null : ip;
    const headerSignals = deriveRequestSignals(request.headers);

    const [settings, activeSteps, payoutSettings] = await Promise.all([
      loadMonetizationSettings(),
      loadActiveSteps(),
      loadPayoutSettings(),
    ]);
    if (!settings.flow_enabled) {
      return NextResponse.json({ error: 'The monetized flow is currently disabled.' }, { status: 409 });
    }
    const stepCount = Math.min(settings.steps_count, activeSteps.length);
    if (stepCount === 0) {
      return NextResponse.json({ error: 'The monetized flow is currently unavailable.' }, { status: 409 });
    }

    // ---- Session -------------------------------------------------------
    const sessionId = request.cookies.get(FLOW_COOKIE)?.value;
    const session = await loadFlowSession(sessionId);
    const now = Date.now();

    if (!session
      || session.status !== 'active'
      || new Date(session.expires_at).getTime() <= now
      || !flowSessionMatchesRequest(session, trustedIp, requestUA)) {
      return NextResponse.json(
        { error: 'This flow session is no longer valid. Please start again.', reload: true },
        { status: 409 },
      );
    }

    // ---- Already completed: return the destination again without
    //      re-recording anything (replay protection).
    if (session.completed_at) {
      const destination = await resolveDestination(session.campaign_id);
      if (!destination) {
        return NextResponse.json({ error: 'The destination for this link is unavailable.' }, { status: 502 });
      }
      return NextResponse.json({ ok: true, done: true, destination });
    }

    // ---- Progression: only the session's CURRENT step may advance.
    if (step !== session.current_step) {
      return NextResponse.json(
        { error: 'This step is no longer active.', currentStep: Math.max(session.current_step, 1) },
        { status: 409 },
      );
    }

    // ---- Server-side countdown enforcement.
    const stepRow = step - 1 < activeSteps.length ? activeSteps[step - 1] : undefined;
    const countdownSeconds = stepRow?.countdown_seconds ?? settings.default_countdown_seconds;
    const elapsed = hasCountdownElapsed(session.current_step_started_at, countdownSeconds, now);
    if (!elapsed.ok) {
      return NextResponse.json(
        { error: 'Please wait for the countdown to finish.', remainingMs: elapsed.remainingMs },
        { status: 429 },
      );
    }

    const campaign = await loadCampaign(session.campaign_id);
    if (!campaign) {
      return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });
    }

    const isFinal = step >= session.total_steps || step >= stepCount;

    await recordFlowEvent({
      flowSessionId: session.id,
      campaignId: session.campaign_id,
      creatorId: session.creator_id,
      eventType: 'step_complete',
      step,
      testMode: session.test_mode,
      previewMode: session.preview_mode,
      deviceCategory: deviceCategoryFromUA(requestUA),
    });

    // ---- Non-final step: advance the session.
    if (!isFinal) {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from('flow_sessions')
        .update({ current_step: step + 1, current_step_started_at: new Date().toISOString() })
        .eq('id', session.id)
        .eq('current_step', step)
        .is('completed_at', null);
      if (error) {
        console.error('[flow/advance] step advance failed', error.message);
        return NextResponse.json({ error: 'Could not advance right now. Please try again.' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, next: `/go/${campaign.slug}/${step + 1}` });
    }

    // ---- Final step: claim completion exactly once.
    const claimed = await claimFlowCompletion(session.id);
    const destination = await resolveDestination(session.campaign_id);
    if (!destination) {
      return NextResponse.json({ error: 'The destination for this link is unavailable.' }, { status: 502 });
    }

    // Preview and test-mode flows never generate earnings or qualified
    // payout events.
    if (!claimed || session.preview_mode || session.test_mode) {
      await recordFlowEvent({
        flowSessionId: session.id,
        campaignId: session.campaign_id,
        creatorId: session.creator_id,
        eventType: 'destination_visit',
        step: 0,
        qualified: false,
        testMode: session.test_mode,
        previewMode: session.preview_mode,
        deviceCategory: deviceCategoryFromUA(requestUA),
      });
      const response = NextResponse.json({ ok: true, done: true, destination });
      response.cookies.set({
        name: FLOW_COOKIE,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
      return response;
    }

    // ---- Qualified view + earning, through the existing engine.
    //      The idempotency key binds the earning to this flow session, and
    //      the database's unique (creator_id, flow_session_id) index makes
    //      a completed flow physically non-replayable for earnings.
    const sessionSeconds = Math.max(0, (now - new Date(session.started_at).getTime()) / 1_000);
    const result = await recordView({
      campaign: {
        id: campaign.id,
        creator_id: campaign.creator_id,
        status: campaign.status,
        slug: campaign.slug,
        deleted_at: campaign.deleted_at,
        expires_at: campaign.expires_at,
      },
      visitorIp: trustedIp,
      userAgent: requestUA,
      deviceFingerprint: undefined,
      tasksCompleted: session.tasks_completed || [],
      idempotencyKey: `flow:${session.id}`,
      headerSignals,
      sessionSeconds,
      requiredTasks: (session.tasks_completed || []).length,
      flowSessionId: session.id,
      earningScale: Math.max(0, Math.min(Number(payoutSettings.creator_share_percent ?? 100) / 100, 1)),
      earningClamp: {
        min: Number(payoutSettings.min_payout_per_view ?? 0.0005),
        max: Number(payoutSettings.max_payout_per_view ?? 0.05),
      },
      fraudAdjustment: {
        percent: Number(payoutSettings.fraud_adjustment_percent ?? 0),
        threshold: Number(payoutSettings.fraud_adjustment_threshold ?? 40),
      },
    });

    await recordFlowEvent({
      flowSessionId: session.id,
      campaignId: session.campaign_id,
      creatorId: session.creator_id,
      eventType: 'destination_visit',
      step: 0,
      qualified: result.valid === true,
      testMode: session.test_mode,
      previewMode: session.preview_mode,
      deviceCategory: deviceCategoryFromUA(requestUA),
    });

    const response = NextResponse.json({ ok: true, done: true, destination });
    response.cookies.set({
      name: FLOW_COOKIE,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('[flow/advance] unexpected error', error);
    return NextResponse.json({ error: 'Unable to continue right now. Please try again.' }, { status: 500 });
  }
}

async function loadCampaign(campaignId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('campaigns')
    .select('id, creator_id, slug, status, deleted_at, expires_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (!data || data.deleted_at || data.status !== 'active') return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data as {
    id: string; creator_id: string; slug: string; status: string;
    deleted_at: string | null; expires_at: string | null;
  };
}

/**
 * The destination is fetched only here, at the very end, and only ever
 * returned to the visitor who completed the flow. Only browser-safe
 * http/https URLs are allowed — no javascript:, no credentials, no open
 * redirect targets.
 */
async function resolveDestination(campaignId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('campaigns')
    .select('destination_url')
    .eq('id', campaignId)
    .maybeSingle();
  const url = typeof data?.destination_url === 'string' ? data.destination_url.trim() : '';
  return isValidHttpUrl(url) ? url : null;
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
