'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Edit, Save, X, RefreshCw } from 'lucide-react';
import { adminLoadLevels, adminSaveLevel } from '@/lib/admin-server';

export default function AdminLevelsPage() {
  const [levels, setLevels] = useState<any[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const load = async () => {
    try {
      const rows = await adminLoadLevels();
      setLevels(rows);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load levels');
    }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (l: any) => { setEditing(l.id); setDraft({ ...l }); };

  const save = async () => {
    try {
      await adminSaveLevel(draft.id, {
        name: draft.name,
        min_views: parseInt(draft.min_views),
        cpm_multiplier: parseFloat(draft.cpm_multiplier),
        badge_color: draft.badge_color,
        priority_support: draft.priority_support,
        fast_withdrawal: draft.fast_withdrawal,
        verified_badge: draft.verified_badge,
        premium_analytics: draft.premium_analytics,
      });
      toast.success('Level updated');
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message || 'Save failed'); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">Creator Levels</h2>
        <button onClick={() => { load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {levels.map(l => (
          <div key={l.id} className="glass-strong rounded-2xl p-5 card-glow">
            {editing === l.id && draft ? (
              <div className="space-y-3">
                <div><label className="text-xs text-gray-400">Name</label><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="input-field" /></div>
                <div><label className="text-xs text-gray-400">Min views</label><input type="number" value={draft.min_views} onChange={e => setDraft({ ...draft, min_views: e.target.value })} className="input-field" /></div>
                <div><label className="text-xs text-gray-400">CPM Multiplier</label><input type="number" step="0.05" value={draft.cpm_multiplier} onChange={e => setDraft({ ...draft, cpm_multiplier: e.target.value })} className="input-field" /></div>
                <div><label className="text-xs text-gray-400">Badge color</label><input type="color" value={draft.badge_color} onChange={e => setDraft({ ...draft, badge_color: e.target.value })} className="input-field h-10" /></div>
                {['priority_support', 'fast_withdrawal', 'verified_badge', 'premium_analytics'].map(p => (
                  <label key={p} className="flex items-center justify-between text-sm"><span className="capitalize">{p.replace(/_/g, ' ')}</span><input type="checkbox" checked={!!draft[p]} onChange={e => setDraft({ ...draft, [p]: e.target.checked })} /></label>
                ))}
                <div className="flex gap-2">
                  <button onClick={save} className="btn-primary flex-1 py-2 rounded-lg text-sm text-white flex items-center justify-center gap-1"><Save className="w-3 h-3" /> Save</button>
                  <button onClick={() => setEditing(null)} className="btn-ghost flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1"><X className="w-3 h-3" /> Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full" style={{ background: l.badge_color }} />
                  <h3 className="font-semibold text-lg capitalize">{l.name}</h3>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Min views</span><span>{(l.min_views / 1000).toFixed(0)}K</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Multiplier</span><span className="text-green-400 font-semibold">{l.cpm_multiplier}x</span></div>
                  <div className="text-xs text-gray-500 mt-2">
                    {l.priority_support && '✓ Priority support · '}{l.fast_withdrawal && '✓ Fast withdrawals · '}{l.verified_badge && '✓ Verified · '}{l.premium_analytics && '✓ Premium analytics'}
                  </div>
                </div>
                <button onClick={() => startEdit(l)} className="btn-ghost w-full mt-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1"><Edit className="w-3 h-3" /> Edit Level</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
