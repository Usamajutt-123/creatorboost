'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Save, X, Image as ImageIcon, Check, ArrowLeft, Loader2 } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Link from 'next/link';
import { isValidHttpUrl } from '@/lib/utils';

type TaskField = { id: string; title?: string; url?: string };

const TASK_OPTIONS = [
  { id: 'youtube_subscribe', name: 'YouTube Subscribe', icon: '▶️' },
  { id: 'youtube_like', name: 'YouTube Like', icon: '👍' },
  { id: 'youtube_comment', name: 'YouTube Comment', icon: '💬' },
  { id: 'watch_video', name: 'YouTube Watch', icon: '🎬' },
  { id: 'telegram_join', name: 'Telegram Join', icon: '✈️' },
  { id: 'discord_join', name: 'Discord Join', icon: '🎮' },
  { id: 'instagram_follow', name: 'Instagram Follow', icon: '📷' },
  { id: 'tiktok_follow', name: 'TikTok Follow', icon: '🎵' },
  { id: 'facebook_follow', name: 'Facebook Follow', icon: '📘' },
  { id: 'twitter_follow', name: 'X (Twitter) Follow', icon: '🐦' },
  { id: 'website_visit', name: 'Website Visit', icon: '🌐' },
  { id: 'file_download', name: 'Download App', icon: '📥' },
  { id: 'custom', name: 'Custom Task', icon: '⚙️' },
];

const CATEGORIES = ['youtube_growth', 'instagram_growth', 'tiktok_growth', 'telegram_growth', 'discord_growth', 'website_traffic', 'app_install', 'other'];

