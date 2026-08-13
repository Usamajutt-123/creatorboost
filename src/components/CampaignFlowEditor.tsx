'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Image as ImageIcon, X } from 'lucide-react';
import Select from '@/components/Select';
import { createClient } from '@/lib/supabase/client';
import {
  FLOW_LABEL,
  FLOW_MULTIPLIER,
  FLOW_PAGE_COUNT,
  FLOW_TYPES,
  type FlowType,
} from '@/lib/flow';
import { isValidHttpUrl } from '@/lib/tasks';
import { toast } from 'sonner';

export type EditorPage = {
  title: string;
  description: string;
  buttonText: string;
  imageUrl: string | null;
  imageFile: File | null;
  imagePreview: string;
};

export function emptyPage(): EditorPage {
  return { title: '', description: '', buttonText: '', imageUrl: null, imageFile: null, imagePreview: '' };
}

/** Resize the pages array to exactly `count` entries, preserving prior data. */
export function resizePages(pages: EditorPage[], count: number): EditorPage[] {
  const next = pages.slice(0, count);
  while (next.length < count) next.push(emptyPage());
  return next;
}

interface Props {
  flowType: FlowType;
  onFlowTypeChange: (flow: FlowType) => void;
  pages: EditorPage[];
  onPagesChange: (next: EditorPage[]) => void;
  onPreview?: () => void;
  disabled?: boolean;
}

/**
 * Renders the "Campaign Flow" section used in both Create and Edit forms.
 * The number of page editors is DETERMINED by the flow type — there is no
 * generic "Add Page" button, and no way to reach 1/2/3/6/7+ pages.
 */
