'use client';

/**
 * Step content management: edit titles/content/countdowns, reorder with
 * drag-and-drop, add/remove steps, and preview the complete public flow
 * without generating earnings or polluting analytics.
 */

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bold, Italic, List, Heading2, Heading3, Link2, Image as ImageIcon,
  Undo2, Eye, GripVertical, Trash2, Plus, Save, Loader2, ChevronUp, ChevronDown,
} from 'lucide-react';
import {
  monetizationSaveStep,
  monetizationAddStep,
  monetizationDeleteStep,
  monetizationReorderSteps,
  monetizationCreatePreview,
  monetizationLoadAll,
} from '@/lib/monetization/monetization-admin';
import { adminListCampaigns } from '@/lib/admin-server';

type StepRow = {
  id: number;
  position: number;
  title: string;
  subtitle: string | null;
  intro: string | null;
  body_html: string | null;
  icon: string | null;
  image_url: string | null;
  button_text: string | null;
  countdown_seconds: number;
  status: 'enabled' | 'disabled';
};

type Editable = {
  title: string;
  subtitle: string;
  intro: string;
  bodyHtml: string;
  icon: string;
  imageUrl: string;
  buttonText: string;
  countdownSeconds: number;
  status: 'enabled' | 'disabled';
};

function toEditable(step: StepRow): Editable {
  return {
    title: step.title || '',
    subtitle: step.subtitle || '',
    intro: step.intro || '',
    bodyHtml: step.body_html || '',
    icon: step.icon || '',
    imageUrl: step.image_url || '',
    buttonText: step.button_text || '',
    countdownSeconds: step.countdown_seconds ?? 10,
    status: step.status || 'enabled',
  };
}

