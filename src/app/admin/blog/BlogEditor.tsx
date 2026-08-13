'use client';

/* Local blob previews cannot be processed by next/image before upload. */
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown, ArrowLeft, ArrowUp, Eye, FileText, Heading2, Heading3,
  ImagePlus, List, ListOrdered, Loader2, MessageSquareQuote, Plus, Save, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  adminDeleteUnusedBlogAsset,
  adminSaveBlogPost,
  type AdminBlogPost,
  type AdminBlogPostInput,
} from '@/lib/blog-admin-actions';
import {
  BLOG_BLOCK_TYPES,
  blogWordCount,
  calculateBlogReadingTime,
  slugifyBlogTitle,
  type BlogBlockType,
  type BlogContentBlock,
} from '@/lib/blog-content';
import { uploadBlogImage, validateBlogImage } from '@/lib/blog-upload';
import Select from '@/components/Select';

const BLOCK_LABELS: Record<BlogBlockType, string> = {
  paragraph: 'Paragraph',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  quote: 'Quote',
  'bulleted-list': 'Bulleted list',
  'numbered-list': 'Numbered list',
};

const BLOCK_ICONS: Record<BlogBlockType, typeof FileText> = {
  paragraph: FileText,
  heading2: Heading2,
  heading3: Heading3,
  quote: MessageSquareQuote,
  'bulleted-list': List,
  'numbered-list': ListOrdered,
};

type EditorImage = {
  key: string;
  storagePath: string;
  url: string;
  caption: string;
  progress: number;
  uploading: boolean;
  error: string | null;
  isNew: boolean;
};

