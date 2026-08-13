import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays, Clock3, Edit3, UserRound } from 'lucide-react';
import { adminGetBlogPost } from '@/lib/blog-admin-actions';
import BlogArticleContent from '@/components/BlogArticleContent';
import { formatBlogDate } from '@/lib/blog-content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Blog Post Preview', robots: { index: false, follow: false } };

export default async function AdminBlogPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await adminGetBlogPost(id);
  if (!post) notFound();

  return (
    <div className="p-4 sm:p-6 pb-14">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <Link href="/admin/blog" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="w-4 h-4" /> Back to Blog</Link>
          <Link href={`/admin/blog/${post.id}/edit`} className="btn-ghost px-3 py-2 rounded-lg text-xs gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Edit Post</Link>
        </div>
        <div className="mb-5 rounded-xl border border-purple-400/20 bg-purple-500/10 px-4 py-3 text-xs text-purple-200">Admin preview · This {post.status === 'draft' ? 'draft is not visible publicly' : 'published post is visible publicly'}.</div>
        <article>
          <header className="mb-8">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">{post.category}</div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-5">{post.title}</h1>
            <p className="text-base sm:text-lg text-gray-400 leading-relaxed mb-6">{post.excerpt}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs sm:text-sm text-gray-400"><span className="inline-flex items-center gap-2"><UserRound className="w-4 h-4 text-purple-400" /> {post.author_name}</span><span className="inline-flex items-center gap-2"><CalendarDays className="w-4 h-4 text-purple-400" /> {post.published_at ? formatBlogDate(post.published_at, 'long') : 'Not published'}</span><span className="inline-flex items-center gap-2"><Clock3 className="w-4 h-4 text-purple-400" /> {post.reading_time} min read</span></div>
          </header>
          {post.featured_image ? <div className="relative aspect-[16/9] rounded-2xl overflow-hidden glass mb-10"><Image src={post.featured_image} alt={post.title} fill priority sizes="(max-width: 896px) 100vw, 896px" className="object-cover" /></div> : <div className="glass rounded-2xl aspect-[16/9] mb-10 flex items-center justify-center text-sm text-gray-500">No featured image</div>}
          <div className="glass-strong rounded-2xl px-5 py-7 sm:px-9 sm:py-10"><BlogArticleContent content={post.content} />{!post.content.length && <p className="text-sm text-gray-500 text-center py-8">No article content yet.</p>}{post.images.length > 0 && <div className="mt-10 space-y-8">{post.images.map(image => <figure key={image.id}><div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-white/10"><Image src={image.image_url} alt={image.caption || post.title} fill sizes="(max-width: 768px) 100vw, 760px" className="object-cover" /></div>{image.caption && <figcaption className="text-center text-xs text-gray-500 mt-3">{image.caption}</figcaption>}</figure>)}</div>}</div>
        </article>
      </div>
    </div>
  );
}