export default function ContentClient({ initialSteps, initialError }: {
  initialSteps: StepRow[];
  initialError: string | null;
}) {
  const [steps, setSteps] = useState<StepRow[]>(initialSteps);
  const [edits, setEdits] = useState<Record<number, Editable>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCampaigns, setPreviewCampaigns] = useState<{ id: string; name: string; slug: string; creator?: { full_name: string | null } | null }[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const edit = (id: number): Editable => edits[id] ?? toEditable(steps.find(s => s.id === id)!);
  const update = (id: number, patch: Partial<Editable>) =>
    setEdits(prev => ({ ...prev, [id]: { ...edit(id), ...patch } }));

  const saveStep = async (id: number) => {
    const current = edit(id);
    setSavingId(id);
    try {
      const result = await monetizationSaveStep(id, {
        title: current.title,
        subtitle: current.subtitle,
        intro: current.intro,
        body_html: current.bodyHtml,
        icon: current.icon,
        image_url: current.imageUrl,
        button_text: current.buttonText,
        countdown_seconds: current.countdownSeconds,
        status: current.status,
      });
      if (result.ok) {
        toast.success('Step saved — live in the public flow');
        setSteps(prev => prev.map(s => s.id === id ? { ...s, ...current } : s));
        setEdits(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Step could not be saved');
    } finally {
      setSavingId(null);
    }
  };

  const addStep = async () => {
    try {
      const result = await monetizationAddStep();
      if (!result.ok) return toast.error(result.error);
      toast.success('Step added');
      const data = await monetizationLoadAll();
      setSteps(data.steps as StepRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Step could not be added');
    }
  };

  const removeStep = async (id: number) => {
    if (!window.confirm('Delete this step? The public flow immediately uses the remaining steps.')) return;
    try {
      const result = await monetizationDeleteStep(id);
      if (!result.ok) return toast.error(result.error);
      toast.success('Step deleted');
      setSteps(prev => prev.filter(s => s.id !== id));
      setEdits(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Step could not be deleted');
    }
  };

  const reorder = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSteps(next);
    const result = await monetizationReorderSteps(next.map(s => s.id));
    if (!result.ok) toast.error(result.error);
    else toast.success('Step order updated');
  };

  const move = (index: number, direction: -1 | 1) => {
    const to = index + direction;
    if (to < 0 || to >= steps.length) return;
    void reorder(index, to);
  };

  const openPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const campaigns = await adminListCampaigns();
      setPreviewCampaigns((campaigns || []).filter((c: { status: string }) => c.status === 'active'));
    } catch {
      setPreviewCampaigns([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const startPreview = async (campaignId: string) => {
    try {
      const result = await monetizationCreatePreview(campaignId);
      if (!result.ok) return toast.error(result.error);
      setPreviewOpen(false);
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preview could not be started');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-xs text-gray-500">Drag the ☰ handle to reorder. Position 1 is the first page after unlocking.</p>
        <div className="flex gap-2">
          <button onClick={openPreview} className="btn-ghost px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
            <Eye className="w-4 h-4" /> Preview Flow
          </button>
          <button onClick={addStep} className="btn-primary px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add step
          </button>
        </div>
      </div>

      {initialError && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">{initialError}</div>}

      <div className="space-y-4">
        {steps.map((step, index) => {
          const current = edit(step.id);
          const dirty = edits[step.id] !== undefined;
          return (
            <div
              key={step.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
              onDragLeave={() => setDragOverIndex(prev => (prev === index ? null : prev))}
              onDrop={e => {
                e.preventDefault();
                if (dragIndex !== null) void reorder(dragIndex, index);
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              className={`glass-strong rounded-2xl border p-4 sm:p-5 transition ${dragIndex === index ? 'opacity-60' : ''} ${dragOverIndex === index && dragIndex !== null && dragIndex !== index ? 'border-purple-500/50' : 'border-white/5'}`}
            >
              {/* Header row */}
              <div className="flex items-center gap-3 mb-4">
                <button
                  className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 cursor-grab active:cursor-grabbing"
                  title="Drag to reorder"
                  aria-label={`Reorder step ${index + 1}`}
                >
                  <GripVertical className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded-lg px-2.5 py-1">
                  Step {index + 1}
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-2 py-1 border ${current.status === 'enabled' ? 'text-green-300 bg-green-500/10 border-green-500/30' : 'text-gray-500 bg-white/5 border-white/10'}`}>
                  {current.status}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-1">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30" aria-label="Move up">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => move(index, 1)} disabled={index === steps.length - 1} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30" aria-label="Move down">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button onClick={() => removeStep(step.id)} className="p-1.5 rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-500/10" aria-label="Delete step">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Title</span>
                  <input
                    value={current.title}
                    onChange={e => update(step.id, { title: e.target.value })}
                    maxLength={160}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Subtitle</span>
                  <input
                    value={current.subtitle}
                    onChange={e => update(step.id, { subtitle: e.target.value })}
                    maxLength={300}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Icon (emoji)</span>
                  <input
                    value={current.icon}
                    onChange={e => update(step.id, { icon: e.target.value })}
                    maxLength={16}
                    placeholder="🎓"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Header image URL (optional)</span>
                  <input
                    value={current.imageUrl}
                    onChange={e => update(step.id, { imageUrl: e.target.value })}
                    placeholder="https://…"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Button text</span>
                  <input
                    value={current.buttonText}
                    onChange={e => update(step.id, { buttonText: e.target.value })}
                    maxLength={60}
                    placeholder={index === steps.length - 1 ? 'Continue to destination' : 'Continue'}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Countdown (seconds)</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={current.countdownSeconds}
                      onChange={e => update(step.id, { countdownSeconds: Math.min(Math.max(Number(e.target.value) || 1, 1), 120) })}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</span>
                    <select
                      value={current.status}
                      onChange={e => update(step.id, { status: e.target.value as 'enabled' | 'disabled' })}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                </div>
              </div>

              <label className="block mt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Introduction</span>
                <textarea
                  value={current.intro}
                  onChange={e => update(step.id, { intro: e.target.value })}
                  rows={2}
                  maxLength={2000}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none resize-y"
                />
              </label>

              <div className="mt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Rich content</span>
                <RichEditor
                  value={current.bodyHtml}
                  onChange={html => update(step.id, { bodyHtml: html })}
                />
              </div>

              <div className="flex items-center justify-between mt-4">
                <p className="text-[11px] text-gray-600">HTML is sanitized server-side on save — only safe, styled content survives.</p>
                <button
                  onClick={() => saveStep(step.id)}
                  disabled={savingId === step.id || !dirty}
                  className="btn-primary px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  {savingId === step.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save step
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setPreviewOpen(false)}>
          <div className="glass-strong rounded-2xl border border-white/10 p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-white mb-1">Preview the public flow</h3>
            <p className="text-xs text-gray-400 mb-4">
              Preview mode records no earnings, no analytics and no qualified views — ads render as placeholders.
            </p>
            {previewLoading ? (
              <div className="py-8 text-center text-sm text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading active campaigns…</div>
            ) : previewCampaigns.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No active campaigns available to preview.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {previewCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => startPreview(c.id)}
                    className="w-full text-left p-3 rounded-xl glass border border-white/10 hover:border-purple-500/40 transition"
                  >
                    <span className="block text-sm font-semibold text-white truncate">{c.name}</span>
                    <span className="block text-[11px] text-gray-500 truncate">/unlock/{c.slug}{c.creator?.full_name ? ` · ${c.creator.full_name}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Minimal admin rich-text editor (contentEditable + toolbar). The HTML it
 * produces is sanitized server-side before storage AND before rendering, so
 * this editor cannot widen the content trust boundary.
 */
function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  const runCommand = (command: string, arg?: string) => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    document.execCommand(command, false, arg);
    onChange(node.innerHTML);
  };

  const runToolbarAction = (action: string) => {
    if (action === 'link' || action === 'image') {
      const url = window.prompt(action === 'link' ? 'Link URL (https://…)' : 'Image URL (https://…)');
      if (url) runCommand(action === 'link' ? 'createLink' : 'insertImage', url);
      return;
    }
    if (action === 'format-h2') return runCommand('formatBlock', 'h2');
    if (action === 'format-h3') return runCommand('formatBlock', 'h3');
    runCommand(action);
  };

  const toolbar = [
    { icon: Bold, title: 'Bold', action: 'bold' },
    { icon: Italic, title: 'Italic', action: 'italic' },
    { icon: Heading2, title: 'Heading', action: 'format-h2' },
    { icon: Heading3, title: 'Subheading', action: 'format-h3' },
    { icon: List, title: 'Bullet list', action: 'insertUnorderedList' },
    { icon: Link2, title: 'Link', action: 'link' },
    { icon: ImageIcon, title: 'Image', action: 'image' },
    { icon: Undo2, title: 'Clear formatting', action: 'removeFormat' },
  ];

  return (
    <div className={`mt-1 rounded-xl border bg-black/30 overflow-hidden transition ${focused ? 'border-purple-500/60' : 'border-white/10'}`}>
      <div className="flex items-center gap-1 p-1.5 border-b border-white/10 bg-white/5">
        {toolbar.map((item, i) => (
          <button
            key={i}
            type="button"
            title={item.title}
            onMouseDown={e => e.preventDefault()}
            onClick={() => runToolbarAction(item.action)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
          >
            <item.icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onInput={e => onChange((e.target as HTMLDivElement).innerHTML)}
        dangerouslySetInnerHTML={{ __html: value || '' }}
        className="min-h-[140px] px-3 py-3 text-sm text-gray-200 focus:outline-none prose-invert"
      />
    </div>
  );
}