export default function CampaignFlowEditor({ flowType, onFlowTypeChange, pages, onPagesChange, onPreview, disabled }: Props) {
  const total = FLOW_PAGE_COUNT[flowType];
  const showPages = total > 0;

  const updatePage = (index: number, patch: Partial<EditorPage>) => {
    onPagesChange(pages.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    onPagesChange(next);
  };

  return (
    <section>
      <h2 className="font-semibold mb-1">Campaign Flow</h2>
      <p className="text-xs text-gray-500 mb-4">
        Normal keeps the original CreatorBoost flow. Custom flows send visitors through the
        pages below in order, and the server applies the verified earning multiplier only
        after every page is completed.
      </p>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Campaign flow type">
        {FLOW_TYPES.map(type => {
          const active = flowType === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onFlowTypeChange(type)}
              className={`glass rounded-xl p-3 text-left transition ${active ? 'ring-2 ring-purple-500 bg-purple-500/10' : 'hover:bg-white/5'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border ${active ? 'border-purple-400 bg-purple-500' : 'border-white/30'}`} />
                <span className="text-sm font-medium">{FLOW_LABEL[type]}</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                {FLOW_PAGE_COUNT[type] === 0
                  ? 'Existing task flow · 1.00× multiplier'
                  : `${FLOW_PAGE_COUNT[type]} custom pages · ${FLOW_MULTIPLIER[type].toFixed(2)}× multiplier`}
              </div>
            </button>
          );
        })}
      </div>
      <div className="hidden">
        {/* The custom dark Select component is used for every dropdown in the app;
            expose it here too so screen-reader users have the same choice as a menu. */}
        <Select
          value={flowType}
          onChange={value => onFlowTypeChange((FLOW_TYPES as readonly string[]).includes(value) ? (value as FlowType) : 'normal')}
          options={FLOW_TYPES.map(f => ({ value: f, label: FLOW_LABEL[f] }))}
          ariaLabel="Campaign flow"
        />
      </div>

      {showPages && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs text-purple-200">
              {FLOW_LABEL[flowType]} · {total} custom pages · verified earning multiplier {FLOW_MULTIPLIER[flowType].toFixed(2)}×
            </p>
            {onPreview && (
              <button type="button" onClick={onPreview} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Preview flow
              </button>
            )}
          </div>
          <div className="space-y-3">
            {pages.slice(0, total).map((page, index) => (
              <PageEditor
                key={index}
                index={index}
                total={total}
                page={page}
                onChange={patch => updatePage(index, patch)}
                onMove={dir => move(index, dir)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface PageProps {
  index: number;
  total: number;
  page: EditorPage;
  onChange: (patch: Partial<EditorPage>) => void;
  onMove: (dir: -1 | 1) => void;
  disabled?: boolean;
}

function PageEditor({ index, total, page, onChange, onMove, disabled }: PageProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Images must be 5 MB or smaller');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      onChange({ imageFile: file, imagePreview: String(reader.result || ''), imageUrl: null });
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => onChange({ imageFile: null, imagePreview: '', imageUrl: null });

  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-200 text-xs flex items-center justify-center flex-shrink-0">{index + 1}</span>
        <h3 className="text-sm font-medium flex-1 min-w-0">Page {index + 1} of {total}</h3>
        <button type="button" onClick={() => onMove(-1)} disabled={disabled || index === 0} className="p-1.5 text-gray-400 disabled:opacity-30 hover:text-white" aria-label={`Move page ${index + 1} up`}>
          <ArrowUp className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={disabled || index === total - 1} className="p-1.5 text-gray-400 disabled:opacity-30 hover:text-white" aria-label={`Move page ${index + 1} down`}>
          <ArrowDown className="w-4 h-4" />
        </button>
      </div>

      <label className="text-xs text-gray-300 block">Title *
        <input
          value={page.title}
          onChange={event => onChange({ title: event.target.value })}
          className="input-field mt-1.5"
          maxLength={150}
          placeholder={`Page ${index + 1} title`}
          disabled={disabled}
        />
      </label>

      <label className="text-xs text-gray-300 block">Description
        <textarea
          rows={3}
          value={page.description}
          onChange={event => onChange({ description: event.target.value })}
          className="input-field mt-1.5"
          maxLength={2000}
          placeholder="Explain what visitors should read or do on this page"
          disabled={disabled}
        />
      </label>

      <label className="text-xs text-gray-300 block">Button text
        <input
          value={page.buttonText}
          onChange={event => onChange({ buttonText: event.target.value })}
          className="input-field mt-1.5"
          maxLength={60}
          placeholder={index === total - 1 ? 'Unlock destination' : 'Continue'}
          disabled={disabled}
        />
      </label>

      <div>
        <span className="text-xs font-medium text-gray-300 block mb-1.5">Image (optional)</span>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={handleFile} className="hidden" disabled={disabled} />
        {page.imagePreview ? (
          <div className="relative glass rounded-xl p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page.imagePreview} alt="" className="w-full max-h-40 object-cover rounded-lg" />
            <button type="button" onClick={removeImage} disabled={disabled} aria-label={`Remove page ${index + 1} image`} className="absolute top-3 right-3 p-1.5 bg-red-500/90 hover:bg-red-500 rounded-full">
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="w-full input-field border-dashed rounded-xl p-5 text-center hover:bg-white/5 flex flex-col items-center gap-2">
            <ImageIcon className="w-5 h-5 text-gray-500" />
            <span className="text-xs text-gray-400">Choose image</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Upload any pending page image files and produce the payload sent to the server. */
export async function collectFlowPagesForSubmit(pages: EditorPage[], total: number): Promise<{
  pages: Array<{ position: number; title: string; description: string; imageUrl: string | null; buttonText: string }>;
  error?: string;
}> {
  const trimmed = pages.slice(0, total);
  if (total > 0) {
    for (let i = 0; i < total; i++) {
      const p = trimmed[i];
      if (!p || !p.title.trim()) return { pages: [], error: `Page ${i + 1} needs a title` };
    }
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (total > 0 && !user) return { pages: [], error: 'Your session has expired. Please sign in again.' };

  const uploaded: Array<{ position: number; title: string; description: string; imageUrl: string | null; buttonText: string }> = [];
  for (let i = 0; i < total; i++) {
    const p = trimmed[i];
    let imageUrl = p.imageUrl ?? null;
    if (p.imageFile && user) {
      const extension = p.imageFile.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'png';
      const path = `${user.id}/pages/${crypto.randomUUID()}-p${i + 1}.${extension}`;
      const { error } = await supabase.storage.from('campaigns').upload(path, p.imageFile, { upsert: false, contentType: p.imageFile.type });
      if (error) return { pages: [], error: `Could not upload page ${i + 1} image` };
      imageUrl = supabase.storage.from('campaigns').getPublicUrl(path).data.publicUrl;
    }
    if (imageUrl && !isValidHttpUrl(imageUrl)) return { pages: [], error: `Page ${i + 1} image URL is invalid` };
    uploaded.push({
      position: i + 1,
      title: p.title.trim(),
      description: p.description.trim(),
      imageUrl,
      buttonText: p.buttonText.trim(),
    });
  }
  return { pages: uploaded };
}

export function FlowPreviewModal({
  flowType,
  pages,
  destinationUrl,
  onClose,
}: {
  flowType: FlowType;
  pages: EditorPage[];
  destinationUrl: string;
  onClose: () => void;
}) {
  const total = FLOW_PAGE_COUNT[flowType];
  const [step, setStep] = useState(0);
  const active = pages[step];
  const visiblePages = useMemo(() => pages.slice(0, total), [pages, total]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Flow preview">
      <div className="glass-strong rounded-2xl w-full max-w-lg p-5 sm:p-6 relative max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-white" aria-label="Close preview">
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-semibold mb-1">Preview — {FLOW_LABEL[flowType]}</h3>
        <p className="text-xs text-gray-400 mb-4">This preview does not create a real view or earning.</p>

        <div className="flex items-center gap-1 mb-4 flex-wrap">
          {visiblePages.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-purple-500' : 'bg-white/10'}`} />
          ))}
        </div>

        {active ? (
          <article className="glass rounded-xl p-4 space-y-3">
            <header className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/40 to-blue-500/40 flex items-center justify-center text-xs font-semibold">{step + 1}</span>
              <h4 className="text-base font-semibold break-words">{active.title || `Page ${step + 1}`}</h4>
            </header>
            {active.imagePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.imagePreview} alt="" className="w-full max-h-40 object-cover rounded-lg border border-white/10" />
            )}
            {active.description && <p className="text-xs text-gray-300 whitespace-pre-line">{active.description}</p>}
          </article>
        ) : (
          <p className="text-sm text-gray-400">No pages configured yet.</p>
        )}

        <div className="flex items-center justify-between mt-4 gap-2">
          <button type="button" disabled={step === 0} onClick={() => setStep(s => Math.max(s - 1, 0))} className="btn-ghost px-3 py-1.5 rounded-lg text-xs disabled:opacity-30">Previous</button>
          <span className="text-[11px] text-gray-500">Step {Math.min(step + 1, total)} of {total}</span>
          {step < total - 1 ? (
            <button type="button" onClick={() => setStep(s => Math.min(s + 1, total - 1))} className="btn-primary px-3 py-1.5 rounded-lg text-xs">
              {active?.buttonText?.trim() || 'Continue'}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="btn-primary px-3 py-1.5 rounded-lg text-xs">
              Destination ↗
            </button>
          )}
        </div>

        {step === total - 1 && destinationUrl && (
          <p className="mt-3 text-[11px] text-gray-500 break-all">Would redirect to <span className="text-purple-300">{destinationUrl}</span></p>
        )}
      </div>
    </div>
  );
}