export default function EditCampaignPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<TaskField[]>([]);
  const [thumbnailPreview, setThumbnailPreview] = useState<string>('');
  const [bannerPreview, setBannerPreview] = useState<string>('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [originalThumbnail, setOriginalThumbnail] = useState<string>('');
  const [originalBanner, setOriginalBanner] = useState<string>('');
  const thumbRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '', description: '', category: 'youtube_growth', destination_url: '', status: 'active', expires_at: '',
  });

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('creator_id', user.id)
        .maybeSingle();
      if (error || !data) {
        toast.error('Campaign not found');
        router.push('/dashboard/campaigns');
        return;
      }
      setForm({
        name: data.name || '',
        description: data.description || '',
        category: data.category || 'youtube_growth',
        destination_url: data.destination_url || '',
        status: data.status || 'active',
        expires_at: data.expires_at ? data.expires_at.substring(0, 10) : '',
      });
      const tasks = (data.tasks || []) as string[];
      const taskMeta = (data.task_metadata as Record<string, any>) || {};
      setSelectedTasks(tasks.map(t => ({ id: t, title: taskMeta[t]?.title, url: taskMeta[t]?.url })));
      setThumbnailPreview(data.thumbnail_url || '');
      setBannerPreview(data.banner_url || '');
      setOriginalThumbnail(data.thumbnail_url || '');
      setOriginalBanner(data.banner_url || '');
      setLoading(false);
    };
    load();
  }, [id, router]);

  const toggleTask = (taskId: string) => {
    if (expandedTask === taskId) { setExpandedTask(null); return; }
    setExpandedTask(taskId);
    if (!selectedTasks.find(t => t.id === taskId)) setSelectedTasks([...selectedTasks, { id: taskId }]);
  };

  const updateTaskField = (taskId: string, field: 'title' | 'url', value: string) => {
    setSelectedTasks(selectedTasks.map(t => t.id === taskId ? { ...t, [field]: value } : t));
  };

  const removeTask = (taskId: string) => {
    setSelectedTasks(selectedTasks.filter(t => t.id !== taskId));
    if (expandedTask === taskId) setExpandedTask(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'thumbnail' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be less than 5MB'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === 'thumbnail') { setThumbnailFile(file); setThumbnailPreview(reader.result as string); }
      else { setBannerFile(file); setBannerPreview(reader.result as string); }
    };
    reader.readAsDataURL(file);
  };

  const uploadMedia = async (supabase: any, file: File, type: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const fileExt = file.name.split('.').pop();
    const path = `${user.id}/${id}-${type}-${Date.now()}.${fileExt}`;
    const { error: upErr } = await supabase.storage.from('campaigns').upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { console.error('Upload error:', upErr); toast.error(`Failed to upload ${type}: ${upErr.message}`); return null; }
    const { data: { publicUrl } } = supabase.storage.from('campaigns').getPublicUrl(path);
    return publicUrl;
  };

  const handleSubmit = async () => {
    if (!form.name) { toast.error('Campaign name is required'); return; }
    if (selectedTasks.length === 0) { toast.error('Select at least one task'); return; }
    if (form.destination_url && !isValidHttpUrl(form.destination_url)) { toast.error('Destination URL must be a valid http(s) URL'); return; }
    const customTask = selectedTasks.find(t => t.id === 'custom');
    if (customTask && (!customTask.title || !customTask.url)) {
      toast.error('Custom task requires both title and URL');
      setExpandedTask('custom');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    try {
      let thumbnailUrl = originalThumbnail;
      let bannerUrl = originalBanner;
      if (thumbnailFile) { const url = await uploadMedia(supabase, thumbnailFile, 'thumbnail'); if (url) thumbnailUrl = url; }
      if (bannerFile) { const url = await uploadMedia(supabase, bannerFile, 'banner'); if (url) bannerUrl = url; }

      const taskIds = selectedTasks.map(t => t.id);
      const taskMetadata: Record<string, any> = {};
      selectedTasks.forEach(t => {
        if (t.id === 'custom' && t.title && t.url) taskMetadata[t.id] = { title: t.title, url: t.url };
      });

      const { error } = await supabase.from('campaigns').update({
        name: form.name,
        description: form.description,
        category: form.category,
        destination_url: form.destination_url,
        tasks: taskIds,
        task_metadata: taskMetadata,
        thumbnail_url: thumbnailUrl || null,
        banner_url: bannerUrl || null,
        status: form.status,
        expires_at: form.expires_at || null,
      }).eq('id', id).eq('creator_id', (await supabase.auth.getUser()).data.user?.id);

      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success('Campaign updated');
      router.push('/dashboard/campaigns');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <DashboardTopbar title="Edit Campaign" />
        <div className="p-6 flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 text-purple-400 animate-spin" /></div>
      </>
    );
  }

  return (
    <>
      <DashboardTopbar title="Edit Campaign" subtitle="Update your unlock campaign" />
      <div className="p-4 sm:p-6">
        <div className="max-w-4xl space-y-6">
          <Link href="/dashboard/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Back to campaigns
          </Link>

          <div className="glass-strong rounded-2xl p-6 space-y-6">
            <div>
              <h3 className="font-semibold mb-4">Basic Information</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Campaign Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Category</label>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input-field">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Description</label>
                  <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input-field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Destination URL</label>
                  <input value={form.destination_url} onChange={e => setForm({ ...form, destination_url: e.target.value })} className="input-field" placeholder="https://your-link.com" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Media</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Thumbnail (400x400)</label>
                  <input ref={thumbRef} type="file" accept="image/*" onChange={e => handleFileChange(e, 'thumbnail')} className="hidden" />
                  {thumbnailPreview ? (
                    <div className="relative glass rounded-xl p-2">
                      <img src={thumbnailPreview} alt="Thumbnail" className="w-full h-32 object-cover rounded-lg" />
                      <button type="button" onClick={() => { setThumbnailFile(null); setThumbnailPreview(''); setOriginalThumbnail(''); }} className="absolute top-3 right-3 p-1 bg-red-500/80 hover:bg-red-500 rounded-full">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => thumbRef.current?.click()} className="w-full input-field border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:bg-white/5 transition flex flex-col items-center gap-2">
                      <ImageIcon className="w-7 h-7 text-gray-500" />
                      <p className="text-xs text-gray-400">Click to upload thumbnail</p>
                    </button>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Banner (1200x400)</label>
                  <input ref={bannerRef} type="file" accept="image/*" onChange={e => handleFileChange(e, 'banner')} className="hidden" />
                  {bannerPreview ? (
                    <div className="relative glass rounded-xl p-2">
                      <img src={bannerPreview} alt="Banner" className="w-full h-32 object-cover rounded-lg" />
                      <button type="button" onClick={() => { setBannerFile(null); setBannerPreview(''); setOriginalBanner(''); }} className="absolute top-3 right-3 p-1 bg-red-500/80 hover:bg-red-500 rounded-full">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => bannerRef.current?.click()} className="w-full input-field border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:bg-white/5 transition flex flex-col items-center gap-2">
                      <ImageIcon className="w-7 h-7 text-gray-500" />
                      <p className="text-xs text-gray-400">Click to upload banner</p>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Tasks *</h3>
              <p className="text-xs text-gray-500 mb-3">Click a task to expand. Click again to collapse.</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TASK_OPTIONS.map(t => {
                  const isExpanded = expandedTask === t.id;
                  const isSelected = selectedTasks.find(x => x.id === t.id);
                  const taskData = selectedTasks.find(x => x.id === t.id);
                  return (
                    <div key={t.id} className={`glass rounded-xl transition-all ${isExpanded ? 'ring-2 ring-purple-500 bg-purple-500/10 col-span-full sm:col-span-2 lg:col-span-3' : isSelected ? 'ring-1 ring-purple-500/60 bg-purple-500/5' : 'hover:bg-white/5'}`}>
                      <button type="button" onClick={() => toggleTask(t.id)} className="w-full p-3 flex items-center gap-3 text-left">
                        {isSelected ? <div className="w-5 h-5 rounded-md bg-purple-500 flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3 text-white" /></div> : <div className="w-5 h-5 rounded-md border border-white/20 flex-shrink-0" />}
                        <span className="text-xl">{t.icon}</span>
                        <span className="text-xs font-medium flex-1">{t.name}</span>
                        <span className={`text-xs text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-white/5 mt-1 space-y-2">
                          {t.id === 'custom' ? (
                            <>
                              <input value={taskData?.title || ''} onChange={e => updateTaskField(t.id, 'title', e.target.value)} className="input-field text-xs py-2" placeholder="Task title (e.g. Visit our website)" />
                              <input value={taskData?.url || ''} onChange={e => updateTaskField(t.id, 'url', e.target.value)} className="input-field text-xs py-2" placeholder="Task URL (https://...)" />
                            </>
                          ) : (
                            <p className="text-xs text-gray-500">Visitors will be directed to complete this task on the official platform.</p>
                          )}
                          <button type="button" onClick={(e) => { e.stopPropagation(); removeTask(t.id); }} className="text-xs text-red-400 hover:text-red-300">Remove task</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Settings</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-field">
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Expiry Date (optional)</label>
                  <input type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className="input-field" />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-4 border-t border-white/5">
              <Link href="/dashboard/campaigns" className="btn-ghost px-5 py-2.5 rounded-xl text-sm flex items-center justify-center">Cancel</Link>
              <button onClick={handleSubmit} disabled={saving} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
