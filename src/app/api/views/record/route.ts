import { NextResponse, type NextRequest } from 'next/server';
import { recordView, type ValidatedCampaign } from '@/lib/earnings';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { recordViewSchema } from '@/lib/view-schema';
import { configuredTaskUrl, hasCompleteTaskSet, isTaskType, type TaskMetadata } from '@/lib/tasks';
import { createUnlockToken, unlockSubject, UNLOCK_COOKIE, UNLOCK_TOKEN_MAX_AGE_SECONDS } from '@/lib/unlock-token';
import { verifyTaskSession } from '@/lib/task-session';
import {
  deriveRequestSignals,
  exceedsPayloadLimit,
  MAX_VIEW_PAYLOAD_BYTES,
  validateJsonRequestEnvelope,
} from '@/lib/bot-detection';
import { hashIp } from '@/lib/fraud';
import { getCountryFromIP, sanitizeCountryCode } from '@/lib/geo';
import {
  createFlowSession,
  recordFlowEvent,
  FLOW_COOKIE,
} from '@/lib/monetization/flow-session';
import {
  deviceCategoryFromUA,
  loadActiveSteps,
  loadMonetizationSettings,
} from '@/lib/monetization/settings';

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
 *
 * SECURITY MODEL
 * --------------
 * Request-level protection, in order:
 *   1. method + content-type + payload-size validation
 *   2. distributed rate limiting (per IP, and per IP+campaign)
 *   3. strict schema validation (`.strict()` rejects smuggled fields)
 *   4. server-side campaign/task verification
 *   5. server-derived bot/header signals + fraud assessment
 *   6. atomic campaign + hashed-IP 24h eligibility in the database
 *
 * NOTHING security- or money-related is read from the request body. The
 * user agent, IP, country, CPM, multiplier, earning, fraud score and
 * valid/paid status are all derived server-side.
 *
 * DISCLOSURE RULE
 * The response never reveals WHY traffic was not payout-eligible. Duplicate,
 * bot, rate-limit and fraud reasons stay in admin analytics only.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || 'unknown';

  try {
    // ---------------------------------------------------------------
    // 1. Transport-level validation (method, content type, size).
    //    A malformed or oversized request is rejected before any I/O.
    // ---------------------------------------------------------------
    const envelope = validateJsonRequestEnvelope({
      method: request.method,
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
    });
    if (!envelope.ok) {
      return NextResponse.json({ error: envelope.error }, { status: envelope.status });
    }

    // ---------------------------------------------------------------
    // 2. Distributed rate limiting. Both limits use the shared
    //    database-backed store, so an attacker cannot reset a counter by
    //    landing on another serverless instance.
    // ---------------------------------------------------------------
    const allowed = await rateLimit(`view:${ip}`, 60, 60_000);
    if (!allowed) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });

    // ---------------------------------------------------------------
    // 3. Body: read as text first so an oversized payload without (or
    //    with a lying) Content-Length is still rejected.
    // ---------------------------------------------------------------
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (exceedsPayloadLimit(raw, MAX_VIEW_PAYLOAD_BYTES)) {
      return NextResponse.json({ error: 'Request payload is too large' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = recordViewSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { campaignId, deviceFingerprint, tasksCompleted, idempotencyKey, startedAt, taskSession } = parsed.data;

    // Per-campaign limiter. The site-wide limiter above allows a visitor to
    // browse many campaigns; this one stops one IP hammering a single
    // campaign. Neither is the earnings rule — that stays in the database.
    const campaignKey = hashIp(ip)?.slice(0, 32) ?? 'anon';
    const campaignAllowed = await rateLimit(`view:${campaignId}:${campaignKey}`, 12, 60_000);
    if (!campaignAllowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

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

    // ---------------------------------------------------------------
    // 3b. Server-issued task session.
    //
    // The task list is only accepted when it arrives with an HMAC token this
    // server issued for THIS campaign, whose signature validates, which has
    // not expired, and whose task-configuration fingerprint still matches the
    // campaign. That prevents submitting arbitrary/borrowed task ids, replaying
    // a session against another campaign, and using a session issued before
    // the creator changed the task configuration.
    //
    // HONESTY: this verifies task INTERACTION with CreatorBoost, not the
    // external social action. No third-party verification exists.
    //
    // The failure message is deliberately identical for every failure reason —
    // signature, expiry, campaign mismatch and config change must not be
    // distinguishable by a prober.
    const session = verifyTaskSession(taskSession || null, campaign.id, configuredTasks, metadata);
    if (!session.ok) {
      if (session.reason === 'not_configured') {
        console.error('[views/record] task session secret is not configured');
        return NextResponse.json({ error: 'Unlock service is not configured' }, { status: 503 });
      }
      console.warn('[views/record] task session rejected', { campaignId: campaign.id, reason: session.reason });
      return NextResponse.json(
        { error: 'This unlock session is no longer valid. Please reload the campaign page and try again.' },
        { status: 409 },
      );
    }

    // ---------------------------------------------------------------
    // 4. Server-derived security context.
    //    `deriveRequestSignals` reads the REAL headers; `startedAt` is a
    //    client hint that is only ever used to *lower* trust (a shorter
    //    session raises risk) and is clamped, so it cannot buy eligibility.
    // ---------------------------------------------------------------
    const headerSignals = deriveRequestSignals(request.headers);
    const sessionSeconds = deriveSessionSeconds(startedAt);
    const requestUA = request.headers.get('user-agent') || '';
    const trustedIp = ip === 'unknown' ? null : ip;

    const sessionClient = await createClient();
    const { data: { user } } = await sessionClient.auth.getUser();

    // ---------------------------------------------------------------
    // 4b. MONETIZED FLOW BRANCH.
    //
    // When the admin has enabled the monetized flow, completing the tasks
    // starts the shortener flow instead of recording an earning: the
    // qualified view is recorded ONCE the visitor finishes the final step
    // (/api/flow/advance). This is the single unlock transition either way,
    // and the response never reveals eligibility information.
    // ---------------------------------------------------------------
    const [monetization, activeSteps] = await Promise.all([
      loadMonetizationSettings(),
      loadActiveSteps(),
    ]);
    const flowStepCount = Math.min(monetization.steps_count, activeSteps.length);
    const flowEnabled = monetization.flow_enabled && flowStepCount > 0;

    if (flowEnabled) {
      try {
        const flowSessionId = await createFlowSession({
          campaignId: campaign.id,
          creatorId: campaign.creator_id,
          totalSteps: flowStepCount,
          ttlMinutes: monetization.session_ttl_minutes,
          tasksCompleted: configuredTasks,
          ip: trustedIp,
          userAgent: requestUA,
          testMode: monetization.test_mode,
        });
        const eventCountry = sanitizeCountryCode(await getCountryFromIP(trustedIp));
        const deviceCategory = deviceCategoryFromUA(requestUA);
        // Funnel bookkeeping. test_mode events are flagged so admin
        // analytics can exclude them by default.
        for (const eventType of ['task_complete', 'unlock', 'flow_start'] as const) {
          await recordFlowEvent({
            flowSessionId,
            campaignId: campaign.id,
            creatorId: campaign.creator_id,
            eventType,
            step: 0,
            testMode: monetization.test_mode,
            countryCode: eventCountry,
            deviceCategory,
          });
        }

        const response = NextResponse.json({
          unlocked: true,
          mode: 'flow',
          next: `/go/${campaign.slug}/1`,
        });
        response.cookies.set({
          name: FLOW_COOKIE,
          value: flowSessionId,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: monetization.session_ttl_minutes * 60,
        });
        return response;
      } catch (error) {
        // A flow infrastructure failure must never block a visitor who
        // completed the tasks: fall through to the direct path below. The
        // failure is logged for the operator.
        console.error('[views/record] flow session creation failed', error);
      }
    }

    const result = await recordView({
      campaign: campaign as ValidatedCampaign,
      visitorIp: ip,
      // SECURITY: always use the server-side User-Agent header, never the
      // client-supplied body field. `body.userAgent` is accepted by the
      // schema for backwards compatibility but is deliberately NOT read
      // here — no fraud or earnings decision may depend on it.
      userAgent: requestUA,
      deviceFingerprint: deviceFingerprint || undefined,
      tasksCompleted: tasksCompleted || [],
      idempotencyKey: idempotencyKey || null,
      sessionUserId: user?.id ?? null,
      headerSignals,
      sessionSeconds,
      requiredTasks: configuredTasks.length,
    });

    // Bind the unlock cookie to this visitor's coarse network + browser so it
    // cannot be replayed from elsewhere during its (now 5-minute) lifetime.
    const token = createUnlockToken(
      campaign.id,
      Date.now(),
      unlockSubject(trustedIp, requestUA),
    );
    if (!token) {
      console.error('[views/record] unlock token secret is not configured');
      return NextResponse.json({ error: 'Unlock service is not configured' }, { status: 503 });
    }

    // Fraud validity affects earnings only. A visitor who completed the
    // browser-confirmed task flow can still receive the creator's destination
    // without the platform claiming their traffic was payable.
    //
    // PRIVACY / ANTI-ORACLE: the response body is exactly `{ unlocked: true }`.
    //
    // It previously also returned `payoutEligible` and the exact `earning`.
    // Both turned this public, unauthenticated endpoint into an oracle: an
    // attacker could probe it to learn whether a given IP/device/timing
    // combination is payable, binary-search the duplicate window and the
    // fraud threshold, and read the live CPM × level multiplier off the
    // earning amount. None of that is needed to unlock a destination.
    //
    // The earning, the CPM, the payout eligibility, the fraud score, the
    // duplicate/bot/rate-limit reason, the traffic category and the cap state
    // all stay server-side. Creators see their own aggregated earnings in the
    // authenticated dashboard; admins see traffic quality in the admin panel.
    //
    // `result` is still consumed above by the accounting path — this only
    // changes what is DISCLOSED, not what is recorded. The direct-mode body
    // stays exactly `{ unlocked: true }`: the client navigates to the
    // destination page unless the server returned a flow `next` path.
    const response = NextResponse.json({ unlocked: true });
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

/**
 * Convert the optional client `startedAt` epoch into a server-measured
 * elapsed time.
 *
 * The client cannot gain anything by lying: an implausible value (future,
 * absurdly old, non-finite) is discarded, and a *large* value never improves
 * the risk score — `scoreBehavior` only penalises impossibly fast or
 * abnormally long sessions. The authoritative "now" is the server clock.
 */
function deriveSessionSeconds(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  const elapsedMs = Date.now() - startedAt;
  // Reject a future timestamp or one older than 24h — both are nonsense.
  if (elapsedMs < 0 || elapsedMs > 86_400_000) return null;
  return elapsedMs / 1000;
}

/**
 * Method guards. The endpoint only accepts POST; everything else is refused
 * with 405 rather than falling through to Next's default handling.
 */
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
