import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatBlogDate } from '@/lib/blog-content';
import type { BlogPostSummary } from '@/lib/blog-data';

export default function BlogCard({ post }: { post: BlogPostSummary }) {
  return (
    <article className="glass rounded-2xl overflow-hidden card-glow h-full flex flex-col">
      <Link href={`/blog/${post.slug}`} className="relative block h-32 sm:h-40 bg-gradient-to-br from-purple-500/20 to-blue-500/20 overflow-hidden">
        <Image
          src={post.featured_image}
          alt={post.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 hover:scale-105"
        />
      </Link>
      <div className="p-4 sm:p-5 flex flex-col flex-1">
        <div className="text-[10px] sm:text-xs text-purple-300 mb-1 sm:mb-2">{post.category}</div>
        <h3 className="font-semibold mb-1 sm:mb-2 line-clamp-2 text-xs sm:text-sm">
          <Link href={`/blog/${post.slug}`} className="hover:text-purple-200 transition-colors">{post.title}</Link>
        </h3>
        <p className="text-[10px] sm:text-xs text-gray-400 mb-3 sm:mb-4 line-clamp-2">{post.excerpt}</p>
        <div className="mt-auto flex items-center justify-between gap-2 text-[10px] sm:text-xs text-gray-500">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[9px] sm:text-[10px] font-bold flex-shrink-0 text-white">
              {post.author_name.charAt(0).toUpperCase()}
            </div>
            <span className="truncate">{post.author_name} • {formatBlogDate(post.published_at)}</span>
          </div>
          <Link href={`/blog/${post.slug}`} className="flex-shrink-0 text-purple-400 hover:text-purple-300 inline-flex items-center gap-1" aria-label={`Read ${post.title}`}>
            Read More <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}
