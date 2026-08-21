import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { isPublicCampaignSlug, resolveParams } from '@/lib/route-params';
import { getClientIpFromHeaders } from '@/lib/request-ip';
import {
  loadActiveSteps,
  loadAdSlots,
  loadMonetizationSettings,
  prepareStepContent,
  resolvePageAdSlots,
  deviceCategoryFromUA,
} from '@/lib/monetization/settings';
import {
  FLOW_COOKIE,
  flowSessionMatchesRequest,
  loadFlowSession,
  recordFlowEvent,
  startStep,
  type FlowSessionRow,
} from '@/lib/monetization/flow-session';
import { verifyFlowPreviewToken } from '@/lib/monetization/preview';
import FlowStepClient from './FlowStepClient';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string; step: string }>;
  searchParams: Promise<{ preview?: string }>;
};

type FlowCampaignRow = {
  id: string;
  creator_id: string;
  slug: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
  status: string;
  deleted_at: string | null;
  expires_at: string | null;
};

const getCampaign = cache(async (slug: string): Promise<FlowCampaignRow | null> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('campaigns')
    .select('id, creator_id, slug, name, description, thumbnail_url, banner_url, status, deleted_at, expires_at')
    .eq('slug', slug)
    .maybeSingle();
  return (data as FlowCampaignRow | null) ?? null;
});

export async function generateMetadata({ params }: PageProps) {
  const { slug, step } = await resolveParams(params);
  const stepNum = Number.parseInt(step, 10);
  if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 12) return { title: 'Step not found' };
  const [campaign, steps, settings] = await Promise.all([
    getCampaign(slug),
    loadActiveSteps(),
    loadMonetizationSettings(),
  ]);
  if (!campaign) return { title: 'Link not found' };
  const stepCount = Math.min(settings.steps_count, steps.length);
  const stepRow = stepNum <= stepCount ? steps[stepNum - 1] : undefined;
  return {
    title: stepRow ? `${stepRow.title} — ${campaign.name}` : campaign.name,
    robots: { index: false, follow: false },
  };
}

export default async function GoStepPage({ params, searchParams }: PageProps) {
  const { slug, step: stepParam } = await resolveParams(params);
  const stepNum = Number.parseInt(stepParam, 10);
  if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 12 || !isPublicCampaignSlug(slug)) {
    notFound();
  }

  const requestHeaders = await headers();
  const requestUA = requestHeaders.get('user-agent') || '';
  const requestIp = getClientIpFromHeaders(requestHeaders);

  const [settings, steps, adSlots] = await Promise.all([
    loadMonetizationSettings(),
    loadActiveSteps(),
    loadAdSlots(),
  ]);

  // The flow is a single system: with the admin flow disabled, /go/* is not
  // a valid route — send the visitor back to the task page.
  if (!settings.flow_enabled) redirect(`/c/${slug}`);

  const stepCount = Math.min(settings.steps_count, steps.length);
  if (stepCount === 0) redirect(`/c/${slug}`);
  if (stepNum > stepCount) redirect(`/go/${slug}/${stepCount}`);

  const campaign = await getCampaign(slug);
  const requestTime = Date.now();
  if (!campaign || campaign.status !== 'active' || campaign.deleted_at
    || (campaign.expires_at && new Date(campaign.expires_at).getTime() <= requestTime)) {
    notFound();
  }

  // ------------------------------------------------------------------
  // Session validation. The session row is the authority for
  // progression; the cookie carries only its id. A visitor cannot skip
  // ahead by editing the URL: any step beyond current_step + 1 is
  // redirected back to the next allowed step.
  // ------------------------------------------------------------------
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(FLOW_COOKIE)?.value;
  let session: FlowSessionRow | null = sessionId ? await loadFlowSession(sessionId) : null;

  if (!session
    || session.campaign_id !== campaign.id
    || new Date(session.expires_at).getTime() <= requestTime
    || session.status !== 'active'
    || Boolean(session.completed_at)
    || !flowSessionMatchesRequest(session, requestIp, requestUA)) {
    const { preview } = await searchParams;
    // An admin preview link can start a preview session (verified token,
    // campaign-bound, short-lived). The session itself is created by the
    // dedicated route handler so the cookie can be set.
    if (preview && verifyFlowPreviewToken(preview, campaign.id).ok) {
      redirect(`/api/flow/preview?slug=${encodeURIComponent(campaign.slug)}&token=${encodeURIComponent(preview)}`);
    }
    // Everyone else starts over at the task page.
    redirect(`/unlock/${campaign.slug}`);
  }

  if (stepNum > session.total_steps) {
    redirect(`/go/${slug}/${Math.max(session.total_steps, 1)}`);
  }
  if (stepNum > session.current_step + 1) {
    redirect(`/go/${slug}/${Math.max(session.current_step + 1, 1)}`);
  }

  // ------------------------------------------------------------------
  // Advancing to this step: mark it started exactly once (race-safe
  // update) and record the step_start funnel event.
  // ------------------------------------------------------------------
  if (stepNum === session.current_step + 1) {
    await startStep(session.id, stepNum);
    session = await loadFlowSession(session.id);
    if (!session) redirect(`/unlock/${campaign.slug}`);
    await recordFlowEvent({
      flowSessionId: session.id,
      campaignId: campaign.id,
      creatorId: campaign.creator_id,
      eventType: 'step_start',
      step: stepNum,
      testMode: session.test_mode,
      previewMode: session.preview_mode,
      deviceCategory: deviceCategoryFromUA(requestUA),
    });
  }

  const stepRow = steps[stepNum - 1];
  const content = prepareStepContent(stepRow);

  // The countdown the client shows reflects the REMAINING time on the
  // server-side clock: a mid-step refresh can never restart the wait.
  const configuredSeconds = stepRow.countdown_seconds ?? settings.default_countdown_seconds;
  const startedAtMs = session.current_step_started_at
    ? new Date(session.current_step_started_at).getTime()
    : requestTime;
  const elapsedSeconds = (requestTime - startedAtMs) / 1_000;
  const remainingSeconds = Math.max(1, Math.ceil(configuredSeconds - elapsedSeconds));

  const device = deviceCategoryFromUA(requestUA);
  const ads = resolvePageAdSlots(adSlots, `step_${stepRow.position}`, device, {
    enabled: true,
    testMode: settings.test_mode,
  });

  return (
    <FlowStepClient
      campaign={{
        slug: campaign.slug,
        name: campaign.name,
        description: campaign.description,
        thumbnail_url: campaign.thumbnail_url,
        banner_url: campaign.banner_url,
      }}
      step={stepNum}
      content={{ ...content, countdownSeconds: remainingSeconds }}
      totalSteps={Math.min(stepCount, session.total_steps)}
      ads={ads}
      previewMode={session.preview_mode}
      finalRedirect={settings.final_redirect_enabled}
      progressBar={settings.progress_bar_enabled}
      educationalContent={settings.educational_content_enabled}
    />
  );
}
