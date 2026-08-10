import { createAdminClient } from '@/lib/supabase/server';
import { formatCurrency, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AdminCampaignsPage() {
  const supabase = createAdminClient();
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*, creator:profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h2 className="font-display text-2xl font-bold">Manage Campaigns</h2>
      <div className="glass rounded-2xl p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-white/5">
                <th className="text-left py-2 font-medium">Campaign</th>
                <th className="text-left py-2 font-medium">Creator</th>
                <th className="text-left py-2 font-medium">Views</th>
                <th className="text-left py-2 font-medium">Earnings</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns?.map((c: any) => (
                <tr key={c.id} className="border-b border-white/5 table-row">
                  <td className="py-3 font-medium">{c.name}</td>
                  <td className="py-3 text-gray-400">{c.creator?.full_name || '—'}</td>
                  <td className="py-3">{formatNumber(c.total_views)}</td>
                  <td className="py-3 text-green-400">{formatCurrency(c.total_earnings)}</td>
                  <td className="py-3"><span className={`badge status-${c.status}`}>{c.status}</span></td>
                  <td className="py-3">
                    <button className="text-xs text-purple-400 mr-2">View</button>
                    <button className="text-xs text-yellow-400 mr-2">Pause</button>
                    <button className="text-xs text-red-400">Delete</button>
                  </td>
                </tr>
              ))}
              {!campaigns?.length && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">No campaigns yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
