'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Info, Edit, Check, X, Plus, Globe, RefreshCw, Search } from 'lucide-react';
import Select from '@/components/Select';
import { adminLoadCountries, adminLoadLevels, adminLoadSettings, adminSaveCountryUpdates, adminAddCountry, adminDeleteCountry, adminSaveLevel, adminSaveSettings } from '@/lib/admin-server';
import { getCpmSettingsAction, updateCpmAction } from '@/lib/cpm-actions';

const TIERS = [
  { key: 'tier_1', name: 'Tier 1', color: 'from-green-500/15 to-emerald-500/15', desc: 'High-value countries' },
  { key: 'tier_2', name: 'Tier 2', color: 'from-blue-500/15 to-cyan-500/15', desc: 'Mid-value countries' },
  { key: 'tier_3', name: 'Tier 3', color: 'from-purple-500/15 to-pink-500/15', desc: 'Standard countries' },
  { key: 'tier_4', name: 'Tier 4', color: 'from-orange-500/15 to-red-500/15', desc: 'Lower-value' },
];

type Country = { id: number; country_code: string; country_name: string; tier: string; cpm_min: number; cpm_max: number; cpm_default: number; payout_percentage: number; active: boolean };
type CountryField = 'country_code' | 'country_name' | 'tier' | 'cpm_min' | 'cpm_max' | 'cpm_default' | 'payout_percentage' | 'active';

