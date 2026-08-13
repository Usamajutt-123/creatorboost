import { unstable_cache } from 'next/cache';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { normalizeBlogContent, type BlogContentBlock } from '@/lib/blog-content';

export type BlogPostSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  featured_image: string;
  author_name: string;
  status: 'draft' | 'published';
  published_at: string;
  created_at: string;
  updated_at: string;
  reading_time: number;
};

export type BlogImage = {
  id: string;
  post_id: string;
  image_url: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type BlogPost = BlogPostSummary & {
  content: BlogContentBlock[];
  featured_image_path: string;
  author_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[];
  images: BlogImage[];
};

const SUMMARY_COLUMNS = 'id, title, slug, excerpt, category, featured_image, author_name, status, published_at, created_at, updated_at, reading_time';
const FULL_COLUMNS = `${SUMMARY_COLUMNS}, content, featured_image_path, author_id, seo_title, seo_description, seo_keywords`;

function publicBlogClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function mapSummary(row: Record<string, unknown>): BlogPostSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: String(row.excerpt),
    category: String(row.category),
    featured_image: String(row.featured_image),
    author_name: String(row.author_name),
    status: 'published',
    published_at: String(row.published_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    reading_time: Math.max(1, Number(row.reading_time) || 1),
  };
}

async function fetchLatestPublishedPosts(limit: number): Promise<BlogPostSummary[]> {
  const supabase = publicBlogClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('blog_posts')
    .select(SUMMARY_COLUMNS)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) {
    // Missing migration/database availability should never take down a public
    // marketing page. The themed empty state remains truthful.
    console.error('[blog] latest posts could not be loaded', { code: error.code, message: error.message });
    return [];
  }
  return (data || []).map(row => mapSummary(row as Record<string, unknown>));
}

const cachedLatestPublishedPosts = unstable_cache(
  fetchLatestPublishedPosts,
  ['published-blog-posts-latest'],
  { revalidate: 300, tags: ['blog'] },
);

export async function getLatestPublishedPosts(limit = 6): Promise<BlogPostSummary[]> {
  return cachedLatestPublishedPosts(Math.max(1, Math.min(12, Math.floor(limit))));
}

export type PublishedPostList = {
  posts: BlogPostSummary[];
  count: number;
  categories: string[];
};

export async function getPublishedPostList(input: {
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<PublishedPostList> {
  const supabase = publicBlogClient();
  if (!supabase) return { posts: [], count: 0, categories: [] };

  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.max(1, Math.min(24, Math.floor(input.pageSize || 9)));
  const from = (page - 1) * pageSize;
  const now = new Date().toISOString();
  const search = (input.search || '').trim().replace(/[%_,().]/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
  const category = (input.category || '').trim().slice(0, 80);

  let query = supabase
    .from('blog_posts')
    .select(SUMMARY_COLUMNS, { count: 'exact' })
    .eq('status', 'published')
    .lte('published_at', now)
    .order('published_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (search) query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%,category.ilike.%${search}%`);
  if (category) query = query.eq('category', category);

  const [postResult, categoryResult] = await Promise.all([
    query,
    supabase
      .from('blog_posts')
      .select('category')
      .eq('status', 'published')
      .lte('published_at', now)
      .order('category')
      .limit(1000),
  ]);

  if (postResult.error) {
    console.error('[blog] post list could not be loaded', { code: postResult.error.code, message: postResult.error.message });
  }
  if (categoryResult.error) {
    console.error('[blog] categories could not be loaded', { code: categoryResult.error.code, message: categoryResult.error.message });
  }

  const categories = [...new Set((categoryResult.data || [])
    .map(row => String(row.category || '').trim())
    .filter(Boolean))];
  return {
    posts: (postResult.data || []).map(row => mapSummary(row as Record<string, unknown>)),
    count: postResult.count || 0,
    categories,
  };
}

export async function getPublishedPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = publicBlogClient();
  if (!supabase || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await supabase
    .from('blog_posts')
    .select(FULL_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[blog] post could not be loaded', { code: error.code, message: error.message });
    return null;
  }
  const { data: images, error: imageError } = await supabase
    .from('blog_images')
    .select('id, post_id, image_url, storage_path, caption, sort_order, created_at')
    .eq('post_id', data.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (imageError) console.error('[blog] article images could not be loaded', { code: imageError.code, message: imageError.message });
  return {
    ...mapSummary(data as Record<string, unknown>),
    content: normalizeBlogContent(data.content),
    featured_image_path: String(data.featured_image_path || ''),
    author_id: data.author_id ? String(data.author_id) : null,
    seo_title: data.seo_title ? String(data.seo_title) : null,
    seo_description: data.seo_description ? String(data.seo_description) : null,
    seo_keywords: Array.isArray(data.seo_keywords) ? data.seo_keywords.map(String) : [],
    images: (images || []).map(image => ({
      ...image,
      caption: image.caption || null,
      sort_order: Number(image.sort_order) || 0,
    })) as BlogImage[],
  };
}

export async function getRelatedPublishedPosts(post: Pick<BlogPost, 'id' | 'category'>, limit = 3): Promise<BlogPostSummary[]> {
  const supabase = publicBlogClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('blog_posts')
    .select(SUMMARY_COLUMNS)
    .eq('status', 'published')
    .eq('category', post.category)
    .neq('id', post.id)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(Math.max(1, Math.min(6, limit)));
  if (error) return [];
  return (data || []).map(row => mapSummary(row as Record<string, unknown>));
}

export async function getPublishedPostSitemapRows(): Promise<Array<{ slug: string; updated_at: string }>> {
  const supabase = publicBlogClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('blog_posts')
    .select('slug, updated_at')
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(5000);
  if (error) return [];
  return (data || []).map(row => ({ slug: row.slug, updated_at: row.updated_at }));
}
