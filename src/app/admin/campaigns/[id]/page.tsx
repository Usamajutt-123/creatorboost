import { notFound } from 'next/navigation';
import Link from 'next/link';
import { adminGetCampaign, adminLoadViewTrafficSummary } from '@/lib/admin-server';
import { isCampaignUuid, resolveParams } from '@/lib/route-params';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { configuredTaskUrl, isTaskType, taskDisplayName } from '@/lib/tasks';
import AdminTrafficQuality from '@/components/AdminTrafficQuality';

export const dynamic = 'force-dynamic';

export default async function AdminCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await resolveParams(params);
  if (!isCampaignUuid(id)) notFound();
  const [campaign, trafficSummary] = await Promise.all([
    adminGetCampaign(id),
    // Per-campaign paid vs non-paid attribution, aggregated in the database.
    adminLoadViewTrafficSummary({ campaignId: id }),
  ]);
  if (!campaign) notFound();

  const tasks = ((campaign.tasks || []) as string[]).filter(isTaskType);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <Link href="/admin/campaigns" className="text-sm text-gray-400 hover:text-white">← Back to campaigns</Link>
      <div>
        <h1 className="font-display text-2xl font-bold">{campaign.name}</h1>
        <p className="text-sm text-gray-500">/{`c/${campaign.slug}`} · {campaign.status}{campaign.deleted_at ? ' · deleted' : ''}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div className="glass rounded-xl p-4"><div className="text-gray-500 text-xs">Views</div><div className="font-semibold">{formatNumber(campaign.total_views)}</div></div>
        <div className="glass rounded-xl p-4"><div className="text-gray-500 text-xs">Valid</div><div className="font-semibold">{formatNumber(campaign.valid_views)}</div></div>
        <div className="glass rounded-xl p-4"><div className="text-gray-500 text-xs">Invalid</div><div className="font-semibold">{formatNumber(campaign.invalid_views)}</div></div>
        <div className="glass rounded-xl p-4"><div className="text-gray-500 text-xs">Earnings</div><div className="font-semibold text-green-400">{formatCurrency(campaign.total_earnings)}</div></div>
      </div>
      <AdminTrafficQuality summary={trafficSummary} windowLabel="all time, this campaign" />

      <div className="glass rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold">Configured tasks</h2>
        {tasks.map((task, index) => (
          <div key={task} className="text-sm flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-gray-500 w-6">{index + 1}.</span>
            <span className="font-medium">{taskDisplayName(campaign.task_metadata, task)}</span>
            <span className="text-xs text-gray-400 break-all">{configuredTaskUrl(campaign.task_metadata, task) || 'missing URL'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
