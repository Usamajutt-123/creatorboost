'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Image as ImageIcon, Save, Send, X } from 'lucide-react';
import {
  FaComment,
  FaDiscord,
  FaDownload,
  FaFacebook,
  FaGear,
  FaGlobe,
  FaInstagram,
  FaPlay,
  FaTelegram,
  FaThumbsUp,
  FaTiktok,
  FaXTwitter,
  FaYoutube,
} from 'react-icons/fa6';
import DashboardTopbar from '@/components/DashboardTopbar';
import Select from '@/components/Select';
import CampaignFlowEditor, { collectFlowPagesForSubmit, emptyPage, resizePages, FlowPreviewModal, type EditorPage } from '@/components/CampaignFlowEditor';
import { createCampaignAction, type CampaignMutationInput } from '@/lib/campaign-actions';
import { createClient } from '@/lib/supabase/client';
import { FLOW_PAGE_COUNT, type FlowType } from '@/lib/flow';
import { isValidHttpUrl, type TaskType } from '@/lib/tasks';
import { toast } from 'sonner';

type TaskField = { id: TaskType; title: string; url: string };

type TaskOption = { id: TaskType; name: string; icon: typeof FaYoutube; color: string };

const TASK_OPTIONS: TaskOption[] = [
  { id: 'youtube_subscribe', name: 'YouTube Subscribe', icon: FaYoutube, color: 'text-red-500' },
  { id: 'youtube_like', name: 'YouTube Like', icon: FaThumbsUp, color: 'text-red-500' },
  { id: 'youtube_comment', name: 'YouTube Comment', icon: FaComment, color: 'text-red-500' },
  { id: 'watch_video', name: 'YouTube Watch', icon: FaPlay, color: 'text-red-500' },
  { id: 'telegram_join', name: 'Telegram Join', icon: FaTelegram, color: 'text-sky-500' },
  { id: 'discord_join', name: 'Discord Join', icon: FaDiscord, color: 'text-indigo-500' },
  { id: 'instagram_follow', name: 'Instagram Follow', icon: FaInstagram, color: 'text-pink-500' },
  { id: 'tiktok_follow', name: 'TikTok Follow', icon: FaTiktok, color: 'text-white' },
  { id: 'facebook_follow', name: 'Facebook Follow', icon: FaFacebook, color: 'text-blue-500' },
  { id: 'twitter_follow', name: 'X (Twitter) Follow', icon: FaXTwitter, color: 'text-white' },
  { id: 'website_visit', name: 'Website Visit', icon: FaGlobe, color: 'text-green-500' },
  { id: 'file_download', name: 'Download File', icon: FaDownload, color: 'text-yellow-400' },
  { id: 'custom', name: 'Custom Task', icon: FaGear, color: 'text-purple-400' },
];

const CATEGORIES = ['youtube_growth', 'instagram_growth', 'tiktok_growth', 'telegram_growth', 'discord_growth', 'website_traffic', 'app_install', 'other'] as const;