function key(prefix: string) {
  const id = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function emptyBlock(type: BlogBlockType = 'paragraph'): BlogContentBlock {
  return { id: key('block'), type, text: '' };
}

function localDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export default function BlogEditor({ initialPost, defaultAuthor }: {
  initialPost: AdminBlogPost | null;
  defaultAuthor: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialPost?.title || '');
  const [slug, setSlug] = useState(initialPost?.slug || '');
  const [slugTouched, setSlugTouched] = useState(Boolean(initialPost));
  const [category, setCategory] = useState(initialPost?.category || '');
  const [excerpt, setExcerpt] = useState(initialPost?.excerpt || '');
  const [authorName, setAuthorName] = useState(initialPost?.author_name || defaultAuthor);
  const [status, setStatus] = useState<'draft' | 'published'>(initialPost?.status || 'draft');
  const [publishedAt, setPublishedAt] = useState(localDateTime(initialPost?.published_at));
  const [seoTitle, setSeoTitle] = useState(initialPost?.seo_title || '');
  const [seoDescription, setSeoDescription] = useState(initialPost?.seo_description || '');
  const [seoKeywords, setSeoKeywords] = useState((initialPost?.seo_keywords || []).join(', '));
  const [blocks, setBlocks] = useState<BlogContentBlock[]>(initialPost?.content.length ? initialPost.content : [{ id: 'block-new-1', type: 'paragraph', text: '' }]);
  const [featured, setFeatured] = useState<EditorImage | null>(initialPost?.featured_image_path ? {
    key: 'featured-existing',
    storagePath: initialPost.featured_image_path,
    url: initialPost.featured_image || '',
    caption: '', progress: 100, uploading: false, error: null, isNew: false,
  } : null);
  const [featuredUpload, setFeaturedUpload] = useState<{ preview: string; progress: number; error: string | null } | null>(null);
  const [images, setImages] = useState<EditorImage[]>((initialPost?.images || []).map(image => ({
    key: image.id,
    storagePath: image.storage_path,
    url: image.image_url,
    caption: image.caption || '',
    progress: 100,
    uploading: false,
    error: null,
    isNew: false,
  })));
  const [unusedPaths, setUnusedPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const removedDuringUpload = useRef(new Set<string>());

  const featuredUploading = Boolean(featuredUpload && !featuredUpload.error && featuredUpload.progress < 100);
  const uploading = featuredUploading || images.some(image => image.uploading);
  const wordCount = blogWordCount(blocks);
  const readingTime = calculateBlogReadingTime(blocks);

  const cleanupNewAsset = async (path: string) => {
    try {
      await adminDeleteUnusedBlogAsset(path);
    } catch (error) {
      console.error('[blog editor] unused upload cleanup failed', error);
    }
  };

  const markRemoved = (image: EditorImage) => {
    if (!image.storagePath) return;
    if (image.isNew) void cleanupNewAsset(image.storagePath);
    else setUnusedPaths(current => [...new Set([...current, image.storagePath])]);
  };

  const uploadFeatured = async (file: File | undefined) => {
    if (!file) return;
    const validation = validateBlogImage(file);
    if (validation) { toast.error(validation); return; }
    if (featuredUpload?.preview.startsWith('blob:')) URL.revokeObjectURL(featuredUpload.preview);
    const preview = URL.createObjectURL(file);
    setFeaturedUpload({ preview, progress: 0, error: null });
    try {
      const uploaded = await uploadBlogImage(file, 'featured', progress => {
        setFeaturedUpload(current => current ? { ...current, progress } : current);
      });
      if (featured) markRemoved(featured);
      setFeatured({ key: key('featured'), storagePath: uploaded.storagePath, url: uploaded.publicUrl, caption: '', progress: 100, uploading: false, error: null, isNew: true });
      setFeaturedUpload(null);
      toast.success('Featured image uploaded.');
    } catch (error: any) {
      // Keep the previously saved featured image when replacement fails.
      setFeaturedUpload(null);
      toast.error(error?.message || 'Featured image upload failed.');
    } finally {
      URL.revokeObjectURL(preview);
    }
  };

  const addArticleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const available = Math.max(0, 30 - images.length);
    const files = Array.from(fileList).slice(0, available);
    if (files.length < fileList.length) toast.error('A post can contain up to 30 article images.');
    for (const file of files) {
      const validation = validateBlogImage(file);
      if (validation) { toast.error(`${file.name}: ${validation}`); continue; }
      const imageKey = key('image');
      const preview = URL.createObjectURL(file);
      const pending: EditorImage = { key: imageKey, storagePath: '', url: preview, caption: '', progress: 0, uploading: true, error: null, isNew: true };
      setImages(current => [...current, pending]);
      void uploadBlogImage(file, 'content', progress => {
        setImages(current => current.map(image => image.key === imageKey ? { ...image, progress } : image));
      }).then(uploaded => {
        if (removedDuringUpload.current.has(imageKey)) {
          removedDuringUpload.current.delete(imageKey);
          void cleanupNewAsset(uploaded.storagePath);
          URL.revokeObjectURL(preview);
          return;
        }
        setImages(current => current.map(image => image.key === imageKey ? {
          ...image, storagePath: uploaded.storagePath, url: uploaded.publicUrl, progress: 100, uploading: false,
        } : image));
        URL.revokeObjectURL(preview);
      }).catch((error: any) => {
        // Keep the local thumbnail visible with the upload error.
        setImages(current => current.map(image => image.key === imageKey ? { ...image, uploading: false, error: error?.message || 'Upload failed.' } : image));
        toast.error(`${file.name}: ${error?.message || 'Upload failed.'}`);
      });
    }
  };

  const replaceArticleImage = async (index: number, file: File | undefined) => {
    if (!file) return;
    const validation = validateBlogImage(file);
    if (validation) { toast.error(validation); return; }
    const previous = images[index];
    if (!previous) return;
    const preview = URL.createObjectURL(file);
    setImages(current => current.map((image, currentIndex) => currentIndex === index ? { ...image, url: preview, progress: 0, uploading: true, error: null } : image));
    try {
      const uploaded = await uploadBlogImage(file, 'content', progress => {
        setImages(current => current.map((image, currentIndex) => currentIndex === index ? { ...image, progress } : image));
      });
      markRemoved(previous);
      setImages(current => current.map((image, currentIndex) => currentIndex === index ? {
        ...image, storagePath: uploaded.storagePath, url: uploaded.publicUrl, progress: 100, uploading: false, isNew: true,
      } : image));
      toast.success('Article image replaced.');
    } catch (error: any) {
      // A persisted original remains valid when replacement fails. A retry of
      // an already-failed new upload keeps its visible error state.
      setImages(current => current.map((image, currentIndex) => currentIndex === index ? {
        ...previous,
        error: previous.storagePath ? null : (previous.error || error?.message || 'Replacement failed.'),
      } : image));
      toast.error(error?.message || 'Image replacement failed.');
    } finally {
      URL.revokeObjectURL(preview);
    }
  };

  const removeImage = (index: number) => {
    const image = images[index];
    if (!image) return;
    if (image.uploading && !image.storagePath) removedDuringUpload.current.add(image.key);
    else markRemoved(image);
    if (!image.uploading && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
    setImages(current => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const removeFeatured = () => {
    if (featured) markRemoved(featured);
    if (featuredUpload?.preview.startsWith('blob:')) URL.revokeObjectURL(featuredUpload.preview);
    setFeatured(null);
    setFeaturedUpload(null);
  };

  const updateBlock = (index: number, patch: Partial<BlogContentBlock>) => {
    setBlocks(current => current.map((block, currentIndex) => currentIndex === index ? { ...block, ...patch } : block));
  };

  const addBlock = (type: BlogBlockType) => setBlocks(current => [...current, emptyBlock(type)]);

  const save = async (nextStatus: 'draft' | 'published' = status) => {
    if (uploading) { toast.error('Wait for all image uploads to finish.'); return; }
    if (images.some(image => image.error || !image.storagePath)) { toast.error('Remove or replace failed article image uploads before saving.'); return; }
    setSaving(true);
    try {
      const input: AdminBlogPostInput = {
        id: initialPost?.id,
        title,
        slug,
        category,
        excerpt,
        content: blocks,
        authorName,
        status: nextStatus,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
        featuredImagePath: featured?.storagePath || null,
        images: images.map(image => ({ storagePath: image.storagePath, caption: image.caption })),
        seoTitle,
        seoDescription,
        seoKeywords: seoKeywords.split(',').map(value => value.trim()).filter(Boolean),
        unusedStoragePaths: unusedPaths,
      };
      const result = await adminSaveBlogPost(input);
      setStatus(nextStatus);
      setPublishedAt(localDateTime(result.publishedAt));
      setUnusedPaths([]);
      setFeatured(current => current ? { ...current, isNew: false } : null);
      setImages(current => current.map(image => ({ ...image, isNew: false })));
      if (result.storageWarning) toast.warning(result.storageWarning);
      else toast.success(nextStatus === 'published' ? 'Post published.' : 'Draft saved.');
      if (!initialPost) router.replace(`/admin/blog/${result.id}/edit`);
      else router.refresh();
    } catch (error: any) {
      toast.error(error?.message || 'Blog post could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/blog" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-white mb-2"><ArrowLeft className="w-3.5 h-3.5" /> Back to Blog</Link>
          <h1 className="font-display text-2xl font-bold">{initialPost ? 'Edit Post' : 'Create Post'}</h1>
          <p className="text-sm text-gray-500">Structured editor · {wordCount.toLocaleString()} words · {readingTime} min read</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {initialPost && <Link href={`/admin/blog/${initialPost.id}/preview`} target="_blank" className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5"><Eye className="w-3.5 h-3.5" /> Preview</Link>}
          <button type="button" onClick={() => save('draft')} disabled={saving || uploading} className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save Draft</button>
          <button type="button" onClick={() => save('published')} disabled={saving || uploading} className="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white gap-1.5 disabled:opacity-50">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Publish</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <section className="glass-strong rounded-2xl p-4 sm:p-6 space-y-4">
            <h2 className="font-semibold">Post details</h2>
            <div><label className="text-xs text-gray-400 block mb-1.5">Title *</label><input value={title} maxLength={200} onChange={event => { const value = event.target.value; setTitle(value); if (!slugTouched) setSlug(slugifyBlogTitle(value)); }} className="input-field" placeholder="Article title" /><div className="text-right text-[10px] text-gray-600 mt-1">{title.length}/200</div></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">Slug *</label><div className="flex items-center"><span className="text-xs text-gray-500 mr-2 hidden sm:inline">/blog/</span><input value={slug} maxLength={160} onChange={event => { setSlugTouched(true); setSlug(slugifyBlogTitle(event.target.value)); }} className="input-field font-mono text-xs" placeholder="article-slug" /></div></div>
            <div className="grid sm:grid-cols-2 gap-4"><div><label className="text-xs text-gray-400 block mb-1.5">Category *</label><input value={category} maxLength={80} onChange={event => setCategory(event.target.value)} className="input-field" placeholder="Creator Guides" /></div><div><label className="text-xs text-gray-400 block mb-1.5">Author *</label><input value={authorName} maxLength={120} onChange={event => setAuthorName(event.target.value)} className="input-field" placeholder="Author name" /></div></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">Short excerpt *</label><textarea value={excerpt} maxLength={500} rows={3} onChange={event => setExcerpt(event.target.value)} className="input-field resize-y" placeholder="A concise summary shown on blog cards and search results." /><div className="text-right text-[10px] text-gray-600 mt-1">{excerpt.length}/500</div></div>
          </section>

          <section className="glass-strong rounded-2xl p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 className="font-semibold">Article content</h2><p className="text-xs text-gray-500">Build a safe, structured article with headings, lists, quotes, and paragraphs.</p></div></div>
            <div className="space-y-3">
              {blocks.map((block, index) => {
                const Icon = BLOCK_ICONS[block.type];
                return (
                  <div key={block.id} className="glass rounded-xl p-3 sm:p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <Icon className="w-4 h-4 text-purple-300" />
                      <Select
                        value={block.type}
                        onChange={value => updateBlock(index, { type: value as BlogBlockType })}
                        ariaLabel="Block type"
                        className="inline-block w-auto"
                        triggerClassName="py-1.5 px-2 text-xs"
                        options={BLOG_BLOCK_TYPES.map(type => ({ value: type, label: BLOCK_LABELS[type] }))}
                      />
                      <div className="ml-auto flex items-center gap-1"><button type="button" onClick={() => setBlocks(current => move(current, index, -1))} disabled={index === 0} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30" aria-label="Move block up"><ArrowUp className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setBlocks(current => move(current, index, 1))} disabled={index === blocks.length - 1} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30" aria-label="Move block down"><ArrowDown className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setBlocks(current => current.filter((_, currentIndex) => currentIndex !== index))} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400" aria-label="Remove block"><Trash2 className="w-3.5 h-3.5" /></button></div>
                    </div>
                    <textarea value={block.text} onChange={event => updateBlock(index, { text: event.target.value })} rows={block.type.includes('list') ? 5 : block.type === 'paragraph' ? 6 : 3} className="input-field resize-y leading-relaxed" placeholder={block.type.includes('list') ? 'Add one list item per line…' : `Write a ${BLOCK_LABELS[block.type].toLowerCase()}…`} />
                  </div>
                );
              })}
              {!blocks.length && <div className="glass rounded-xl p-8 text-center text-sm text-gray-500">Add a content block to begin writing.</div>}
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {BLOG_BLOCK_TYPES.map(type => { const Icon = BLOCK_ICONS[type]; return <button key={type} type="button" onClick={() => addBlock(type)} className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5"><Plus className="w-3 h-3" /><Icon className="w-3.5 h-3.5" />{BLOCK_LABELS[type]}</button>; })}
            </div>
          </section>

          <section className="glass-strong rounded-2xl p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><h2 className="font-semibold">Article images</h2><p className="text-xs text-gray-500">Upload up to 30 images. Reorder them and add optional captions.</p></div><label className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5 cursor-pointer"><ImagePlus className="w-4 h-4" /> Add Images<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only" onChange={event => { addArticleFiles(event.target.files); event.target.value = ''; }} /></label></div>
            <div className="grid sm:grid-cols-2 gap-4">
              {images.map((image, index) => (
                <div key={image.key} className="glass rounded-xl overflow-hidden">
                  <div className="relative aspect-[16/10] bg-white/5"><img src={image.url} alt={image.caption || `Article image ${index + 1}`} className="w-full h-full object-cover" />{image.uploading && <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-purple-300 mb-2" /><span className="text-xs">Uploading {image.progress}%</span><div className="w-2/3 h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-blue-500" style={{ width: `${image.progress}%` }} /></div></div>}{image.error && <div className="absolute inset-x-0 bottom-0 bg-red-950/90 text-red-200 text-xs p-2">{image.error}</div>}</div>
                  <div className="p-3 space-y-2"><input value={image.caption} maxLength={300} onChange={event => setImages(current => current.map((item, currentIndex) => currentIndex === index ? { ...item, caption: event.target.value } : item))} className="input-field py-2 text-xs" placeholder="Image caption (optional)" /><div className="flex items-center gap-1"><button type="button" onClick={() => setImages(current => move(current, index, -1))} disabled={index === 0 || image.uploading} className="btn-ghost p-2 rounded-lg disabled:opacity-30" aria-label="Move image up"><ArrowUp className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setImages(current => move(current, index, 1))} disabled={index === images.length - 1 || image.uploading} className="btn-ghost p-2 rounded-lg disabled:opacity-30" aria-label="Move image down"><ArrowDown className="w-3.5 h-3.5" /></button><label className={`btn-ghost px-2.5 py-2 rounded-lg text-xs ${image.uploading ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}>Replace<input type="file" disabled={image.uploading} accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={event => { void replaceArticleImage(index, event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" onClick={() => removeImage(index)} disabled={image.uploading} className="btn-ghost px-2.5 py-2 rounded-lg text-xs text-red-400 ml-auto disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button></div></div>
                </div>
              ))}
            </div>
            {!images.length && <div className="border border-dashed border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">No article images uploaded.</div>}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20">
          <section className="glass-strong rounded-2xl p-4 space-y-4">
            <h2 className="font-semibold">Publishing</h2>
            <div><label className="text-xs text-gray-400 block mb-1.5">Status</label><Select value={status} onChange={value => setStatus(value as 'draft' | 'published')} ariaLabel="Publishing status" options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }]} /></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">Published date</label><input type="datetime-local" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} className="input-field" /><p className="text-[10px] text-gray-600 mt-1">Leave blank to publish immediately. Future dates stay hidden until scheduled time.</p></div>
            <button type="button" onClick={() => save(status)} disabled={saving || uploading} className="btn-primary w-full py-2.5 rounded-xl text-sm font-semibold text-white gap-2 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes</button>
          </section>

          <section className="glass-strong rounded-2xl p-4 space-y-3">
            <div><h2 className="font-semibold">Featured image</h2><p className="text-xs text-gray-500">JPG, PNG, WebP, or AVIF · max 8 MB</p></div>
            {(featuredUpload || featured) ? <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-white/5 border border-white/10"><img src={featuredUpload?.preview || featured?.url} alt="Featured preview" className="w-full h-full object-cover" />{featuredUpload && !featuredUpload.error && <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-purple-300" /><span className="text-xs mt-2">Uploading {featuredUpload.progress}%</span><div className="w-2/3 h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-blue-500" style={{ width: `${featuredUpload.progress}%` }} /></div></div>}{featuredUpload?.error && <div className="absolute inset-x-0 bottom-0 bg-red-950/90 text-red-200 text-xs p-2">{featuredUpload.error}</div>}</div> : <div className="aspect-[16/9] rounded-xl border border-dashed border-white/10 flex items-center justify-center text-gray-600"><ImagePlus className="w-8 h-8" /></div>}
            <div className="flex gap-2"><label className="btn-ghost flex-1 px-3 py-2 rounded-lg text-xs gap-1.5 cursor-pointer"><ImagePlus className="w-3.5 h-3.5" /> {featured ? 'Replace' : 'Choose image'}<input type="file" disabled={featuredUploading} accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={event => { void uploadFeatured(event.target.files?.[0]); event.target.value = ''; }} /></label>{featured && <button type="button" onClick={removeFeatured} disabled={featuredUploading} className="btn-ghost px-3 py-2 rounded-lg text-xs text-red-400 disabled:opacity-30" aria-label="Remove featured image"><Trash2 className="w-3.5 h-3.5" /></button>}</div>
          </section>

          <section className="glass-strong rounded-2xl p-4 space-y-4">
            <div><h2 className="font-semibold">SEO metadata</h2><p className="text-xs text-gray-500">Optional overrides. The title and excerpt are used by default.</p></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">SEO title</label><input value={seoTitle} maxLength={120} onChange={event => setSeoTitle(event.target.value)} className="input-field py-2.5" placeholder={title || 'Search title'} /><div className="text-right text-[10px] text-gray-600 mt-1">{seoTitle.length}/120</div></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">SEO description</label><textarea value={seoDescription} maxLength={320} rows={4} onChange={event => setSeoDescription(event.target.value)} className="input-field resize-y" placeholder={excerpt || 'Search description'} /><div className="text-right text-[10px] text-gray-600 mt-1">{seoDescription.length}/320</div></div>
            <div><label className="text-xs text-gray-400 block mb-1.5">SEO keywords</label><input value={seoKeywords} onChange={event => setSeoKeywords(event.target.value)} className="input-field py-2.5" placeholder="creator tips, monetization, growth" /><p className="text-[10px] text-gray-600 mt-1">Comma-separated, up to 20 keywords.</p></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
