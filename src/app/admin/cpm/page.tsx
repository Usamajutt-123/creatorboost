'use client';
import { useEffect, useState } from 'react';
import { Save, Info, Edit, Check, X, Plus, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const TIERS = [
  { key: 'tier_1', name: 'Tier 1', color: 'from-green-500/15 to-emerald-500/15', desc: 'High-value countries' },
  { key: 'tier_2', name: 'Tier 2', color: 'from-blue-500/15 to-cyan-500/15', desc: 'Mid-value countries' },
  { key: 'tier_3', name: 'Tier 3', color: 'from-purple-500/15 to-pink-500/15', desc: 'Standard countries' },
  { key: 'tier_4', name: 'Tier 4', color: 'from-orange-500/15 to-red-500/15', desc: 'Lower-value' },
];

type Country = {
  id: number;
  country_code: string;
  country_name: string;
  tier: string;
  cpm_min: number;
  cpm_max: number;
  cpm_default: number;
  payout_percentage: number;
  active: boolean;
};

export default function CpmAdminPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<Country>>>({});
  const [loading, setLoading] = useState(false);
  const [levels, setLevels] = useState<any[]>([]);
  const [editingLevel, setEditingLevel] = useState<any | null>(null);
  const [referralPct, setReferralPct] = useState<number>(10);
  const [platformPct, setPlatformPct] = useState<number>(30);
  const [addingCountry, setAddingCountry] = useState(false);
  const [newCountry, setNewCountry] = useState({ code: '', name: '', tier: 'tier_3', cpm_default: 1.0, cpm_min: 0.5, cpm_max: 1.5 });

  const load = async () => {
    const supabase = createClient();
    const [{ data: c }, { data: l }, { data: s }] = await Promise.all([
      supabase.from('country_tiers').select('*').order('tier'),
      supabase.from('creator_levels').select('*').order('sort_order'),
      supabase.from('platform_settings').select('referral_percentage').single(),
    ]);
    setCountries((c || []) as Country[]);
    setLevels(l || []);
    if (s) setReferralPct(Number(s.referral_percentage));
  };

  useEffect(() => { load(); }, []);

  const updateField = (id: number, field: keyof Country, value: any) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  const cur = (c: Country) => ({ ...c, ...(edits[c.id] || {}) });

  const saveAll = async () => {
    if (Object.keys(edits).length === 0) return;
    setLoading(true);
    const supabase = createClient();
    const updates = Object.entries(edits);
    for (const [id, fields] of updates) {
      const { error } = await supabase.from('country_tiers').update(fields).eq('id', parseInt(id));
      if (error) { toast.error(error.message); setLoading(false); return; }
    }
    // Save referral % in platform settings
    if (referralPct !== undefined) {
      await supabase.from('platform_settings').update({ referral_percentage: referralPct }).eq('id', 1);
    }
    setLoading(false);
    setEdits({});
    toast.success(`Saved ${updates.length} updates Â· Changes apply instantly to earnings calculations`);
    load();
  };

  const saveLevel = async () => {
    if (!editingLevel) return;
    const supabase = createClient();
    const { error } = await supabase.from('creator_levels').update({
      cpm_multiplier: parseFloat(editingLevel.cpm_multiplier),
      min_views: parseInt(editingLevel.min_views),
      priority_support: editingLevel.priority_support,
      fast_withdrawal: editingLevel.fast_withdrawal,
      verified_badge: editingLevel.verified_badge,
      premium_analytics: editingLevel.premium_analytics,
    }).eq('id', editingLevel.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Level ${editingLevel.name} updated Â· Multiplier applies instantly`);
    setEditingLevel(null);
    load();
  };

  const toggleCountryActive = async (c: Country) => {
    const supabase = createClient();
    const { error } = await supabase.from('country_tiers').update({ active: !c.active }).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${c.country_name} ${!c.active ? 'activated' : 'deactivated'}`);
    load();
  };

  const addCountry = async () => {
    if (!newCountry.code || !newCountry.name) { toast.error('Code and name are required'); return; }
    const supabase = createClient();
    const { error } = await supabase.from('country_tiers').insert({
      country_code: newCountry.code.toUpperCase().substring(0, 2),
      country_name: newCountry.name,
      tier: newCountry.tier,
      cpm_min: newCountry.cpm_min,
      cpm_max: newCountry.cpm_max,
      cpm_default: newCountry.cpm_default,
      payout_percentage: 70,
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${newCountry.name} added`);
    setAddingCountry(false);
    setNewCountry({ code: '', name: '', tier: 'tier_3', cpm_default: 1.0, cpm_min: 0.5, cpm_max: 1.5 });
    load();
  };

  const deleteCountry = async (id: number, name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('country_tiers').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Country removed');
    load();
  };

  const grouped = TIERS.map(t => ({
    ...t,
    items: countries.filter(c => c.tier === t.key),
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">CPM Rate Management</h2>
          <p className="text-sm text-gray-500">Configure creator payouts per 1000 valid views. All values are dynamic and apply instantly.</p>
        </div>
        <button onClick={saveAll} disabled={loading || !Object.keys(edits).length} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50">
          <Save className="w-4 h-4" /> {loading ? 'Saving...' : `Save ${Object.keys(edits).length || ''} Changes`}
        </button>
      </div>

      <div className="glass rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-gray-300">
          <strong className="text-white">Earnings formula:</strong> earning_per_view = (cpm_default Ã— level_multiplier) / 1000<br />
          Tier 1 base $5, Bronze 1.0x â†’ earning per view = $0.005. Gold (1.25x) on Tier 1 = $0.00625/view. Changes apply to all new views.
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="glass-strong rounded-2xl p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Globe className="w-4 h-4" /> Referral %</h3>
          <p className="text-xs text-gray-500 mb-3">Percentage of creator earnings paid to their referrer</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={referralPct}
              onChange={e => setReferralPct(parseFloat(e.target.value))}
              className="input-field flex-1"
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
        </div>
        <div className="glass-strong rounded-2xl p-5">
          <h3 className="font-semibold mb-2">Platform %</h3>
          <p className="text-xs text-gray-500 mb-3">Platform's share from total ad revenue (remainder = payouts)</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={platformPct}
              onChange={e => setPlatformPct(parseFloat(e.target.value))}
              className="input-field flex-1"
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
        </div>
      </div>

      {/* Country tiers */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">Country CPM Rates</h3>
        <button onClick={() => setAddingCountry(true)} className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Country
        </button>
      </div>

      {addingCountry && (
        <div className="glass-strong rounded-2xl p-5 ring-2 ring-purple-500/40">
          <h4 className="font-semibold mb-3 text-sm">Add New Country</h4>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input value={newCountry.code} onChange={e => setNewCountry({ ...newCountry, code: e.target.value })} className="input-field text-sm py-2" placeholder="Code (e.g. NG)" maxLength={2} />
            <input value={newCountry.name} onChange={e => setNewCountry({ ...newCountry, name: e.target.value })} className="input-field text-sm py-2 col-span-2 sm:col-span-2" placeholder="Country name" />
            <select value={newCountry.tier} onChange={e => setNewCountry({ ...newCountry, tier: e.target.value })} className="input-field text-sm py-2">
              <option value="tier_1">Tier 1</option><option value="tier_2">Tier 2</option><option value="tier_3">Tier 3</option><option value="tier_4">Tier 4</option>
            </select>
            <input type="number" step="0.01" value={newCountry.cpm_default} onChange={e => setNewCountry({ ...newCountry, cpm_default: parseFloat(e.target.value) })} className="input-field text-sm py-2" placeholder="CPM" />
            <div className="flex gap-1">
              <button onClick={addCountry} className="btn-primary flex-1 py-2 rounded-lg text-xs font-semibold text-white"><Check className="w-3.5 h-3.5 inline" /></button>
              <button onClick={() => setAddingCountry(false)} className="btn-ghost flex-1 py-2 rounded-lg text-xs"><X className="w-3.5 h-3.5 inline" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(tier => (
          <div key={tier.key} className={`glass-strong rounded-2xl p-5 bg-gradient-to-br ${tier.color}`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-xl font-bold capitalize">{tier.name}</h3>
                <p className="text-xs text-gray-400">{tier.desc} â€¢ {tier.items.length} countries</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tier.items.map(c => {
                const v = cur(c);
                const flag = String.fromCodePoint(...c.country_code.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
                return (
                  <div key={c.id} className={`glass rounded-xl p-3 ${!v.active ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg flex-shrink-0">{flag}</span>
                        <span className="text-sm font-medium truncate">{c.country_name}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-gray-500 font-mono">{c.country_code}</span>
                        <button onClick={() => toggleCountryActive(c)} className={`p-0.5 rounded text-[10px] ${v.active ? 'text-green-400' : 'text-gray-500'}`} title={v.active ? 'Active' : 'Inactive'}>
                          {v.active ? 'â—' : 'â—‹'}
                        </button>
                        <button onClick={() => deleteCountry(c.id, c.country_name)} className="p-0.5 text-red-400 hover:text-red-300" title="Delete">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <label className="text-gray-500 block mb-0.5">Min $</label>
                        <input type="number" step="0.01" value={v.cpm_min} onChange={e => updateField(c.id, 'cpm_min', parseFloat(e.target.value))} className="input-field py-1 px-2 text-xs" />
                      </div>
                      <div>
                        <label className="text-gray-500 block mb-0.5">Default $</label>
                        <input type="number" step="0.01" value={v.cpm_default} onChange={e => updateField(c.id, 'cpm_default', parseFloat(e.target.value))} className="input-field py-1 px-2 text-xs font-semibold" />
                      </div>
                      <div>
                        <label className="text-gray-500 block mb-0.5">Max $</label>
                        <input type="number" step="0.01" value={v.cpm_max} onChange={e => updateField(c.id, 'cpm_max', parseFloat(e.target.value))} className="input-field py-1 px-2 text-xs" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-gray-500 block text-xs mb-0.5">Payout %</label>
                      <input type="number" step="0.1" value={v.payout_percentage} onChange={e => updateField(c.id, 'payout_percentage', parseFloat(e.target.value))} className="input-field py-1 px-2 text-xs w-full" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Creator levels */}
      <div className="glass-strong rounded-2xl p-5">
        <h3 className="font-display text-lg font-bold mb-1">Creator Level Multipliers</h3>
        <p className="text-xs text-gray-500 mb-4">Multiplier applied on top of country CPM. Changes apply instantly.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {levels.map(l => (
            <div key={l.id} className={`glass rounded-xl p-3 ${editingLevel?.id === l.id ? 'ring-2 ring-purple-500' : ''}`}>
              {editingLevel?.id === l.id ? (
                <div className="space-y-2">
                  <div className="font-semibold text-sm">{l.name}</div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">Multiplier</label>
                    <input type="number" step="0.05" value={editingLevel.cpm_multiplier} onChange={e => setEditingLevel({ ...editingLevel, cpm_multiplier: e.target.value })} className="input-field text-xs py-1 px-2" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">Min Views</label>
                    <input type="number" value={editingLevel.min_views} onChange={e => setEditingLevel({ ...editingLevel, min_views: e.target.value })} className="input-field text-xs py-1 px-2" />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={saveLevel} className="btn-primary flex-1 py-1 rounded text-xs"><Check className="w-3 h-3 inline" /></button>
                    <button onClick={() => setEditingLevel(null)} className="btn-ghost flex-1 py-1 rounded text-xs"><X className="w-3 h-3 inline" /></button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{l.name}</span>
                    <button onClick={() => setEditingLevel(l)} className="text-purple-400"><Edit className="w-3 h-3" /></button>
                  </div>
                  <div className="text-2xl font-bold gradient-text">{Number(l.cpm_multiplier).toFixed(2)}x</div>
                  <div className="text-[10px] text-gray-500 mt-1">{Number(l.min_views).toLocaleString()} views</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {l.priority_support && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Priority</span>}
                    {l.fast_withdrawal && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">Fast</span>}
                    {l.verified_badge && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">Verified</span>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}