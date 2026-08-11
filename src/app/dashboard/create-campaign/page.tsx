'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Send, Upload, X, Plus, Image as ImageIcon, Check } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { isValidHttpUrl } from '@/lib/utils';
import { toast } from 'sonner';
import { IconType } from "react-icons";

import {
  FaYoutube,
  FaTelegram,
  FaDiscord,
  FaInstagram,
  FaTiktok,
  FaFacebook,
  FaXTwitter,
  FaGlobe,
  FaDownload,
  FaComment,
  FaThumbsUp,
  FaPlay,
  FaGear,
} from "react-icons/fa6";

type TaskField = {
  id: string;
  title?: string;
  url?: string;
};

const TASK_OPTIONS = [
  { id: "youtube_subscribe", name: "YouTube Subscribe", icon: FaYoutube, color: "text-red-500" },
  { id: "youtube_like", name: "YouTube Like", icon: FaThumbsUp, color: "text-red-500" },
  { id: "youtube_comment", name: "YouTube Comment", icon: FaComment, color: "text-red-500" },
  { id: "watch_video", name: "YouTube Watch", icon: FaPlay, color: "text-red-500" },

  { id: "telegram_join", name: "Telegram Join", icon: FaTelegram, color: "text-sky-500" },
  { id: "discord_join", name: "Discord Join", icon: FaDiscord, color: "text-indigo-500" },

  { id: "instagram_follow", name: "Instagram Follow", icon: FaInstagram, color: "text-pink-500" },
  { id: "tiktok_follow", name: "TikTok Follow", icon: FaTiktok, color: "text-white" },

  { id: "facebook_follow", name: "Facebook Follow", icon: FaFacebook, color: "text-blue-600" },
  { id: "twitter_follow", name: "X (Twitter)", icon: FaXTwitter, color: "text-white" },

  { id: "website_visit", name: "Website Visit", icon: FaGlobe, color: "text-green-500" },
  { id: "file_download", name: "Download App", icon: FaDownload, color: "text-yellow-500" },

  { id: "custom", name: "Custom Task", icon: FaGear, color: "text-purple-500" },
];
const CATEGORIES = ['youtube_growth', 'instagram_growth', 'tiktok_growth', 'telegram_growth', 'discord_growth', 'website_traffic', 'app_install', 'other'];

