import Link from 'next/link';
import BlogCard from '@/components/BlogCard';
import BlogEmptyState from '@/components/BlogEmptyState';
import { getLatestPublishedPosts } from '@/lib/blog-data';

export default async function BlogPreview() {
  const posts = await getLatestPublishedPosts(6);

  return (
    <section id="blog" className="relative py-20 sm:py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-12 flex-wrap gap-3">
          <div>
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-2">From the blog</div>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Tips, guides & <span className="gradient-text">insights</span></h2>
          </div>
          <Link href="/blog" className="text-xs sm:text-sm text-purple-400 hover:text-purple-300">View all posts →</Link>
        </div>
        {posts.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {posts.map(post => <BlogCard key={post.id} post={post} />)}
          </div>
        ) : (
          <BlogEmptyState />
        )}
      </div>
    </section>
  );
}
