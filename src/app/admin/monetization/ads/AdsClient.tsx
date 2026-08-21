'use client';

/**
 * Per-page ad slot management.
 *
 * Pages: Task Page + Step 1..N (following the current step order).
 * Each page holds up to 3 slots; each slot carries its own network, format,
 * zone/code/url, placement, device targeting, priority and frequency.
 *
 * Only the ADMIN pastes ad code here — creators have no path to ad
 * configuration — and the code is sanitized/validated before storage.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Save, Loader2, Plus, Trash2, Info } from 'lucide-react';
import {
  monetizationSaveSlot,
  monetizationAddSlot,
  monetizationDeleteSlot,
  monetizationLoadAll,
} from '@/lib/monetization/monetization-admin';
import { AD_FORMAT_LABELS, AD_FORMAT_OPTIONS, AD_NETWORK_OPTIONS } from '@/lib/monetization/ad-constants';

type SlotRow = {
  id: number;
  page_key: string;
  slot_number: number;
  enabled: boolean;
  network: string;
  format: string;
  zone_id: string | null;
  code: string | null;
  url: string | null;
  placement: 'top' | 'middle' | 'bottom';
  device_target: 'all' | 'desktop' | 'mobile';
  priority: number;
  frequency: 'once_per_session' | 'every_view';
};

type StepRow = { position: number; title: string; status: string };

const NETWORK_LABELS: Record<string, string> = {
  adsterra: 'Adsterra',
  monetag: 'Monetag',
  custom: 'Custom network',
  placeholder: 'Placeholder',
};

export default function AdsClient({ initialSlots, initialSteps, initialError }: {
  initialSlots: SlotRow[];
  initialSteps: StepRow[];
  initialError: string | null;
}) {
  const pages = useMemo(() => {
    const list: { key: string; label: string }[] = [{ key: 'task_page', label: 'Task Page' }];
    for (const step of [...initialSteps].sort((a, b) => a.position - b.position)) {
      if (step.status !== 'enabled') continue;
      list.push({ key: `step_${step.position}`, label: `Step ${step.position} · ${step.title}` });
    }
    return list;
  }, [initialSteps]);

  const [activePage, setActivePage] = useState(pages[0]?.key ?? 'task_page');
  const [slots, setSlots] = useState<SlotRow[]>(initialSlots);
  const [edits, setEdits] = useState<Record<number, SlotRow>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  const pageSlots = slots
    .filter(s => s.page_key === activePage)
    .sort((a, b) => a.slot_number - b.slot_number);

  const editOf = (slot: SlotRow): SlotRow => edits[slot.id] ?? slot;
  const update = (id: number, patch: Partial<SlotRow>) =>
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? slots.find(s => s.id === id)!), ...patch } }));

  const saveSlot = async (slot: SlotRow) => {
    const current = editOf(slot);
    setSavingId(slot.id);
    try {
      const result = await monetizationSaveSlot(slot.id, {
        enabled: current.enabled,
        network: current.network,
        format: current.format,
        zone_id: current.zone_id,
        code: current.code,
        url: current.url,
        placement: current.placement,
        device_target: current.device_target,
        priority: current.priority,
        frequency: current.frequency,
      });
      if (result.ok) {
        toast.success('Ad slot saved — live on the public pages');
        setSlots(prev => prev.map(s => s.id === slot.id ? current : s));
        setEdits(prev => {
          const next = { ...prev };
          delete next[slot.id];
          return next;
        });
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ad slot could not be saved');
    } finally {
      setSavingId(null);
    }
  };

  const addSlot = async () => {
    const nextNumber = (pageSlots.reduce((max, s) => Math.max(max, s.slot_number), 0) + 1);
    if (nextNumber > 3) return toast.error('Each page supports up to 3 ad slots');
    try {
      const result = await monetizationAddSlot(activePage, nextNumber);
      if (!result.ok) return toast.error(result.error);
      toast.success('Ad slot added');
      const data = await monetizationLoadAll();
      setSlots(data.slots as SlotRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ad slot could not be added');
    }
  };

  const removeSlot = async (slot: SlotRow) => {
    if (!window.confirm('Delete this ad slot?')) return;
    setDeletingId(slot.id);
    try {
      const result = await monetizationDeleteSlot(slot.id);
      if (!result.ok) return toast.error(result.error);
      toast.success('Ad slot deleted');
      setSlots(prev => prev.filter(s => s.id !== slot.id));
      setEdits(prev => {
        const next = { ...prev };
        delete next[slot.id];
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ad slot could not be deleted');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      {/* Page tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-5">
        {pages.map(page => (
          <button
            key={page.key}
            onClick={() => setActivePage(page.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
              activePage === page.key
                ? 'bg-purple-500/15 border-purple-500/40 text-purple-200'
                : 'glass border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            {page.label}
          </button>
        ))}
      </div>

      <div className="mb-4 p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-start gap-2 text-xs text-blue-200">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Never incentivize ad clicks: ads stay optional and separate from the Continue button. Paste only your own
          Adsterra/Monetag snippets and respect each network&apos;s publisher policies and frequency limits. Slots render
          on the public pages only when they are enabled and contain code (or are placeholders in test mode).
        </span>
      </div>

      <div className="space-y-4">
        {pageSlots.length === 0 && (
          <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center text-sm text-gray-500">
            No ad slots configured for this page yet.
          </div>
        )}

        {pageSlots.map(slot => {
          const current = editOf(slot);
          const dirty = edits[slot.id] !== undefined;
          const formats = AD_FORMAT_OPTIONS[current.network as keyof typeof AD_FORMAT_OPTIONS] ?? ['other'];
          return (
            <div key={slot.id} className="glass-strong rounded-2xl border border-white/5 p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded-lg px-2.5 py-1">
                  Ad Slot {current.slot_number}
                </span>
                <button
                  type="button"
                  onClick={() => update(slot.id, { enabled: !current.enabled })}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition ${
                    current.enabled
                      ? 'bg-green-500/15 border-green-500/40 text-green-300'
                      : 'bg-white/5 border-white/10 text-gray-500'
                  }`}
                  aria-pressed={current.enabled}
                >
                  {current.enabled ? 'Enabled · ON' : 'Disabled · OFF'}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => removeSlot(slot)}
                  disabled={deletingId === slot.id}
                  className="p-1.5 rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  aria-label="Delete slot"
                >
                  {deletingId === slot.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Network</span>
                  <select
                    value={current.network}
                    onChange={e => {
                      const network = e.target.value;
                      const formats = AD_FORMAT_OPTIONS[network as keyof typeof AD_FORMAT_OPTIONS] ?? ['other'];
                      update(slot.id, { network, format: formats[0] });
                    }}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  >
                    {AD_NETWORK_OPTIONS.map(n => <option key={n} value={n}>{NETWORK_LABELS[n]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Format</span>
                  <select
                    value={current.format}
                    onChange={e => update(slot.id, { format: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  >
                    {formats.map(f => <option key={f} value={f}>{AD_FORMAT_LABELS[f] || f}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Placement</span>
                  <select
                    value={current.placement}
                    onChange={e => update(slot.id, { placement: e.target.value as SlotRow['placement'] })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  >
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Devices</span>
                  <select
                    value={current.device_target}
                    onChange={e => update(slot.id, { device_target: e.target.value as SlotRow['device_target'] })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  >
                    <option value="all">All devices</option>
                    <option value="desktop">Desktop only</option>
                    <option value="mobile">Mobile only</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Frequency</span>
                  <select
                    value={current.frequency}
                    onChange={e => update(slot.id, { frequency: e.target.value as SlotRow['frequency'] })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  >
                    <option value="every_view">Every view</option>
                    <option value="once_per_session">Once per session</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Priority</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={current.priority}
                    onChange={e => update(slot.id, { priority: Math.min(Math.max(Number(e.target.value) || 0, 0), 1000) })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Zone ID / tag (optional)</span>
                  <input
                    value={current.zone_id || ''}
                    onChange={e => update(slot.id, { zone_id: e.target.value })}
                    maxLength={200}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block sm:col-span-2 lg:col-span-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Fallback URL (optional)</span>
                  <input
                    value={current.url || ''}
                    onChange={e => update(slot.id, { url: e.target.value })}
                    placeholder="https://…"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block mt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Ad code (Adsterra / Monetag snippet — admin only, max 10,000 characters)
                </span>
                <textarea
                  value={current.code || ''}
                  onChange={e => update(slot.id, { code: e.target.value })}
                  rows={4}
                  placeholder="<script>…</script> or <div>…</div>"
                  className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white focus:border-purple-500/60 focus:outline-none resize-y"
                />
              </label>

              <div className="flex items-center justify-between mt-3">
                <p className="text-[11px] text-gray-600">
                  {current.format && ['popunder', 'onclick', 'vignette'].includes(current.format)
                    ? 'This format runs from the visitor’s Continue/task click — once per session when configured.'
                    : 'This format renders in a sandboxed, responsive container.'}
                </p>
                <button
                  onClick={() => saveSlot(slot)}
                  disabled={savingId === slot.id || !dirty}
                  className="btn-primary px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  {savingId === slot.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save slot
                </button>
              </div>
            </div>
          );
        })}

        {pageSlots.length < 3 && (
          <button
            onClick={addSlot}
            className="w-full p-4 rounded-2xl border border-dashed border-white/15 text-sm text-gray-400 hover:text-white hover:border-purple-500/40 transition flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add ad slot ({pageSlots.length}/3)
          </button>
        )}
      </div>

    </div>
  );
}
