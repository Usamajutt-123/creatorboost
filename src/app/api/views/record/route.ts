import { NextResponse, type NextRequest } from 'next/server';
import { recordView, type ValidatedCampaign } from '@/lib/earnings';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { recordViewSchema } from '@/lib/view-schema';
import { configuredTaskUrl, hasCompleteTaskSet, isTaskType, type TaskMetadata } from '@/lib/tasks';
import { createUnlockToken, UNLOCK_COOKIE, UNLOCK_TOKEN_MAX_AGE_SECONDS } from '@/lib/unlock-token';
import { coerceFlowType } from '@/lib/flow';
import { FLOW_COMPLETION_COOKIE, verifyFlowCompletion } from '@/lib/flow-token';

/**
 * POST /api/views/record
 *
 * The endpoint is the single public unlock transition. Client input contains
 * no owner, country, CPM, balance or validity fields. It verifies the
 * campaign/task configuration server-side, records the traffic result, then
 * issues a short-lived HttpOnly campaign token that gates /destination/[id].
 *
 * Opening a third-party task cannot prove an external follow/like. For those
 * task types CreatorBoost truthfully records a browser-confirmed opening and
 * separately decides whether the traffic is payout-eligible.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || 'unknown';

  try {
    const allowed = await rateLimit(`view:${ip}`, 60, 60_000);
    if (!allowed) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = recordViewSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { campaignId, deviceFingerprint, userAgent, tasksCompleted, idempotencyKey } = parsed.data;
    const admin = createAdminClient();
    // Never use a client-supplied owner. The admin client is server-only and
    // reads just enough campaign data to verify the public request.
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, creator_id, status, slug, deleted_at, expires_at, tasks, task_metadata, flow_type')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign || campaign.deleted_at || campaign.status !== 'active') {
      return NextResponse.json({ error: 'Campaign is unavailable' }, { status: 404 });
    }
    const storedFlow = coerceFlowType(campaign.flow_type);
    if (campaign.expires_at && new Date(campaign.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Campaign has expired' }, { status: 410 });
    }

    const configuredTasks = Array.isArray(campaign.tasks) ? campaign.tasks.filter((task): task is string => typeof task === 'string') : [];
    const metadata = (campaign.task_metadata || {}) as TaskMetadata;
    const hasValidConfiguration = configuredTasks.length > 0
      && configuredTasks.every(task => isTaskType(task) && configuredTaskUrl(metadata, task));
    if (!hasValidConfiguration) {
      return NextResponse.json({ error: 'This campaign has incomplete task URLs. Ask the creator to update it.' }, { status: 409 });
    }
    if (!hasCompleteTaskSet(configuredTasks, tasksCompleted || [])) {
      return NextResponse.json({ error: 'Complete every configured task before unlocking.' }, { status: 400 });
    }

    const sessionClient = await createClient();
    const { data: { user } } = await sessionClient.auth.getUser();

    // Custom-page flow verification. If the campaign requires a custom flow
    // the visitor MUST supply a valid HMAC-signed completion token issued
    // by /api/flow/step; without it the earning multiplier stays at 1.00×
    // regardless of any client-supplied values. Normal campaigns skip this.
    let flowCompletionVerified = false;
    let flowSessionId: string | null = null;
    if (storedFlow !== 'normal') {
      const flowCookie = request.cookies.get(`${FLOW_COMPLETION_COOKIE}_${campaign.id}`)?.value;
      const verification = verifyFlowCompletion(flowCookie, campaign.id, storedFlow);
      if (verification.ok) {
        flowCompletionVerified = true;
        flowSessionId = verification.session;
      }
    }

    const result = await recordView({
      campaign: campaign as ValidatedCampaign,
      visitorIp: ip,
      userAgent: userAgent || request.headers.get('user-agent') || '',
      deviceFingerprint: deviceFingerprint || undefined,
      tasksCompleted: tasksCompleted || [],
      idempotencyKey: idempotencyKey || null,
      sessionUserId: user?.id ?? null,
      flowCompletionVerified,
      flowSessionId,
    });

    const token = createUnlockToken(campaign.id);
    if (!token) {
      console.error('[views/record] unlock token secret is not configured');
      return NextResponse.json({ error: 'Unlock service is not configured' }, { status: 503 });
    }

    // Fraud validity affects earnings only. A visitor who completed the
    // browser-confirmed task flow can still receive the creator's destination
    // without the platform claiming their traffic was payable.
    const response = NextResponse.json({
      unlocked: true,
      payoutEligible: result.valid,
      duplicate: result.duplicate,
      earning: result.valid ? result.earning : 0,
    });
    response.cookies.set({
      name: UNLOCK_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: UNLOCK_TOKEN_MAX_AGE_SECONDS,
    });
    // Consume the one-shot flow completion cookie so a page refresh cannot
    // reuse it for a second credited view. The `flow_session_id` UNIQUE
    // index in the database is the authoritative replay guard.
    if (storedFlow !== 'normal') {
      response.cookies.set({
        name: `${FLOW_COMPLETION_COOKIE}_${campaign.id}`,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    console.error('[views/record] unexpected error', error);
    return NextResponse.json({ error: 'Unable to verify this visit right now. Please try again.' }, { status: 500 });
  }
}
