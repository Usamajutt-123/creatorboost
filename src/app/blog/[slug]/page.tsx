import type { Metadata } from 'next';
import { cache } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Clock3, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import BlogCard from '@/components/BlogCard';
import BlogArticleContent from '@/components/BlogArticleContent';
import { formatBlogDate } from '@/lib/blog-content';
import { getPublishedPostBySlug, getRelatedPublishedPosts } from '@/lib/blog-data';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
const getPost = cache(getPublishedPostBySlug);

type BlogPostPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: 'Post not found', robots: { index: false, follow: false } };
  const title = post.seo_title || post.title;
  const description = post.seo_description || post.excerpt;
  const canonical = `${siteUrl}/blog/${post.slug}`;
  return {
    title,
    description,
    keywords: post.seo_keywords,
    authors: [{ name: post.author_name }],
    alternates: { canonical },
    openGraph: {
      type: 'article',
      url: canonical,
      title,
      description,
      images: [{ url: post.featured_image, alt: post.title }],
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      authors: [post.author_name],
      section: post.category,
      tags: post.seo_keywords,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [post.featured_image],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  const related = await getRelatedPublishedPosts(post, 3);
  const canonical = `${siteUrl}/blog/${post.slug}`;
  const articleJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seo_description || post.excerpt,
    image: [post.featured_image, ...post.images.map(image => image.image_url)],
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { '@type': 'Person', name: post.author_name },
    publisher: { '@type': 'Organization', name: 'CreatorBoost', logo: { '@type': 'ImageObject', url: `${siteUrl}/logo.png` } },
    mainEntityOfPage: canonical,
    articleSection: post.category,
    keywords: post.seo_keywords.join(', '),
  }).replace(/</g, '\\u003c');

  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-14 hero-gradient">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleJsonLd }} />
        <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" /> Back to Blog
          </Link>
          <header className="mb-8 sm:mb-10">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">{post.category}</div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-5">{post.title}</h1>
            <p className="text-base sm:text-lg text-gray-400 leading-relaxed max-w-3xl mb-6">{post.excerpt}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm text-gray-400">
              <span className="inline-flex items-center gap-2"><UserRound className="w-4 h-4 text-purple-400" /> {post.author_name}</span>
              <span className="inline-flex items-center gap-2"><CalendarDays className="w-4 h-4 text-purple-400" /> {formatBlogDate(post.published_at, 'long')}</span>
              <span className="inline-flex items-center gap-2"><Clock3 className="w-4 h-4 text-purple-400" /> {post.reading_time} min read</span>
            </div>
          </header>

          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden glass mb-10 sm:mb-12 shadow-2xl shadow-purple-950/30">
            <Image
              src={post.featured_image}
              alt={post.title}
              fill
              priority
              sizes="(max-width: 896px) 100vw, 896px"
              className="object-cover"
            />
          </div>

          <div className="glass-strong rounded-2xl px-5 py-7 sm:px-9 sm:py-10">
            <BlogArticleContent content={post.content} />

            {post.images.length > 0 && (
              <div className="mt-10 sm:mt-12 space-y-8 sm:space-y-10" aria-label="Article images">
                {post.images.map(image => (
                  <figure key={image.id}>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-white/5 border border-white/10">
                      <Image
                        src={image.image_url}
                        alt={image.caption || post.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 760px"
                        className="object-cover"
                      />
                    </div>
                    {image.caption && <figcaption className="text-center text-xs sm:text-sm text-gray-500 mt-3">{image.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
          </div>
        </article>

        {related.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-16 sm:mt-20" aria-labelledby="related-posts-heading">
            <div className="flex items-center justify-between gap-4 mb-7">
              <h2 id="related-posts-heading" className="font-display text-2xl sm:text-3xl font-bold">Related <span className="gradient-text">posts</span></h2>
              <Link href="/blog" className="text-sm text-purple-400 hover:text-purple-300">View all →</Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {related.map(item => <BlogCard key={item.id} post={item} />)}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
