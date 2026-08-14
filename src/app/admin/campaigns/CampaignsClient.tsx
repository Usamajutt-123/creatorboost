'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pause, Play, Trash2, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { adminListCampaigns, adminCampaignAction } from '@/lib/admin-server';

/**
 * The campaign list is server-rendered (see page.tsx); refresh/search and
 * pause/resume/delete/restore actions keep their exact previous behavior.
 */
export default function AdminCampaignsClient({
  initialCampaigns,
  initialError,
}: {
  initialCampaigns: any[];
  initialError: string | null;
}) {
  const [campaigns, setCampaigns] = useState<any[]>(initialCampaigns);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!initialError) return;
    toast.error(initialError);
  }, [initialError]);

  const load = async () => {
    try {
      const rows = await adminListCampaigns();
      setCampaigns(rows);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const action = async (id: string, a: 'pause' | 'resume' | 'delete' | 'restore') => {
    setBusy(id);
    try {
      await adminCampaignAction(id, a);
      toast.success(
        a === 'delete' ? 'Campaign deleted'
        : a === 'restore' ? 'Campaign restored (paused)'
        : a === 'pause' ? 'Campaign paused'
        : 'Campaign resumed'
      );
      load();
    } catch (e: any) {
      toast.error(e.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const filtered = campaigns.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.name?.toLowerCase().includes(s) || c.creator?.full_name?.toLowerCase().includes(s) || c.creator?.email?.toLowerCase().includes(s);
  });

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Manage Campaigns</h2>
          <p className="text-sm text-gray-500">{filtered.length} campaigns</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="input-field pl-9 text-sm" />
          </div>
          <button onClick={() => { setLoading(true); load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
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
                {filtered.map((c: any) => (
                  <tr key={c.id} className="border-b border-white/5 table-row">
                    <td className="py-3 font-medium">{c.name}</td>
                    <td className="py-3 text-gray-400">{c.creator?.full_name || '—'}</td>
                    <td className="py-3">{formatNumber(c.total_views)}</td>
                    <td className="py-3 text-green-400">{formatCurrency(c.total_earnings)}</td>
                    <td className="py-3">
                      {c.deleted_at ? (
                        <span className="badge status-rejected">deleted</span>
                      ) : (
                        <span className={`badge status-${c.status}`}>{c.status}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!c.deleted_at && (
                          <a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View</a>
                        )}
                        {c.deleted_at ? (
                          <button onClick={() => { if (confirm('Restore this campaign?')) action(c.id, 'restore'); }} disabled={busy === c.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-green-400"><Play className="w-3 h-3" /> Restore</button>
                        ) : (
                          <>
                            {c.status === 'paused' ? (
                              <button onClick={() => action(c.id, 'resume')} disabled={busy === c.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-green-400"><Play className="w-3 h-3" /> Resume</button>
                            ) : (
                              <button onClick={() => action(c.id, 'pause')} disabled={busy === c.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-yellow-400"><Pause className="w-3 h-3" /> Pause</button>
                            )}
                            <button onClick={() => { if (confirm('Delete this campaign?')) action(c.id, 'delete'); }} disabled={busy === c.id} className="btn-ghost px-2 py-1 rounded text-xs flex items-center gap-1 text-red-400"><Trash2 className="w-3 h-3" /> Delete</button>
                            <Link href={`/admin/campaigns/${c.id}`} className="btn-ghost px-2 py-1 rounded text-xs">Details</Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={6} className="py-12 text-center text-gray-500">No campaigns found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