export default function CpmAdminClient({
  initialCountries,
  initialLevels,
  initialReferralPct,
  initialGlobalCpm,
  initialMinCpm,
  initialMaxCpm,
  initialCpmMeta,
  initialCpmError,
  initialLoadError,
}: {
  initialCountries: Country[];
  initialLevels: any[];
  initialReferralPct: number;
  initialGlobalCpm: string;
  initialMinCpm: string;
  initialMaxCpm: string;
  initialCpmMeta: { updatedAt?: string; updatedBy?: string | null; unauthorized?: boolean; loadError?: string };
  initialCpmError: string | null;
  initialLoadError: string | null;
}) {
  useEffect(() => {
    if (!initialLoadError) return;
    toast.error(initialLoadError);
  }, [initialLoadError]);
  // All configuration is server-rendered (see page.tsx): the tables, level
  // cards and CPM inputs appear with the first paint instead of after four
  // post-hydration server-action round-trips.
  const [countries, setCountries] = useState<Country[]>(initialCountries);
  const [edits, setEdits] = useState<Record<number, Partial<Country>>>({});
  const [loading, setLoading] = useState(false);
  const [levels, setLevels] = useState<any[]>(initialLevels);
  const [editingLevel, setEditingLevel] = useState<any | null>(null);
  const [referralPct, setReferralPct] = useState(String(initialReferralPct));
  const [savedReferralPct, setSavedReferralPct] = useState(String(initialReferralPct));
  const [addingCountry, setAddingCountry] = useState(false);
  const [newCountry, setNewCountry] = useState({ code: '', name: '', tier: 'tier_3', cpm_default: '1.0', cpm_min: '0.5', cpm_max: '1.5' });
  const [globalCpm, setGlobalCpm] = useState(initialGlobalCpm);
  const [minCpm, setMinCpm] = useState(initialMinCpm);
  const [maxCpm, setMaxCpm] = useState(initialMaxCpm);
  const [cpmMeta, setCpmMeta] = useState<{ updatedAt?: string; updatedBy?: string | null; unauthorized?: boolean; loadError?: string }>(initialCpmMeta);
  const [savingCpm, setSavingCpm] = useState(false);
  const [cpmMessage, setCpmMessage] = useState<string | null>(null);
  const [cpmError, setCpmError] = useState<string | null>(initialCpmError);
  const [pageLoading, setPageLoading] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [editingCountryId, setEditingCountryId] = useState<number | null>(null);

  const load = async () => {
    setPageLoading(true);
    try {
      const [c, l, s, cpm] = await Promise.all([adminLoadCountries(), adminLoadLevels(), adminLoadSettings(), getCpmSettingsAction()]);
      setCountries(c as Country[]);
      setLevels(l);
      if (s) {
        const nextReferralPct = String(s.referral_percentage ?? '');
        setReferralPct(nextReferralPct);
        setSavedReferralPct(nextReferralPct);
      }
      if (cpm.ok) {
        setGlobalCpm(String(cpm.settings.cpm ?? ''));
        setMinCpm(String(cpm.settings.min_cpm ?? ''));
        setMaxCpm(String(cpm.settings.max_cpm ?? ''));
        setCpmMeta({
          updatedAt: String(cpm.settings.updated_at || ''),
          updatedBy: cpm.updatedByName,
        });
        setCpmError(null);
      } else {
        setCpmMeta({ unauthorized: cpm.error.includes('Admin') || cpm.error.includes('authenticated'), loadError: cpm.error });
        setCpmError(cpm.error);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to load CPM data');
      setCpmError(e.message || 'Failed to load CPM data');
    } finally {
      setPageLoading(false);
    }
  };
  const updateField = (id: number, field: CountryField, value: string | boolean) => {
    // Keep input text while the admin is typing. Converting an empty number
    // input with parseFloat('') produces NaN, which creates an invalid
    // controlled value and made server-action failures look like a React
    // runtime error. The server validates the final string numerically.
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };
  const cur = (c: Country) => ({ ...c, ...(edits[c.id] || {}) });

  const saveAll = async () => {
    const pending = Object.entries(edits).map(([id, fields]) => ({ id: parseInt(id, 10), fields }));
    const referralChanged = referralPct !== savedReferralPct;
    if (pending.length === 0 && !referralChanged) return;
    setLoading(true);
    try {
      if (pending.length) await adminSaveCountryUpdates(pending);
      if (referralChanged) {
        await adminSaveSettings({ referral_percentage: Number(referralPct) });
        setSavedReferralPct(referralPct);
      }
      toast.success(`Saved ${pending.length} updates — changes apply instantly to earnings calculations`);
      setEdits({});
      setEditingCountryId(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const saveLevel = async () => {
    if (!editingLevel) return;
    try {
      await adminSaveLevel(editingLevel.id, {
        cpm_multiplier: parseFloat(editingLevel.cpm_multiplier),
        min_views: parseInt(editingLevel.min_views),
        priority_support: editingLevel.priority_support,
        fast_withdrawal: editingLevel.fast_withdrawal,
        verified_badge: editingLevel.verified_badge,
        premium_analytics: editingLevel.premium_analytics,
      });
      toast.success(`Level ${editingLevel.name} updated`);
      setEditingLevel(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    }
  };

  const toggleCountryActive = async (c: Country) => {
    try {
      await adminSaveCountryUpdates([{ id: c.id, fields: { active: !c.active } }]);
      toast.success(`${c.country_name} ${!c.active ? 'activated' : 'deactivated'}`);
      await load();
    } catch (e: any) { toast.error(e.message || 'Action failed'); }
  };

  const addCountry = async () => {
    if (!newCountry.code || !newCountry.name) { toast.error('Code and name are required'); return; }
    try {
      await adminAddCountry({
        country_code: newCountry.code.toUpperCase().substring(0, 2),
        country_name: newCountry.name,
        tier: newCountry.tier,
        cpm_min: Number(newCountry.cpm_min),
        cpm_max: Number(newCountry.cpm_max),
        cpm_default: Number(newCountry.cpm_default),
        payout_percentage: 70,
        active: true,
      });
      toast.success(`${newCountry.name} added`);
      setAddingCountry(false);
      setNewCountry({ code: '', name: '', tier: 'tier_3', cpm_default: '1.0', cpm_min: '0.5', cpm_max: '1.5' });
      await load();
    } catch (e: any) { toast.error(e.message || 'Add failed'); }
  };

  const deleteCountry = async (id: number, name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    try { await adminDeleteCountry(id); toast.success('Country removed'); await load(); }
    catch (e: any) { toast.error(e.message || 'Delete failed'); }
  };

  const search = countrySearch.trim().toLowerCase();
  const visibleCountries = search
    ? countries.filter(c => {
      const row = cur(c);
      return row.country_name.toLowerCase().includes(search) || row.country_code.toLowerCase().includes(search);
    })
    : countries;
  const grouped = TIERS.map(t => ({ ...t, items: visibleCountries.filter(c => c.tier === t.key) }));
  const appliedCountryCpm = (c: Country) => {
    const row = cur(c);
    return row.active ? Number(row.cpm_default) : Number(globalCpm || 0);
  };

  const saveGlobalCpm = async () => {
    setSavingCpm(true);
    setCpmMessage(null);
    setCpmError(null);
    try {
      const result = await updateCpmAction({
        cpm: Number(globalCpm),
        minCpm: Number(minCpm),
        maxCpm: Number(maxCpm),
      });
      if (!result.ok) {
        setCpmError(result.error);
        toast.error(result.error);
        return;
      }
      setGlobalCpm(String(result.cpm));
      setMinCpm(String(result.minCpm));
      setMaxCpm(String(result.maxCpm));
      setCpmMeta(prev => ({ ...prev, updatedAt: result.updatedAt }));
      setCpmMessage(`CPM saved at $${result.cpm.toFixed(4)} per 1000 valid views. New views use this rate immediately.`);
      toast.success('Global CPM updated');
      await load();
    } catch (e: any) {
      setCpmError(e.message || 'Database error');
      toast.error(e.message || 'Save failed');
    } finally {
      setSavingCpm(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">CPM Rate Management</h2>
          <p className="text-sm text-gray-500">Configure trusted CPM inputs per 1000 eligible views. Changes are applied to newly accounted views.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button onClick={saveAll} disabled={loading || (!Object.keys(edits).length && referralPct === savedReferralPct)} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" /> {loading ? 'Saving...' : `Save ${Object.keys(edits).length || ''} Changes`}
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-gray-300">
          <strong className="text-white">Earnings formula:</strong> earning_per_view = (active_CPM × level_multiplier) / 1000.<br />
          active_CPM is the creator&apos;s country CPM when that country has an active custom rate; otherwise Global CPM is used. New valid views use the current rate immediately. Already credited earnings are not recalculated.
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Global CPM (source of truth)</h3>
            <p className="text-xs text-gray-500">1000 valid views = current CPM. Stored as NUMERIC in the database.</p>
          </div>
          {pageLoading && <span className="text-xs text-gray-500">Loading…</span>}
        </div>
        {cpmMeta.unauthorized && (
          <p className="text-sm text-red-400">You are not authorized to manage CPM.</p>
        )}
        {cpmError && <p className="text-sm text-red-400">{cpmError}</p>}
        {cpmMessage && <p className="text-sm text-green-400">{cpmMessage}</p>}
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">CPM ($ / 1000 views)</label>
            <input type="number" step="0.000001" min="0" value={globalCpm} onChange={e => setGlobalCpm(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Min CPM</label>
            <input type="number" step="0.000001" min="0" value={minCpm} onChange={e => setMinCpm(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Max CPM</label>
            <input type="number" step="0.000001" min="0" value={maxCpm} onChange={e => setMaxCpm(e.target.value)} className="input-field" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <div>
            <div>Current CPM: <strong className="text-white">${Number(globalCpm || 0).toFixed(4)}</strong></div>
            <div>Last updated: {cpmMeta.updatedAt ? new Date(cpmMeta.updatedAt).toLocaleString() : '—'}</div>
            <div>Updated by: {cpmMeta.updatedBy || '—'}</div>
          </div>
          <button onClick={saveGlobalCpm} disabled={savingCpm || pageLoading || cpmMeta.unauthorized} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
            {savingCpm ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Globe className="w-4 h-4" /> Referral %</h3>
        <p className="text-xs text-gray-500 mb-3">Percentage of a referred creator&apos;s earnings paid to their referrer</p>
        <div className="flex items-center gap-2">
          <input type="number" step="0.1" min="0" max="100" value={referralPct} onChange={e => setReferralPct(e.target.value)} className="input-field flex-1" />
          <span className="text-sm text-gray-400">%</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold">Country CPM Rates</h3>
          <p className="text-xs text-gray-500">Custom rates override Global CPM for creators in that country. Disable a row to fall back to Global CPM.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={countrySearch}
              onChange={e => setCountrySearch(e.target.value)}
              className="input-field text-xs py-1.5 pl-8 w-48"
              placeholder="Search countries"
              aria-label="Search countries"
            />
          </div>
          <button onClick={() => setAddingCountry(true)} className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Country</button>
        </div>
      </div>

      {addingCountry && (
        <div className="glass-strong rounded-2xl p-5 ring-2 ring-purple-500/40">
          <h4 className="font-semibold mb-3 text-sm">Add New Country</h4>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input value={newCountry.code} onChange={e => setNewCountry({ ...newCountry, code: e.target.value })} className="input-field text-sm py-2" placeholder="Code (e.g. NG)" maxLength={2} />
            <input value={newCountry.name} onChange={e => setNewCountry({ ...newCountry, name: e.target.value })} className="input-field text-sm py-2 col-span-2" placeholder="Country name" />
            <Select value={newCountry.tier} onChange={value => setNewCountry({ ...newCountry, tier: value })} ariaLabel="Tier" triggerClassName="text-sm py-2" options={[
              { value: 'tier_1', label: 'Tier 1' },
              { value: 'tier_2', label: 'Tier 2' },
              { value: 'tier_3', label: 'Tier 3' },
              { value: 'tier_4', label: 'Tier 4' },
            ]} />
            <input type="number" step="0.01" min="0" value={newCountry.cpm_default} onChange={e => setNewCountry({ ...newCountry, cpm_default: e.target.value })} className="input-field text-sm py-2" placeholder="CPM" />
            <div className="flex gap-1">
              <button onClick={addCountry} aria-label="Confirm add country" className="btn-primary flex-1 py-2 rounded-lg text-xs font-semibold text-white"><Check className="w-3.5 h-3.5 inline" /></button>
              <button onClick={() => setAddingCountry(false)} aria-label="Cancel add country" className="btn-ghost flex-1 py-2 rounded-lg text-xs"><X className="w-3.5 h-3.5 inline" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(g => (
          <div key={g.key} className={`glass-strong rounded-2xl p-5 bg-gradient-to-br ${g.color}`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">{g.name} <span className="text-xs text-gray-400 font-normal">· {g.desc}</span></h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm min-w-[860px]">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-2 font-medium">Country</th>
                    <th className="text-left py-2 font-medium">CPM Default</th>
                    <th className="text-left py-2 font-medium">CPM Min</th>
                    <th className="text-left py-2 font-medium">CPM Max</th>
                    <th className="text-left py-2 font-medium">Applied CPM</th>
                    <th className="text-left py-2 font-medium">Source</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map(c => {
                    const row = cur(c);
                    return (
                      <tr key={c.id} className="border-b border-white/5 table-row">
                        <td className="py-2.5 font-medium">
                          {editingCountryId === c.id ? (
                            <div className="space-y-1.5">
                              <input value={row.country_name} onChange={e => updateField(c.id, 'country_name', e.target.value)} className="input-field py-1.5 text-xs w-40" aria-label={`${row.country_name} country name`} />
                              <div className="flex items-center gap-1.5">
                                <input value={row.country_code} onChange={e => updateField(c.id, 'country_code', e.target.value.toUpperCase())} maxLength={2} className="input-field py-1.5 text-xs w-14 font-mono uppercase" aria-label={`${row.country_name} country code`} />
                                <Select value={row.tier} onChange={value => updateField(c.id, 'tier', value)} ariaLabel="Country tier" triggerClassName="text-xs py-1.5" options={TIERS.map(t => ({ value: t.key, label: t.name }))} />
                              </div>
                            </div>
                          ) : <>{row.country_name} <span className="text-gray-500 font-mono text-xs">({row.country_code})</span></>}
                        </td>
                        <td className="py-2.5"><input type="number" step="0.01" min="0" value={row.cpm_default} onChange={e => updateField(c.id, 'cpm_default', e.target.value)} className="input-field py-1.5 text-xs w-24" /></td>
                        <td className="py-2.5"><input type="number" step="0.01" min="0" value={row.cpm_min} onChange={e => updateField(c.id, 'cpm_min', e.target.value)} className="input-field py-1.5 text-xs w-20" /></td>
                        <td className="py-2.5"><input type="number" step="0.01" min="0" value={row.cpm_max} onChange={e => updateField(c.id, 'cpm_max', e.target.value)} className="input-field py-1.5 text-xs w-20" /></td>
                        <td className="py-2.5 font-semibold">${appliedCountryCpm(c).toFixed(2)}</td>
                        <td className="py-2.5"><span className={`badge ${row.active ? 'status-active' : 'status-rejected'}`}>{row.active ? 'Custom' : 'Global fallback'}</span></td>
                        <td className="py-2.5"><span className={`badge ${row.active ? 'status-active' : 'status-rejected'}`}>{row.active ? 'Active' : 'Inactive'}</span></td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setEditingCountryId(editingCountryId === c.id ? null : c.id)} className="btn-ghost px-2 py-1 rounded text-[10px] flex items-center gap-1">
                              {editingCountryId === c.id ? <><Check className="w-3 h-3" /> Done</> : <><Edit className="w-3 h-3" /> Edit</>}
                            </button>
                            <button onClick={() => toggleCountryActive(c)} className="btn-ghost px-2 py-1 rounded text-[10px]">{row.active ? 'Disable' : 'Enable'}</button>
                            <button onClick={() => deleteCountry(c.id, c.country_name)} className="btn-ghost px-2 py-1 rounded text-[10px] text-red-400">Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!g.items.length && <tr><td colSpan={6} className="py-4 text-center text-gray-500 text-xs">No countries in this tier</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Creator levels */}
      <div className="glass-strong rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Creator Level Multipliers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm min-w-[640px]">
            <thead>
              <tr className="text-gray-500 border-b border-white/10"><th className="text-left py-2 font-medium">Level</th><th className="text-left py-2 font-medium">Min Views</th><th className="text-left py-2 font-medium">CPM Multiplier</th><th className="text-left py-2 font-medium">Perks</th><th className="text-right py-2 font-medium">Actions</th></tr>
            </thead>
            <tbody>
              {levels.map(l => (
                <tr key={l.id} className="border-b border-white/5 table-row">
                  <td className="py-3 capitalize font-medium">{l.name}</td>
                  <td className="py-3">{(l.min_views / 1000).toFixed(0)}K</td>
                  <td className="py-3 text-green-400 font-semibold">{l.cpm_multiplier}x</td>
                  <td className="py-3 text-gray-400 text-xs">
                    {l.priority_support && 'Priority support · '}{l.fast_withdrawal && 'Fast withdrawals · '}{l.verified_badge && 'Verified · '}{l.premium_analytics && 'Premium analytics'}
                  </td>
                  <td className="py-3 text-right">
                    {editingLevel?.id === l.id ? (
                      <button onClick={saveLevel} className="btn-primary px-2 py-1 rounded text-[10px] text-white flex items-center gap-1 ml-auto"><Check className="w-3 h-3" /> Save</button>
                    ) : (
                      <button onClick={() => setEditingLevel({ ...l })} className="btn-ghost px-2 py-1 rounded text-[10px] flex items-center gap-1"><Edit className="w-3 h-3" /> Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editingLevel && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-white/5 pt-4">
            <div><label className="text-[10px] text-gray-500 block mb-1">Min Views</label><input type="number" value={editingLevel.min_views} onChange={e => setEditingLevel({ ...editingLevel, min_views: e.target.value })} className="input-field text-sm py-2" /></div>
            <div><label className="text-[10px] text-gray-500 block mb-1">CPM Multiplier</label><input type="number" step="0.05" value={editingLevel.cpm_multiplier} onChange={e => setEditingLevel({ ...editingLevel, cpm_multiplier: e.target.value })} className="input-field text-sm py-2" /></div>
            <div className="col-span-2 sm:col-span-1 flex items-end gap-3 pb-1">
              {['priority_support', 'fast_withdrawal', 'verified_badge', 'premium_analytics'].map(p => (
                <label key={p} className="flex items-center gap-1 text-[10px] text-gray-400 capitalize"><input type="checkbox" checked={!!editingLevel[p]} onChange={e => setEditingLevel({ ...editingLevel, [p]: e.target.checked })} /> {p.replace(/_/g, ' ')}</label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