export default function CreateCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<TaskField[]>([]);
  const [thumbnailPreview, setThumbnailPreview] = useState<string>('');
  const [bannerPreview, setBannerPreview] = useState<string>('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const thumbRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '', description: '', category: 'youtube_growth', destination_url: '', status: 'active',
    expires_at: '',
  });

  const toggleTask = (id: string) => {
    // If clicking the same expanded task → collapse it
    if (expandedTask === id) {
      setExpandedTask(null);
      return;
    }
    // Expand the clicked task and collapse all others (only one open at a time)
    setExpandedTask(id);
    // Add to selected tasks if not already
    if (!selectedTasks.find(t => t.id === id)) {
      setSelectedTasks([...selectedTasks, { id }]);
    }
  };

  const updateTaskField = (id: string, field: 'title' | 'url', value: string) => {
    setSelectedTasks(selectedTasks.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const removeTask = (id: string) => {
    setSelectedTasks(selectedTasks.filter(t => t.id !== id));
    if (expandedTask === id) setExpandedTask(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'thumbnail' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be less than 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === 'thumbnail') {
        setThumbnailFile(file);
        setThumbnailPreview(reader.result as string);
      } else {
        setBannerFile(file);
        setBannerPreview(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadMedia = async (supabase: any, file: File, type: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const fileExt = file.name.split('.').pop();
    const path = `${user.id}/${Date.now()}-${type}.${fileExt}`;
    const { error: upErr } = await supabase.storage
      .from('campaigns')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      console.error('Upload error:', upErr);
      toast.error(`Failed to upload ${type}: ${upErr.message}`);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('campaigns').getPublicUrl(path);
    return publicUrl;
  };

  const handleSubmit = async (status: 'active' | 'draft') => {
    if (!form.name) { toast.error('Campaign name is required'); return; }
    if (selectedTasks.length === 0) { toast.error('Select at least one task'); return; }
    if (status === 'active' && !form.destination_url) { toast.error('Destination URL is required'); return; }
    if (status === 'active' && !isValidHttpUrl(form.destination_url)) { toast.error('Destination URL must be a valid http(s) URL'); return; }

    // Validate custom task fields
    const customTask = selectedTasks.find(t => t.id === 'custom');
    if (customTask && (!customTask.title || !customTask.url)) {
      toast.error('Custom task requires both title and URL');
      setExpandedTask('custom');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    try {
      let thumbnailUrl = '';
      let bannerUrl = '';

      if (thumbnailFile) {
        const url = await uploadMedia(supabase, thumbnailFile, 'thumbnail');
        if (url) thumbnailUrl = url;
      }
      if (bannerFile) {
        const url = await uploadMedia(supabase, bannerFile, 'banner');
        if (url) bannerUrl = url;
      }

      const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const taskIds = selectedTasks.map(t => t.id);
      const taskMetadata: Record<string, any> = {};
      selectedTasks.forEach(t => {
        if (t.id === 'custom' && t.title && t.url) {
          taskMetadata[t.id] = { title: t.title, url: t.url };
        }
      });

      const { error } = await supabase.from('campaigns').insert({
        creator_id: user.id,
        name: form.name,
        slug: `${slug}-${Date.now().toString(36)}`,
        description: form.description,
        category: form.category,
        destination_url: form.destination_url || '',
        tasks: taskIds,
        task_metadata: taskMetadata,
        thumbnail_url: thumbnailUrl || null,
        banner_url: bannerUrl || null,
        status,
        expires_at: form.expires_at || null,
      });

      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success(status === 'active' ? 'Campaign launched!' : 'Draft saved');
      router.push('/dashboard/campaigns');
    } catch (e: any) {
      toast.error(e.message || 'Failed to create campaign');
      setLoading(false);
    }
  };

  return (
    <>
      <DashboardTopbar title="Create Campaign" subtitle="Set up your unlock campaign" />
      <div className="p-4 sm:p-6">
        <div className="max-w-4xl space-y-6">
          <div className="glass-strong rounded-2xl p-6 space-y-6">
            <div>
              <h3 className="font-semibold mb-4">Basic Information</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Campaign Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="My Awesome Campaign" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Category</label>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input-field">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Description</label>
                  <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input-field" placeholder="Tell visitors what to expect..." />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-300 block mb-1.5">Destination URL *</label>
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
                      <img src={thumbnailPreview} alt="Thumbnail preview" className="w-full h-32 object-cover rounded-lg" />
                      <button type="button" onClick={() => { setThumbnailFile(null); setThumbnailPreview(''); }} className="absolute top-3 right-3 p-1 bg-red-500/80 hover:bg-red-500 rounded-full">
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
                      <img src={bannerPreview} alt="Banner preview" className="w-full h-32 object-cover rounded-lg" />
                      <button type="button" onClick={() => { setBannerFile(null); setBannerPreview(''); }} className="absolute top-3 right-3 p-1 bg-red-500/80 hover:bg-red-500 rounded-full">
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
              <h3 className="font-semibold mb-1">Select Tasks *</h3>
              <p className="text-xs text-gray-500 mb-3">Click a task to expand and configure. Click again to collapse.</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TASK_OPTIONS.map(t => {
                  const isExpanded = expandedTask === t.id;
                  const isSelected = selectedTasks.find(x => x.id === t.id);
                  const taskData = selectedTasks.find(x => x.id === t.id);
                  return (
                    <div
                      key={t.id}
                      className={`glass rounded-xl transition-all ${isExpanded ? 'ring-2 ring-purple-500 bg-purple-500/10 col-span-full sm:col-span-2 lg:col-span-3' :
                        isSelected ? 'ring-1 ring-purple-500/60 bg-purple-500/5' :
                          'hover:bg-white/5'
                        }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTask(t.id)}
                        className="w-full p-3 flex items-center gap-3 text-left"
                      >
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-md bg-purple-500 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-md border border-white/20 flex-shrink-0" />
                        )}
                        {
                          (() => {
                            const Icon = t.icon;
                            return <Icon className={`w-6 h-6 ${t.color}`} />;
                          })()
                        }
                        <span className="text-xs font-medium flex-1">{t.name}</span>
                        <span className={`text-xs text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          ▾
                        </span>
                      </button>




                    </div>
                  );
                })}
              </div>
              {selectedTasks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedTasks.map(t => {
                    const meta = TASK_OPTIONS.find(x => x.id === t.id);
                    return meta ? (
                      <span key={t.id} className="badge badge-platinum flex items-center gap-1">
                        {(() => {
                          const Icon = meta.icon;
                          return <Icon className={`w-4 h-4 ${meta.color}`} />;
                        })()}

                        <span>{meta.name}</span>
                        <X className="w-3 h-3 cursor-pointer" onClick={() => removeTask(t.id)} />
                      </span>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {selectedTasks.length > 0 && (
              <div className="glass rounded-2xl p-6">
                <h3 className="font-semibold mb-4">Task Settings</h3>

                <div className="space-y-5">
                  {selectedTasks.map((task) => {
                    const meta = TASK_OPTIONS.find(t => t.id === task.id);
                    if (!meta) return null;

                    return (
                      <div key={task.id} className="border-b border-white/10 pb-4">
                        <h4 className="font-medium mb-3">{meta.name}</h4>

                        {task.id === "custom" ? (
                          <>
                            <input
                              className="input-field mb-3"
                              placeholder="Task Title"
                              value={task.title || ""}
                              onChange={(e) =>
                                updateTaskField(task.id, "title", e.target.value)
                              }
                            />

                            <input
                              className="input-field"
                              placeholder="https://..."
                              value={task.url || ""}
                              onChange={(e) =>
                                updateTaskField(task.id, "url", e.target.value)
                              }
                            />
                          </>
                        ) : (
                          <input
                            className="input-field"
                            placeholder={`Enter ${meta.name} URL`}
                            value={task.url || ""}
                            onChange={(e) =>
                              updateTaskField(task.id, "url", e.target.value)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <h3 className="font-semibold mb-4">Settings</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 block mb-1.5 ">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-field ">
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
              <button onClick={() => handleSubmit('draft')} disabled={loading} className="btn-ghost px-5 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Save Draft
              </button>
              <button onClick={() => handleSubmit('active')} disabled={loading} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {loading ? 'Creating...' : 'Launch Campaign'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}