import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { createAdminClient } from '@/lib/supabase/server';
import { hashIp } from '@/lib/fraud';
import { isCampaignUuid } from '@/lib/route-params';
import { recordFlowEvent } from '@/lib/monetization/flow-session';
import { deviceCategoryFromUA, loadMonetizationSettings } from '@/lib/monetization/settings';

export const dynamic = 'force-dynamic';

const taskStartSchema = z.object({ campaignId: z.string() }).strict();

/**
 * POST /api/flow/task-start
 *
 * Funnel bookkeeping only: a visitor opened a task page ("link click").
 * Recorded once per browser session by the unlock client, rate-limited per
 * IP + campaign, and carrying no personal data. Preview/test sessions are
 * flagged so they never pollute analytics.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || 'unknown';
  const campaignKey = hashIp(ip)?.slice(0, 32) ?? 'anon';

  try {
    const allowed = await rateLimit(`task-start:${ip}`, 30, 60_000);
    if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const parsed = taskStartSchema.safeParse(body);
    if (!parsed.success || !isCampaignUuid(parsed.data.campaignId)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // At most a few per IP+campaign per hour — this is an analytics counter,
    // not a capability.
    const perCampaign = await rateLimit(`task-start:${parsed.data.campaignId}:${campaignKey}`, 6, 3_600_000);
    if (!perCampaign) return NextResponse.json({ ok: true });

    const supabase = createAdminClient();
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, creator_id, status, deleted_at')
      .eq('id', parsed.data.campaignId)
      .maybeSingle();

    if (!campaign || campaign.deleted_at || campaign.status !== 'active') {
      return NextResponse.json({ ok: true });
    }

    const settings = await loadMonetizationSettings();
    await recordFlowEvent({
      flowSessionId: null,
      campaignId: campaign.id,
      creatorId: campaign.creator_id,
      eventType: 'task_start',
      step: 0,
      testMode: settings.test_mode,
      deviceCategory: deviceCategoryFromUA(request.headers.get('user-agent')),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[flow/task-start] unexpected error', error);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
