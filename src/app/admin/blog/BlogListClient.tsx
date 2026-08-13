'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Edit3, Eye, FilePlus2, Globe2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Select from '@/components/Select';
import {
  adminDeleteBlogPost,
  adminListBlogPosts,
  adminSetBlogPostStatus,
  type AdminBlogListPost,
} from '@/lib/blog-admin-actions';
import { formatBlogDate } from '@/lib/blog-content';

export default function AdminBlogListClient({ initialPosts, initialError }: {
  initialPosts: AdminBlogListPost[];
  initialError: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  const categories = useMemo(() => [...new Set(posts.map(post => post.category))].sort(), [posts]);
  const filtered = useMemo(() => posts.filter(post => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || post.title.toLowerCase().includes(term) || post.slug.toLowerCase().includes(term) || post.excerpt.toLowerCase().includes(term);
    return matchesSearch && (status === 'all' || post.status === status) && (category === 'all' || post.category === category);
  }), [category, posts, search, status]);

  const load = async () => {
    setLoading(true);
    try {
      setPosts(await adminListBlogPosts());
    } catch (error: any) {
      toast.error(error?.message || 'Blog posts could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const changeStatus = async (post: AdminBlogListPost) => {
    const next = post.status === 'published' ? 'draft' : 'published';
    setBusy(post.id);
    try {
      await adminSetBlogPostStatus(post.id, next);
      toast.success(next === 'published' ? 'Post published.' : 'Post moved to draft.');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Post status could not be changed.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (post: AdminBlogListPost) => {
    if (!window.confirm(`Permanently delete “${post.title}” and its images?`)) return;
    setBusy(post.id);
    try {
      const result = await adminDeleteBlogPost(post.id);
      if (result.storageWarning) toast.warning(result.storageWarning);
      else toast.success('Post deleted.');
      setPosts(current => current.filter(item => item.id !== post.id));
    } catch (error: any) {
      toast.error(error?.message || 'Post could not be deleted.');
    } finally {
      setBusy(null);
    }
  };

  const actions = (post: AdminBlogListPost) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Link href={`/admin/blog/${post.id}/edit`} className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs gap-1"><Edit3 className="w-3.5 h-3.5" /> Edit</Link>
      <Link href={`/admin/blog/${post.id}/preview`} target="_blank" className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs gap-1"><Eye className="w-3.5 h-3.5" /> Preview</Link>
      <button onClick={() => changeStatus(post)} disabled={busy === post.id} className={`btn-ghost px-2.5 py-1.5 rounded-lg text-xs gap-1 ${post.status === 'published' ? 'text-yellow-300' : 'text-green-300'}`}>
        <Globe2 className="w-3.5 h-3.5" /> {post.status === 'published' ? 'Unpublish' : 'Publish'}
      </button>
      <button onClick={() => remove(post)} disabled={busy === post.id} className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs gap-1 text-red-400"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold">Blog Management</h1><p className="text-sm text-gray-500">Create, edit, and publish CreatorBoost articles</p></div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <Link href="/admin/blog/new" className="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white gap-1.5"><FilePlus2 className="w-3.5 h-3.5" /> Create Post</Link>
        </div>
      </div>

      <div className="glass rounded-2xl p-3 sm:p-4 grid sm:grid-cols-3 gap-2">
        <label className="relative"><span className="sr-only">Search posts</span><Search className="absolute w-4 h-4 text-gray-500 left-3.5 top-1/2 -translate-y-1/2" /><input value={search} onChange={event => setSearch(event.target.value)} className="input-field py-2.5 pl-10" placeholder="Search title, slug, excerpt…" /></label>
        <Select value={category} onChange={setCategory} ariaLabel="Filter posts by category" options={[{ value: 'all', label: 'All categories' }, ...categories.map(value => ({ value, label: value }))]} />
        <Select value={status} onChange={setStatus} ariaLabel="Filter posts by status" options={[{ value: 'all', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }]} />
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">Posts</h2><span className="text-xs text-gray-500">{filtered.length} shown · {posts.length} total</span></div>

        <div className="space-y-3 sm:hidden">
          {filtered.map(post => (
            <article key={post.id} className="glass rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2"><div className="min-w-0"><h3 className="font-semibold text-sm line-clamp-2">{post.title}</h3><p className="text-[11px] text-gray-500 truncate">/blog/{post.slug}</p></div><span className={`badge ${post.status === 'published' ? 'status-active' : 'status-draft'}`}>{post.status}</span></div>
              <div className="text-xs text-gray-400 mb-3">{post.category} · {post.published_at ? formatBlogDate(post.published_at) : 'Not published'}</div>
              {actions(post)}
            </article>
          ))}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead><tr className="text-xs text-gray-500 border-b border-white/5"><th className="text-left py-2 font-medium">Post</th><th className="text-left py-2 font-medium">Category</th><th className="text-left py-2 font-medium">Author</th><th className="text-left py-2 font-medium">Status</th><th className="text-left py-2 font-medium">Published</th><th className="text-left py-2 font-medium">Actions</th></tr></thead>
            <tbody>
              {filtered.map(post => (
                <tr key={post.id} className="border-b border-white/5 table-row align-top">
                  <td className="py-3 pr-4 max-w-[280px]"><div className="font-medium line-clamp-1">{post.title}</div><div className="text-[11px] text-gray-500 truncate">/blog/{post.slug}</div></td>
                  <td className="py-3 pr-4 text-gray-400">{post.category}</td>
                  <td className="py-3 pr-4 text-gray-400">{post.author_name}</td>
                  <td className="py-3 pr-4"><span className={`badge ${post.status === 'published' ? 'status-active' : 'status-draft'}`}>{post.status}</span></td>
                  <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">{post.published_at ? formatBlogDate(post.published_at) : '—'}</td>
                  <td className="py-3">{actions(post)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <div className="py-12 text-center text-sm text-gray-500">{posts.length ? 'No posts match these filters.' : 'No blog posts yet. Create the first post when you are ready.'}</div>}
      </div>
    </div>
  );
}
