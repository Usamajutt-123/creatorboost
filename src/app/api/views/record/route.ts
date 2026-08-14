import { NextResponse, type NextRequest } from 'next/server';
import { recordView, type ValidatedCampaign } from '@/lib/earnings';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { recordViewSchema } from '@/lib/view-schema';
import { configuredTaskUrl, hasCompleteTaskSet, isTaskType, type TaskMetadata } from '@/lib/tasks';
import { createUnlockToken, UNLOCK_COOKIE, UNLOCK_TOKEN_MAX_AGE_SECONDS } from '@/lib/unlock-token';

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
      .select('id, creator_id, status, slug, deleted_at, expires_at, tasks, task_metadata')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign || campaign.deleted_at || campaign.status !== 'active') {
      return NextResponse.json({ error: 'Campaign is unavailable' }, { status: 404 });
    }
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
    const result = await recordView({
      campaign: campaign as ValidatedCampaign,
      visitorIp: ip,
      // SECURITY: always use the server-side User-Agent header, never the
      // client-supplied body field. The body.userAgent is kept in the schema
      // for telemetry but is NOT used for fraud or earnings decisions.
      userAgent: request.headers.get('user-agent') || userAgent || '',
      deviceFingerprint: deviceFingerprint || undefined,
      tasksCompleted: tasksCompleted || [],
      idempotencyKey: idempotencyKey || null,
      sessionUserId: user?.id ?? null,
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
    return response;
  } catch (error) {
    console.error('[views/record] unexpected error', error);
    return NextResponse.json({ error: 'Unable to verify this visit right now. Please try again.' }, { status: 500 });
  }
}
