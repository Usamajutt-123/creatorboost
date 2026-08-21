import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { isPublicCampaignSlug } from '@/lib/route-params';
import { verifyFlowPreviewToken } from '@/lib/monetization/preview';
import {
  createFlowSession,
  FLOW_COOKIE,
} from '@/lib/monetization/flow-session';
import { loadActiveSteps, loadMonetizationSettings } from '@/lib/monetization/settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/flow/preview?slug=&token=
 *
 * Creates a PREVIEW flow session for an admin preview link and redirects to
 * the first step. The token is an HMAC issued by the authorized server
 * action `monetizationCreatePreview` — visitors cannot mint one.
 *
 * A preview session:
 *   - never generates creator earnings,
 *   - never records qualified payout events,
 *   - never pollutes analytics (preview_mode is filtered everywhere),
 *   - renders a visible "Preview mode" banner and ad placeholders.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug') || '';
  const token = request.nextUrl.searchParams.get('token') || '';

  if (!isPublicCampaignSlug(slug) || !token) {
    return NextResponse.redirect(new URL(`/c/${slug}`, request.url), 302);
  }

  const [settings, activeSteps] = await Promise.all([
    loadMonetizationSettings(),
    loadActiveSteps(),
  ]);
  const stepCount = Math.min(settings.steps_count, activeSteps.length);
  if (!settings.flow_enabled || stepCount === 0) {
    return NextResponse.redirect(new URL(`/c/${slug}`, request.url), 302);
  }

  const supabase = createAdminClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, creator_id, slug, status, deleted_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!campaign || campaign.deleted_at || campaign.status !== 'active') {
    return NextResponse.redirect(new URL('/', request.url), 302);
  }

  const verification = verifyFlowPreviewToken(token, campaign.id);
  if (!verification.ok) {
    return NextResponse.redirect(new URL(`/c/${slug}`, request.url), 302);
  }

  try {
    const sessionId = await createFlowSession({
      campaignId: campaign.id,
      creatorId: campaign.creator_id,
      totalSteps: stepCount,
      ttlMinutes: settings.session_ttl_minutes,
      tasksCompleted: [],
      ip: null,
      userAgent: request.headers.get('user-agent') || '',
      previewMode: true,
      testMode: settings.test_mode,
    });

    const response = NextResponse.redirect(
      new URL(`/go/${campaign.slug}/1`, request.url),
      302,
    );
    response.cookies.set({
      name: FLOW_COOKIE,
      value: sessionId,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: settings.session_ttl_minutes * 60,
    });
    return response;
  } catch (error) {
    console.error('[flow/preview] session creation failed', error);
    return NextResponse.redirect(new URL(`/c/${slug}`, request.url), 302);
  }
}
