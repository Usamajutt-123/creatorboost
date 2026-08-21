import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';
import DashboardTopbar from '@/components/DashboardTopbar';
import MonetizationClient from './MonetizationClient';

export const dynamic = 'force-dynamic';

type SummaryRow = {
  taskStarts: number;
  taskCompletes: number;
  unlocks: number;
  flowStarts: number;
  stepCompletes: number;
  destinations: number;
  qualified: number;
  flowEarnings: number;
};

type CampaignRow = {
  campaign_id: string;
  campaign_name: string;
  slug: string;
  status: string;
  task_starts: number;
  task_completes: number;
  unlocks: number;
  flow_starts: number;
  step_completes: number;
  destinations: number;
  qualified: number;
  earnings: number;
};

type CountryRow = { country_code: string; events: number; qualified: number };
type DeviceRow = { device: string; events: number };

export default async function MonetizationPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  const [summaryResult, campaignsResult, countriesResult, devicesResult, unreadCount] = await Promise.all([
    supabase.rpc('creator_monetization_summary'),
    supabase.rpc('creator_monetization_campaign_stats'),
    supabase.rpc('creator_monetization_countries', { p_days: 30, p_limit: 8 }),
    supabase.rpc('creator_monetization_devices', { p_days: 30 }),
    getUnreadNotificationCount(user.id),
  ]);

  const summary: SummaryRow = {
    taskStarts: Number(summaryResult.data?.taskStarts ?? 0),
    taskCompletes: Number(summaryResult.data?.taskCompletes ?? 0),
    unlocks: Number(summaryResult.data?.unlocks ?? 0),
    flowStarts: Number(summaryResult.data?.flowStarts ?? 0),
    stepCompletes: Number(summaryResult.data?.stepCompletes ?? 0),
    destinations: Number(summaryResult.data?.destinations ?? 0),
    qualified: Number(summaryResult.data?.qualified ?? 0),
    flowEarnings: Number(summaryResult.data?.flowEarnings ?? 0),
  };

  const campaigns = (campaignsResult.data ?? []) as CampaignRow[];
  const countries = (countriesResult.data ?? []) as CountryRow[];
  const devices = (devicesResult.data ?? []) as DeviceRow[];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <DashboardTopbar title="Monetization" subtitle="Your unlock flow performance and earnings" userId={user.id} unreadCount={unreadCount} />
      <MonetizationClient summary={summary} campaigns={campaigns} countries={countries} devices={devices} />
    </div>
  );
}
