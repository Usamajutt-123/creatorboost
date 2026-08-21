/**
 * Shared server renderer for the public unlock (task) page.
 *
 * Both /c/[slug] (legacy campaign links) and /unlock/[slug] (the product's
 * unlock link) render the exact same page through this component — one task
 * system, one unlock flow, no duplicated logic. The creator-facing link is
 * /unlock/[slug]; /c/[slug] keeps working for every previously shared link.
 */

import { headers } from 'next/headers';
import UnlockClient from '@/app/c/[slug]/UnlockClient';
import { createAdminClient } from '@/lib/supabase/server';
import { getPublicPlatformAds } from '@/lib/platform-ads';
import { createTaskSession } from '@/lib/task-session';
import type { PublicCampaignRecord } from '@/lib/public-campaign';
import {
  deviceCategoryFromUA,
  loadAdSlots,
  loadMonetizationSettings,
  resolvePageAdSlots,
} from '@/lib/monetization/settings';

export default async function UnlockServerBody({ campaign }: { campaign: PublicCampaignRecord }) {
  const requestHeaders = await headers();
  const adminSupabase = createAdminClient();

  const [platformSettings, monetization, adSlots] = await Promise.all([
    // Platform ads are read with the server-only client from the single
    // platform_settings row. Campaign data is never consulted for ads, and
    // the browser receives only enabled, renderable placements.
    adminSupabase
      .from('platform_settings')
      .select('banner_enabled, banner_code, banner_url, popunder_enabled, popunder_code, popunder_url')
      .eq('id', 1)
      .single(),
    loadMonetizationSettings(),
    loadAdSlots(),
  ]);
  const platformAds = getPublicPlatformAds(platformSettings.data);

  // Admin-configured monetization ad slots for the task page. Only enabled
  // slots for this visitor's device class reach the browser; without admin
  // code they render nothing (or labeled placeholders in test mode).
  const device = deviceCategoryFromUA(requestHeaders.get('user-agent'));
  const monetizationAds = resolvePageAdSlots(adSlots, 'task_page', device, {
    enabled: monetization.task_page_ads_enabled,
    testMode: monetization.test_mode,
  });

  // Server-issued task session. The unlock endpoint will only accept a task
  // submission that carries this token, so the task list a visitor submits
  // must have been issued by the server for THIS campaign and THIS task
  // configuration. It is short-lived and is re-issued on every page load.
  const tasks = campaign.tasks || [];
  const taskMetadata = campaign.task_metadata || {};
  const taskSession = createTaskSession(campaign.id, tasks, taskMetadata);

  return (
    <UnlockClient
      campaign={{ ...campaign, tasks, task_metadata: taskMetadata }}
      platformAds={platformAds}
      taskSession={taskSession}
      monetizationAds={monetizationAds}
    />
  );
}
