'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Edit, BarChart3, Trash2, Copy, ExternalLink, Pause, Play } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { deleteCampaignAction, setCampaignStatusAction } from '@/lib/campaign-actions';
import { toast } from 'sonner';
import DashboardTopbar from '@/components/DashboardTopbar';
import { formatNumber, formatCurrency } from '@/lib/utils';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      // Only the columns these cards render. `select('*')` also pulled
      // destination_url and the full tasks payload into the browser for every
      // campaign — wasted bytes, and data this screen never shows.
      .from('campaigns')
      .select('id, name, slug, status, thumbnail_url, total_views, valid_views, total_earnings')
      .eq('creator_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setCampaigns(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const togglePause = async (id: string, current: string) => {
    setBusy(id);
    const newStatus = current === 'paused' ? 'active' : 'paused';
    const result = await setCampaignStatusAction(id, newStatus);
    setBusy(null);
    if (!result.success) { toast.error(result.error || 'Campaign could not be updated'); return; }
    toast.success(newStatus === 'paused' ? 'Campaign paused' : 'Campaign resumed');
    void load();
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm('Deactivate and remove this campaign from your list?')) return;
    setBusy(id);
    const result = await deleteCampaignAction(id);
    setBusy(null);
    if (!result.success) { toast.error(result.error || 'Campaign could not be deleted'); return; }
    toast.success('Campaign deactivated');
    void load();
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/c/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied!');
  };

  return (
    <>
      <DashboardTopbar title="My Campaigns" subtitle="Manage all your unlock campaigns" />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">All Campaigns</h2>
            <p className="text-sm text-gray-500">{campaigns.length} campaigns</p>
          </div>
          <Link href="/dashboard/create-campaign" className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Campaign
          </Link>
        </div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="skeleton h-48 rounded-2xl" />)}
          </div>
        ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c: any) => {
            const validRate = c.total_views > 0 ? ((c.valid_views / c.total_views) * 100).toFixed(1) : '0.0';
            return (
              <div key={c.id} className="glass-strong rounded-2xl p-5 card-glow">
                {c.thumbnail_url && <img src={c.thumbnail_url} alt={c.name} className="w-full h-32 object-cover rounded-xl mb-3" />}
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{c.name}</h3>
                    <p className="text-xs text-gray-500 truncate">/c/{c.slug}</p>
                  </div>
                  <span className={`badge status-${c.status}`}>{c.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                  <div><div className="text-gray-500">Views</div><div className="font-semibold text-sm">{formatNumber(c.total_views)}</div></div>
                  <div><div className="text-gray-500">Valid</div><div className="font-semibold text-sm">{formatNumber(c.valid_views)}</div></div>
                  <div><div className="text-gray-500">Valid</div><div className="font-semibold text-sm text-blue-400">{validRate}%</div></div>
                  <div><div className="text-gray-500">Earned</div><div className="font-semibold text-sm text-green-400">{formatCurrency(c.total_earnings)}</div></div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Link href={`/dashboard/campaigns/${c.id}/edit`} className="btn-ghost flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1 min-w-0">
                    <Edit className="w-3 h-3" /> Edit
                  </Link>
                  <Link href={`/dashboard/campaigns/${c.id}`} className="btn-ghost flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1 min-w-0">
                    <BarChart3 className="w-3 h-3" /> Stats
                  </Link>
                  <button onClick={() => copyLink(c.slug)} className="btn-ghost py-2 px-2 rounded-lg text-xs flex items-center justify-center" title="Copy link">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button onClick={() => togglePause(c.id, c.status)} disabled={busy === c.id} className="btn-ghost py-2 px-2 rounded-lg text-xs flex items-center justify-center" title={c.status === 'paused' ? 'Resume' : 'Pause'}>
                    {c.status === 'paused' ? <Play className="w-3 h-3 text-green-400" /> : <Pause className="w-3 h-3 text-yellow-400" />}
                  </button>
                  <button onClick={() => deleteCampaign(c.id)} disabled={busy === c.id} className="btn-ghost py-2 px-2 rounded-lg text-xs flex items-center justify-center" title="Delete">
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
          {!campaigns.length && (
            <div className="col-span-full glass-strong rounded-2xl p-12 text-center">
              <div className="text-5xl mb-3">📢</div>
              <h3 className="font-semibold mb-2">No campaigns yet</h3>
              <p className="text-sm text-gray-500 mb-4">Create your first unlock campaign and start earning</p>
              <Link href="/dashboard/create-campaign" className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create Campaign
              </Link>
            </div>
          )}
        </div>
        )}
      </div>
    </>
  );
}