function taskLabel(id: TaskType) {
  return TASK_OPTIONS.find(task => task.id === id)?.name || id;
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<TaskField[]>([]);
  const [thumbnailPreview, setThumbnailPreview] = useState('');
  const [bannerPreview, setBannerPreview] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const thumbRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'youtube_growth' as (typeof CATEGORIES)[number],
    destinationUrl: '',
    status: 'active' as 'active' | 'paused' | 'draft',
    expiresAt: '',
  });
  const [flowType, setFlowType] = useState<FlowType>('normal');
  const [flowPages, setFlowPages] = useState<EditorPage[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const changeFlow = (next: FlowType) => {
    setFlowType(next);
    setFlowPages(existing => resizePages(existing.length ? existing : [emptyPage()], FLOW_PAGE_COUNT[next]));
  };

  const addTask = (id: TaskType) => {
    if (selectedTasks.some(task => task.id === id)) return;
    setSelectedTasks(current => [...current, { id, title: '', url: '' }]);
  };

  const removeTask = (id: TaskType) => setSelectedTasks(current => current.filter(task => task.id !== id));

  const updateTask = (id: TaskType, field: 'title' | 'url', value: string) => {
    setSelectedTasks(current => current.map(task => task.id === id ? { ...task, [field]: value } : task));
  };

  const moveTask = (index: number, direction: -1 | 1) => {
    setSelectedTasks(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: 'thumbnail' | 'banner') => {
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
      if (type === 'thumbnail') {
        setThumbnailFile(file);
        setThumbnailPreview(String(reader.result || ''));
      } else {
        setBannerFile(file);
        setBannerPreview(String(reader.result || ''));
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadMedia = async (file: File, kind: 'thumbnail' | 'banner'): Promise<string> => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Your session has expired. Please sign in again.');
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'png';
    const path = `${user.id}/${crypto.randomUUID()}-${kind}.${extension}`;
    const { error } = await supabase.storage
      .from('campaigns')
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(`Could not upload ${kind}. Please try again.`);
    return supabase.storage.from('campaigns').getPublicUrl(path).data.publicUrl;
  };

  const validateBeforeSubmit = (status: 'active' | 'paused' | 'draft') => {
    if (!form.name.trim()) return 'Campaign name is required';
    if (selectedTasks.length === 0) return 'Choose at least one task';
    if (status === 'active' && !isValidHttpUrl(form.destinationUrl)) return 'An active campaign needs a valid destination URL';
    if (form.destinationUrl && !isValidHttpUrl(form.destinationUrl)) return 'Destination URL must use http or https';
    for (const task of selectedTasks) {
      if (!isValidHttpUrl(task.url)) return `Add a valid URL for ${taskLabel(task.id)}`;
      if (task.id === 'custom' && !task.title.trim()) return 'Add a title for the custom task';
    }
    return null;
  };

  const submit = async (status: 'active' | 'paused' | 'draft') => {
    const validation = validateBeforeSubmit(status);
    if (validation) {
      toast.error(validation);
      return;
    }
    const requiredCount = FLOW_PAGE_COUNT[flowType];
    if (flowType !== 'normal') {
      const trimmed = flowPages.slice(0, requiredCount);
      if (trimmed.length !== requiredCount) {
        toast.error(`${flowType === '4_pages' ? '4 Pages' : '5 Pages'} requires exactly ${requiredCount} pages`);
        return;
      }
    }
    setSaving(true);
    try {
      const [thumbnailUrl, bannerUrl, pagesResult] = await Promise.all([
        thumbnailFile ? uploadMedia(thumbnailFile, 'thumbnail') : Promise.resolve(null),
        bannerFile ? uploadMedia(bannerFile, 'banner') : Promise.resolve(null),
        collectFlowPagesForSubmit(flowPages, requiredCount),
      ]);
      if (pagesResult.error) {
        toast.error(pagesResult.error);
        return;
      }
      const input: CampaignMutationInput = {
        name: form.name,
        description: form.description,
        category: form.category,
        destinationUrl: form.destinationUrl,
        status,
        expiresAt: form.expiresAt,
        thumbnailUrl,
        bannerUrl,
        tasks: selectedTasks,
        flowType,
        flowPages: pagesResult.pages,
      };
      const result = await createCampaignAction(input);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(status === 'active' ? 'Campaign launched' : status === 'paused' ? 'Campaign saved as paused' : 'Draft saved');
      router.push('/dashboard/campaigns');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign could not be created');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DashboardTopbar title="Create Campaign" subtitle="Configure the exact tasks visitors must open" />
      <div className="p-4 sm:p-6">
        <div className="max-w-4xl space-y-6">
          <div className="glass-strong rounded-2xl p-5 sm:p-6 space-y-7">
            <section>
              <h2 className="font-semibold mb-4">Basic information</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-xs font-medium text-gray-300 block">Campaign name *
                  <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="input-field mt-1.5" placeholder="My campaign" maxLength={150} />
                </label>
                <label className="text-xs font-medium text-gray-300 block">Category
                  <Select value={form.category} onChange={value => setForm({ ...form, category: value as (typeof CATEGORIES)[number] })} className="mt-1.5" options={CATEGORIES.map(category => ({ value: category, label: category.replace(/_/g, ' ') }))} />
                </label>
                <label className="text-xs font-medium text-gray-300 block sm:col-span-2">Description
                  <textarea rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="input-field mt-1.5" placeholder="Tell visitors what they will unlock" maxLength={2000} />
                </label>
                <label className="text-xs font-medium text-gray-300 block sm:col-span-2">Destination URL {form.status === 'active' ? '*' : ''}
                  <input value={form.destinationUrl} onChange={event => setForm({ ...form, destinationUrl: event.target.value })} className="input-field mt-1.5" placeholder="https://your-link.com" inputMode="url" />
                </label>
              </div>
            </section>

            <section>
              <h2 className="font-semibold mb-1">Media</h2>
              <p className="text-xs text-gray-500 mb-4">Optional public images. Image uploads are limited to 5 MB.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {([
                  ['thumbnail', 'Thumbnail (square)', thumbnailPreview, thumbRef, () => { setThumbnailFile(null); setThumbnailPreview(''); }],
                  ['banner', 'Banner (wide)', bannerPreview, bannerRef, () => { setBannerFile(null); setBannerPreview(''); }],
                ] as const).map(([kind, label, preview, ref, clear]) => (
                  <div key={kind}>
                    <span className="text-xs font-medium text-gray-300 block mb-1.5">{label}</span>
                    <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={event => handleFileChange(event, kind)} className="hidden" />
                    {preview ? (
                      <div className="relative glass rounded-xl p-2">
                        {/* Local data URL preview; uploaded URLs are rendered on campaign pages. */}
                        <img src={preview} alt={`${label} preview`} className="w-full h-32 object-cover rounded-lg" />
                        <button type="button" onClick={clear} aria-label={`Remove ${label}`} className="absolute top-3 right-3 p-1.5 bg-red-500/90 hover:bg-red-500 rounded-full"><X className="w-3 h-3 text-white" /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => ref.current?.click()} className="w-full input-field border-dashed rounded-xl p-7 text-center hover:bg-white/5 flex flex-col items-center gap-2">
                        <ImageIcon className="w-6 h-6 text-gray-500" /><span className="text-xs text-gray-400">Choose image</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-semibold mb-1">Required tasks *</h2>
              <p className="text-xs text-gray-500 mb-4">Every task needs its own creator-configured URL. Visitors are sent to that exact URL.</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TASK_OPTIONS.map(option => {
                  const selected = selectedTasks.some(task => task.id === option.id);
                  const Icon = option.icon;
                  return (
                    <button key={option.id} type="button" onClick={() => selected ? removeTask(option.id) : addTask(option.id)} className={`glass rounded-xl p-3 flex items-center gap-3 text-left transition ${selected ? 'ring-2 ring-purple-500 bg-purple-500/10' : 'hover:bg-white/5'}`}>
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${selected ? 'bg-purple-500 border-purple-500' : 'border-white/25'}`}>{selected && <Check className="w-3 h-3 text-white" />}</span>
                      <Icon className={`w-5 h-5 ${option.color}`} /><span className="text-xs font-medium">{option.name}</span>
                    </button>
                  );
                })}
              </div>

              {selectedTasks.length > 0 && (
                <div className="mt-5 space-y-3">
                  {selectedTasks.map((task, index) => (
                    <div key={task.id} className="glass rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-200 text-xs flex items-center justify-center">{index + 1}</span>
                        <h3 className="text-sm font-medium flex-1">{taskLabel(task.id)}</h3>
                        <button type="button" onClick={() => moveTask(index, -1)} disabled={index === 0} className="p-1.5 text-gray-400 disabled:opacity-30 hover:text-white" aria-label={`Move ${taskLabel(task.id)} up`}><ArrowUp className="w-4 h-4" /></button>
                        <button type="button" onClick={() => moveTask(index, 1)} disabled={index === selectedTasks.length - 1} className="p-1.5 text-gray-400 disabled:opacity-30 hover:text-white" aria-label={`Move ${taskLabel(task.id)} down`}><ArrowDown className="w-4 h-4" /></button>
                        <button type="button" onClick={() => removeTask(task.id)} className="p-1.5 text-red-400 hover:text-red-300" aria-label={`Remove ${taskLabel(task.id)}`}><X className="w-4 h-4" /></button>
                      </div>
                      {task.id === 'custom' && <label className="text-xs text-gray-300 block mb-3">Task title *
                        <input value={task.title} onChange={event => updateTask(task.id, 'title', event.target.value)} className="input-field mt-1.5" placeholder="For example: Visit our community" maxLength={120} />
                      </label>}
                      <label className="text-xs text-gray-300 block">Task URL *
                        <input value={task.url} onChange={event => updateTask(task.id, 'url', event.target.value)} className="input-field mt-1.5" placeholder="https://example.com/exact-destination" inputMode="url" />
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <CampaignFlowEditor
              flowType={flowType}
              onFlowTypeChange={changeFlow}
              pages={flowPages}
              onPagesChange={setFlowPages}
              onPreview={flowType !== 'normal' ? () => setPreviewOpen(true) : undefined}
              disabled={saving}
            />

            <section>
              <h2 className="font-semibold mb-4">Publishing settings</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-xs font-medium text-gray-300 block">Initial status
                  <Select value={form.status} onChange={value => setForm({ ...form, status: value as typeof form.status })} className="mt-1.5" options={[
                    { value: 'active', label: 'Active' },
                    { value: 'paused', label: 'Paused' },
                    { value: 'draft', label: 'Draft' },
                  ]} />
                </label>
                <label className="text-xs font-medium text-gray-300 block">Expiry date (optional)
                  <input type="date" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} className="input-field mt-1.5" />
                </label>
              </div>
            </section>

            {previewOpen && flowType !== 'normal' && (
              <FlowPreviewModal
                flowType={flowType}
                pages={flowPages}
                destinationUrl={form.destinationUrl}
                campaignName={form.name}
                campaignDescription={form.description}
                onClose={() => setPreviewOpen(false)}
              />
            )}

            <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-4 border-t border-white/10">
              <button type="button" onClick={() => submit('draft')} disabled={saving} className="btn-ghost px-5 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Save draft</button>
              <button type="button" onClick={() => submit(form.status)} disabled={saving} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"><Send className="w-4 h-4" /> {saving ? 'Saving…' : form.status === 'active' ? 'Launch campaign' : 'Save campaign'}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
