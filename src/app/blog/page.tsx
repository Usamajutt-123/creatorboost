import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import BlogCard from '@/components/BlogCard';
import BlogEmptyState from '@/components/BlogEmptyState';
import BlogCategoryFilter from './BlogCategoryFilter';
import { getPublishedPostList } from '@/lib/blog-data';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
const pageSize = 9;

export const metadata: Metadata = {
  title: 'Blog',
  description: 'CreatorBoost tips, guides, product resources, and creator growth insights.',
  alternates: { canonical: `${siteUrl}/blog` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/blog`,
    title: 'CreatorBoost Blog',
    description: 'CreatorBoost tips, guides, product resources, and creator growth insights.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CreatorBoost Blog' }],
  },
};

type BlogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function pageHref(page: number, search: string, category: string) {
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (category) params.set('category', category);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/blog?${query}` : '/blog';
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const params = await searchParams;
  const search = first(params.q).trim().slice(0, 100);
  const category = first(params.category).trim().slice(0, 80);
  const requestedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { posts, count, categories } = await getPublishedPostList({ search, category, page, pageSize });
  const pageCount = Math.max(1, Math.ceil(count / pageSize));

  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Blog</span>
          </nav>
          <header className="text-center mb-10 sm:mb-12">
            <span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Resources</span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Creator <span className="gradient-text">resources</span></h1>
            <p className="text-gray-400 max-w-2xl mx-auto">Tips, guides, and product insights from CreatorBoost.</p>
          </header>

          <form method="get" action="/blog" className="glass rounded-2xl p-3 sm:p-4 mb-8 grid sm:grid-cols-[1fr_220px_auto] gap-3" role="search">
            <label className="relative block">
              <span className="sr-only">Search blog posts</span>
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input name="q" defaultValue={search} maxLength={100} className="input-field pl-10" placeholder="Search posts…" />
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
              <BlogCategoryFilter categories={categories} currentCategory={category} />
            </label>
            <button type="submit" className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white">Search</button>
          </form>

          {(search || category) && (
            <div className="flex items-center justify-between gap-3 mb-5 text-sm">
              <p className="text-gray-400">{count} {count === 1 ? 'post' : 'posts'} found</p>
              <Link href="/blog" className="text-purple-400 hover:text-purple-300">Clear filters</Link>
            </div>
          )}

          {posts.length > 0 ? (
            <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5" aria-label="Blog posts">
              {posts.map(post => <BlogCard key={post.id} post={post} />)}
            </section>
          ) : (
            <BlogEmptyState filtered={Boolean(search || category || page > 1)} />
          )}

          {count > pageSize && (
            <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Blog pagination">
              {page > 1 ? (
                <Link href={pageHref(page - 1, search, category)} className="btn-ghost px-4 py-2.5 rounded-xl text-sm">← Previous</Link>
              ) : <span className="btn-ghost px-4 py-2.5 rounded-xl text-sm opacity-40" aria-disabled="true">← Previous</span>}
              <span className="px-3 text-xs text-gray-400">Page {Math.min(page, pageCount)} of {pageCount}</span>
              {page < pageCount ? (
                <Link href={pageHref(page + 1, search, category)} className="btn-ghost px-4 py-2.5 rounded-xl text-sm">Next →</Link>
              ) : <span className="btn-ghost px-4 py-2.5 rounded-xl text-sm opacity-40" aria-disabled="true">Next →</span>}
            </nav>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
