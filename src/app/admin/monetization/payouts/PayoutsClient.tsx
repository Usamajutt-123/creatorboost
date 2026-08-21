'use client';

/**
 * Payout configuration: creator share + per-view bounds + fraud adjustment,
 * the country tier manager (move countries between tiers), creator-level
 * multipliers, and the manual gross revenue ledger.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Loader2, Globe, Award, Banknote, Trash2, Plus, FileSpreadsheet } from 'lucide-react';
import {
  monetizationSavePayoutSettings,
  monetizationImportRevenue,
  monetizationDeleteRevenue,
  type RevenueRowInput,
} from '@/lib/monetization/monetization-admin';
import {
  adminSaveCountryUpdates,
  adminSaveLevel,
} from '@/lib/admin-server';

type PayoutShape = {
  creator_share_percent: number;
  min_payout_per_view: number;
  max_payout_per_view: number;
  fraud_adjustment_percent: number;
  fraud_adjustment_threshold: number;
};

type CountryRow = {
  id: number;
  country_code: string;
  country_name: string;
  tier: string;
  cpm_min: string | number;
  cpm_max: string | number;
  cpm_default: string | number;
  payout_percentage: string | number;
  active: boolean;
};

type LevelRow = {
  id: number;
  name: string;
  cpm_multiplier: number;
  active: boolean;
};

type RevenueRow = {
  id: number;
  revenue_date: string;
  network: string;
  impressions: number;
  clicks: number;
  revenue: number;
  source: string;
};

const TIERS = [
  { key: 'tier_1', name: 'Tier 1', desc: 'High-value countries', color: 'text-green-300' },
  { key: 'tier_2', name: 'Tier 2', desc: 'Mid-value countries', color: 'text-blue-300' },
  { key: 'tier_3', name: 'Tier 3', desc: 'Standard countries', color: 'text-purple-300' },
  { key: 'tier_4', name: 'Tier 4', desc: 'Lower-value', color: 'text-orange-300' },
];

export default function PayoutsClient({
  initialPayouts,
  initialCountries,
  initialLevels,
  initialRevenue,
  initialError,
}: {
  initialPayouts: Record<string, unknown> | null;
  initialCountries: CountryRow[];
  initialLevels: LevelRow[];
  initialRevenue: RevenueRow[];
  initialError: string | null;
}) {
  const [payouts, setPayouts] = useState<PayoutShape>({
    creator_share_percent: Number(initialPayouts?.creator_share_percent ?? 100),
    min_payout_per_view: Number(initialPayouts?.min_payout_per_view ?? 0.0005),
    max_payout_per_view: Number(initialPayouts?.max_payout_per_view ?? 0.05),
    fraud_adjustment_percent: Number(initialPayouts?.fraud_adjustment_percent ?? 0),
    fraud_adjustment_threshold: Number(initialPayouts?.fraud_adjustment_threshold ?? 40),
  });
  const [savingPayouts, setSavingPayouts] = useState(false);

  const [countries, setCountries] = useState<CountryRow[]>(initialCountries);
  const [countryEdits, setCountryEdits] = useState<Record<number, Partial<CountryRow>>>({});
  const [savingCountries, setSavingCountries] = useState(false);

  const [levels, setLevels] = useState<LevelRow[]>(initialLevels);
  const [levelEdits, setLevelEdits] = useState<Record<number, number>>({});
  const [savingLevelId, setSavingLevelId] = useState<number | null>(null);

  const [revenue, setRevenue] = useState<RevenueRow[]>(initialRevenue);
  const [revenueText, setRevenueText] = useState('');
  const [savingRevenue, setSavingRevenue] = useState(false);
  const [deletingRevenueId, setDeletingRevenueId] = useState<number | null>(null);

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  // ---------------- Payout settings ----------------
  const savePayouts = async () => {
    setSavingPayouts(true);
    try {
      const result = await monetizationSavePayoutSettings(payouts as unknown as Record<string, unknown>);
      if (result.ok) toast.success('Payout settings saved');
      else toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Payout settings could not be saved');
    } finally {
      setSavingPayouts(false);
    }
  };

  // ---------------- Country tiers ----------------
  const editCountry = (id: number, patch: Partial<CountryRow>) =>
    setCountryEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  const saveCountries = async () => {
    const updates = Object.entries(countryEdits).map(([id, fields]) => ({ id: Number(id), fields }));
    if (updates.length === 0) return toast.info('No country changes to save');
    setSavingCountries(true);
    try {
      const result = await adminSaveCountryUpdates(updates);
      if (result.ok) {
        toast.success('Country rates saved — live for the next qualified view');
        setCountries(prev => prev.map(c => ({ ...c, ...(countryEdits[c.id] || {}) })));
        setCountryEdits({});
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Country rates could not be saved');
    } finally {
      setSavingCountries(false);
    }
  };

  const tierOf = (row: CountryRow) => countryEdits[row.id]?.tier ?? row.tier;
  const cpmOf = (row: CountryRow) => countryEdits[row.id]?.cpm_default ?? row.cpm_default;

  // ---------------- Levels ----------------
  const saveLevel = async (level: LevelRow) => {
    setSavingLevelId(level.id);
    try {
      const result = await adminSaveLevel(level.id, { cpm_multiplier: levelEdits[level.id] ?? level.cpm_multiplier });
      if (result.ok) {
        toast.success(`${level.name} multiplier saved`);
        setLevels(prev => prev.map(l => (l.id === level.id ? { ...l, cpm_multiplier: levelEdits[level.id] ?? l.cpm_multiplier } : l)));
        setLevelEdits(prev => {
          const next = { ...prev };
          delete next[level.id];
          return next;
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Level could not be saved');
    } finally {
      setSavingLevelId(null);
    }
  };

  // ---------------- Revenue ledger ----------------
  const parseRevenueRows = (): RevenueRowInput[] => {
    const rows: RevenueRowInput[] = [];
    for (const line of revenueText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: YYYY-MM-DD, network, revenue[, impressions[, clicks[, country]]]
      const [date, network, revenueStr, impressionsStr, clicksStr, countryStr] = trimmed.split(',').map(s => s.trim());
      rows.push({
        date,
        network: network.toLowerCase(),
        revenue: Number(revenueStr),
        impressions: impressionsStr ? Number(impressionsStr) : undefined,
        clicks: clicksStr ? Number(clicksStr) : undefined,
        country: countryStr || undefined,
      });
    }
    return rows;
  };

  const importRevenue = async () => {
    const rows = parseRevenueRows();
    if (rows.length === 0) return toast.info('Paste rows as: date, network, revenue, impressions, clicks, country');
    setSavingRevenue(true);
    try {
      const result = await monetizationImportRevenue(rows);
      if (result.ok) {
        toast.success(`${result.imported} revenue row${result.imported === 1 ? '' : 's'} imported (manual)`);
        setRevenueText('');
        const { monetizationLoadRevenue } = await import('@/lib/monetization/monetization-admin');
        setRevenue(await monetizationLoadRevenue() as never[]);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revenue could not be imported');
    } finally {
      setSavingRevenue(false);
    }
  };

  const removeRevenue = async (id: number) => {
    if (!window.confirm('Delete this revenue entry?')) return;
    setDeletingRevenueId(id);
    try {
      const result = await monetizationDeleteRevenue(id);
      if (!result.ok) return toast.error(result.error);
      toast.success('Revenue entry deleted');
      setRevenue(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revenue entry could not be deleted');
    } finally {
      setDeletingRevenueId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Payout formula settings */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-1"><Banknote className="w-4 h-4 text-purple-300" /> Payout Rate Settings</h2>
        <p className="text-xs text-gray-400 mb-4">
          Applied on top of the existing formula: earning = (country CPM × level multiplier) / 1000, from qualified
          views only. These are planning controls — set them to what your ad revenue actually supports.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Creator share (%)</span>
            <input
              type="number" min={0} max={100} step={0.5}
              value={payouts.creator_share_percent}
              onChange={e => setPayouts(p => ({ ...p, creator_share_percent: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Min payout / view ($)</span>
            <input
              type="number" min={0} max={10} step={0.0001}
              value={payouts.min_payout_per_view}
              onChange={e => setPayouts(p => ({ ...p, min_payout_per_view: Math.min(Math.max(Number(e.target.value) || 0, 0), 10) }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Max payout / view ($)</span>
            <input
              type="number" min={0} max={10} step={0.0001}
              value={payouts.max_payout_per_view}
              onChange={e => setPayouts(p => ({ ...p, max_payout_per_view: Math.min(Math.max(Number(e.target.value) || 0, 0), 10) }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Fraud adjustment (%)</span>
            <input
              type="number" min={0} max={100} step={1}
              value={payouts.fraud_adjustment_percent}
              onChange={e => setPayouts(p => ({ ...p, fraud_adjustment_percent: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
            />
          </label>
          <label className="block sm:col-span-2 lg:col-span-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Fraud threshold (score 0–100 — the adjustment above applies to valid views at or above this score)
            </span>
            <input
              type="number" min={0} max={100} step={1}
              value={payouts.fraud_adjustment_threshold}
              onChange={e => setPayouts(p => ({ ...p, fraud_adjustment_threshold: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
            />
          </label>
        </div>
        <button
          onClick={savePayouts}
          disabled={savingPayouts}
          className="btn-primary mt-4 px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {savingPayouts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save payout settings
        </button>
      </section>

      {/* Country tiers */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-1"><Globe className="w-4 h-4 text-purple-300" /> Country Tiers</h2>
        <p className="text-xs text-gray-400 mb-4">
          Move countries between tiers and set the default CPM (used in the earning formula). Tier 1 is the
          high-value group (US, UK, CA, AU, DE…).
        </p>
        <div className="space-y-4 mb-4">
          {TIERS.map(tier => {
            const rows = countries.filter(c => tierOf(c) === tier.key);
            return (
              <div key={tier.key} className="glass rounded-xl p-4 border border-white/10">
                <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                  <div>
                    <span className={`text-sm font-bold ${tier.color}`}>{tier.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{tier.desc} · {rows.length} countries</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map(row => (
                    <div key={row.id} className="bg-black/25 border border-white/10 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-200">{row.country_code}</span>
                      <select
                        value={tierOf(row)}
                        onChange={e => editCountry(row.id, { tier: e.target.value })}
                        className="bg-transparent text-[10px] text-gray-400 focus:outline-none"
                        aria-label={`Tier for ${row.country_name}`}
                      >
                        {TIERS.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                      </select>
                      <input
                        type="number" min={0} max={1000} step={0.01}
                        value={Number(cpmOf(row))}
                        onChange={e => editCountry(row.id, { cpm_default: e.target.value })}
                        className="w-16 bg-black/30 border border-white/10 rounded-md px-1.5 py-0.5 text-[11px] text-green-300 focus:border-purple-500/60 focus:outline-none"
                        aria-label={`CPM for ${row.country_name}`}
                        title="Default CPM ($ per 1000 qualified views)"
                      />
                    </div>
                  ))}
                  {rows.length === 0 && <span className="text-xs text-gray-600">No countries in this tier.</span>}
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={saveCountries}
          disabled={savingCountries}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {savingCountries ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save country changes
        </button>
      </section>

      {/* Level multipliers */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-4"><Award className="w-4 h-4 text-purple-300" /> Creator Level Multipliers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map(level => (
            <div key={level.id} className="glass rounded-xl p-4 border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{level.name}</span>
                <span className="text-xs text-gray-500">{level.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={100} step={0.05}
                  value={levelEdits[level.id] ?? level.cpm_multiplier}
                  onChange={e => setLevelEdits(prev => ({ ...prev, [level.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) }))}
                  className="flex-1 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  aria-label={`${level.name} multiplier`}
                />
                <span className="text-xs text-gray-500">×</span>
                <button
                  onClick={() => saveLevel(level)}
                  disabled={savingLevelId === level.id || levelEdits[level.id] === undefined}
                  className="btn-primary px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-40"
                >
                  {savingLevelId === level.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-600 mt-3">
          Multipliers multiply the country CPM in the existing earnings engine (Starter 1.0× → Premium 1.3×).
          Editing here updates the same table as Admin → Creator Levels.
        </p>
      </section>

      {/* Revenue ledger */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-1"><FileSpreadsheet className="w-4 h-4 text-purple-300" /> Gross Revenue Ledger</h2>
        <p className="text-xs text-gray-400 mb-4">
          Ad revenue is entered manually until a provider API is connected — every entry is labeled MANUAL.
          One row per line: <code className="text-purple-300">date, network, revenue[, impressions, clicks, country]</code>
        </p>
        <textarea
          value={revenueText}
          onChange={e => setRevenueText(e.target.value)}
          rows={4}
          placeholder={'2026-08-20, adsterra, 12.45, 8000, 320, US\n2026-08-20, monetag, 8.10, 6000, 210'}
          className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white focus:border-purple-500/60 focus:outline-none resize-y"
        />
        <button
          onClick={importRevenue}
          disabled={savingRevenue}
          className="btn-primary mt-3 px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {savingRevenue ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Import revenue (manual)
        </button>

        {revenue.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 pr-4 font-semibold">Date</th>
                  <th className="text-left py-2 pr-4 font-semibold">Network</th>
                  <th className="text-right py-2 pr-4 font-semibold">Impressions</th>
                  <th className="text-right py-2 pr-4 font-semibold">Clicks</th>
                  <th className="text-right py-2 pr-4 font-semibold">Revenue</th>
                  <th className="text-right py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {revenue.slice(0, 50).map(row => (
                  <tr key={row.id} className="border-b border-white/5">
                    <td className="py-2 pr-4 text-gray-300">{row.revenue_date}</td>
                    <td className="py-2 pr-4 text-gray-300 capitalize">{row.network}</td>
                    <td className="py-2 pr-4 text-right text-gray-400">{row.impressions.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-gray-400">{row.clicks.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-green-300 font-semibold">${Number(row.revenue).toFixed(4)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => removeRevenue(row.id)}
                        disabled={deletingRevenueId === row.id}
                        className="p-1.5 rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        aria-label="Delete revenue entry"
                      >
                        {deletingRevenueId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-2">Manual revenue data — verify against your ad network dashboards</p>
          </div>
        )}
      </section>
    </div>
  );
}
