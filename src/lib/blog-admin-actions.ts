'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getDashboardProfile, getSessionUser } from '@/lib/session';
import { calculateBlogReadingTime, normalizeBlogContent, slugifyBlogTitle, type BlogContentBlock } from '@/lib/blog-content';
import type { BlogImage, BlogPost } from '@/lib/blog-data';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STORAGE_PATH_RE = /^(featured|content)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|jpeg|png|webp|avif)$/i;

export type AdminBlogPost = Omit<BlogPost, 'featured_image' | 'featured_image_path' | 'published_at'> & {
  featured_image: string | null;
  featured_image_path: string | null;
  published_at: string | null;
};

export type AdminBlogListPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  featured_image: string | null;
  author_name: string;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  reading_time: number;
};

export type AdminBlogImageInput = {
  storagePath: string;
  caption?: string | null;
};

export type AdminBlogPostInput = {
  id?: string;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: BlogContentBlock[];
  authorName: string;
  status: 'draft' | 'published';
  publishedAt?: string | null;
  featuredImagePath?: string | null;
  images?: AdminBlogImageInput[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[];
  unusedStoragePaths?: string[];
};

type BlogAdmin = { id: string; role: 'admin' | 'super_admin' };

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function requireBlogAdmin(): Promise<BlogAdmin> {
  const [user, profile] = await Promise.all([getSessionUser(), getDashboardProfile()]);
  if (!user || !profile) throw new Error('Not authenticated');
  if ((profile.role !== 'admin' && profile.role !== 'super_admin') || profile.status === 'suspended' || profile.status === 'banned') {
    throw new Error('Admin privileges required');
  }
  return { id: user.id, role: profile.role };
}

function text(value: unknown, label: string, min: number, max: number): string {
  const normalized = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} must be between ${min} and ${max} characters`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  const normalized = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return normalized;
}

function storagePath(value: unknown, kind?: 'featured' | 'content'): string {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(STORAGE_PATH_RE);
  if (!match || (kind && match[1].toLowerCase() !== kind)) throw new Error('An uploaded blog image path is invalid');
  return normalized;
}

function publicImageUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string): string {
  return supabase.storage.from('blog').getPublicUrl(path).data.publicUrl;
}

function cleanKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = value
    .map(item => String(item).trim().replace(/\s+/g, ' ').slice(0, 50))
    .filter(Boolean);
  return [...new Set(values)].slice(0, 20);
}

function cleanDate(value: unknown, status: 'draft' | 'published'): string | null {
  if (value == null || value === '') return status === 'published' ? new Date().toISOString() : null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('Published date is invalid');
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2200) throw new Error('Published date is invalid');
  return date.toISOString();
}

async function auditBlog(admin: BlogAdmin, action: string, postId: string, details?: unknown) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const service = createAdminClient();
    await service.rpc('audit_action', {
      p_action: action,
      p_entity_type: 'blog_post',
      p_entity_id: postId,
      p_old_values: null,
      p_new_values: details ? JSON.parse(JSON.stringify(details)) : null,
      p_ip: null,
      p_actor_id: admin.id,
    });
  } catch (error) {
    console.error('[blog admin] audit failed', error);
  }
}

function refreshBlogPaths(slug?: string) {
  updateTag('blog');
  revalidatePath('/');
  revalidatePath('/blog');
  revalidatePath('/sitemap.xml');
  revalidatePath('/admin/blog');
  if (slug) revalidatePath(`/blog/${slug}`);
}

export async function adminListBlogPosts(): Promise<AdminBlogListPost[]> {
  await requireBlogAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, category, featured_image, author_name, status, published_at, created_at, updated_at, reading_time')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw new Error('Blog posts could not be loaded');
  return (data || []) as AdminBlogListPost[];
}

export async function adminGetBlogPost(id: string): Promise<AdminBlogPost | null> {
  await requireBlogAdmin();
  if (!validUuid(id)) return null;
  const supabase = await createClient();
  const [{ data, error }, { data: images, error: imageError }] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, content, category, featured_image, featured_image_path, author_id, author_name, status, published_at, created_at, updated_at, reading_time, seo_title, seo_description, seo_keywords')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('blog_images')
      .select('id, post_id, image_url, storage_path, caption, sort_order, created_at')
      .eq('post_id', id)
      .order('sort_order')
      .order('created_at'),
  ]);
  if (error) throw new Error('Blog post could not be loaded');
  if (!data) return null;
  if (imageError) throw new Error('Article images could not be loaded');
  return {
    ...data,
    content: normalizeBlogContent(data.content),
    seo_keywords: Array.isArray(data.seo_keywords) ? data.seo_keywords.map(String) : [],
    images: (images || []).map(row => ({ ...row, sort_order: Number(row.sort_order) || 0 })) as BlogImage[],
  } as AdminBlogPost;
}

export async function adminSaveBlogPost(input: AdminBlogPostInput): Promise<{ ok: true; id: string; slug: string; publishedAt: string | null; storageWarning?: string }> {
  const admin = await requireBlogAdmin();
  if (!input || typeof input !== 'object') throw new Error('Blog post payload is invalid');
  const id = input.id && validUuid(input.id) ? input.id : null;
  if (input.id && !id) throw new Error('Blog post ID is invalid');
  const title = text(input.title, 'Title', 3, 200);
  const slug = text((input.slug || slugifyBlogTitle(title)).toLowerCase(), 'Slug', 1, 160);
  if (!SLUG_RE.test(slug)) throw new Error('Slug can contain only lowercase letters, numbers, and single hyphens');
  const category = text(input.category, 'Category', 1, 80);
  const excerpt = text(input.excerpt, 'Excerpt', 1, 500);
  const authorName = text(input.authorName, 'Author', 1, 120);
  if (input.status !== 'draft' && input.status !== 'published') throw new Error('Post status is invalid');
  const content = normalizeBlogContent(input.content);
  const featuredImagePath = input.featuredImagePath ? storagePath(input.featuredImagePath, 'featured') : null;
  if (input.status === 'published' && content.length === 0) throw new Error('Add article content before publishing');
  if (input.status === 'published' && !featuredImagePath) throw new Error('Add a featured image before publishing');
  const publishedAt = cleanDate(input.publishedAt, input.status);
  const seoTitle = optionalText(input.seoTitle, 'SEO title', 120);
  const seoDescription = optionalText(input.seoDescription, 'SEO description', 320);
  const seoKeywords = cleanKeywords(input.seoKeywords);
  const images = (Array.isArray(input.images) ? input.images : []).slice(0, 30).map((image, index) => ({
    storage_path: storagePath(image.storagePath, 'content'),
    caption: optionalText(image.caption, 'Image caption', 300),
    sort_order: index,
  }));
  if (new Set(images.map(image => image.storage_path)).size !== images.length) throw new Error('Duplicate article images are not allowed');

  const supabase = await createClient();
  let existing: { slug: string; featured_image_path: string | null } | null = null;
  let existingImages: Array<{ storage_path: string }> = [];
  if (id) {
    const [postResult, imageResult] = await Promise.all([
      supabase.from('blog_posts').select('slug, featured_image_path').eq('id', id).maybeSingle(),
      supabase.from('blog_images').select('storage_path').eq('post_id', id),
    ]);
    if (postResult.error || !postResult.data) throw new Error('Blog post was not found');
    if (imageResult.error) throw new Error('Article images could not be checked');
    existing = postResult.data;
    existingImages = imageResult.data || [];
  }

  // New uploads must belong to the acting admin. Existing assets from another
  // admin remain valid when a teammate edits the post.
  const existingPaths = new Set([
    existing?.featured_image_path || '',
    ...existingImages.map(image => image.storage_path),
  ]);
  for (const path of [featuredImagePath, ...images.map(image => image.storage_path)].filter(Boolean) as string[]) {
    const match = path.match(STORAGE_PATH_RE)!;
    if (match[2].toLowerCase() !== admin.id.toLowerCase() && !existingPaths.has(path)) {
      throw new Error('A newly uploaded image does not belong to your session');
    }
  }

  const payload = {
    title,
    slug,
    excerpt,
    content,
    category,
    featured_image: featuredImagePath ? publicImageUrl(supabase, featuredImagePath) : null,
    featured_image_path: featuredImagePath,
    author_name: authorName,
    status: input.status,
    published_at: publishedAt,
    reading_time: calculateBlogReadingTime(content),
    seo_title: seoTitle,
    seo_description: seoDescription,
    seo_keywords: seoKeywords,
  };

  let postId = id;
  if (id) {
    const { error } = await supabase.from('blog_posts').update(payload).eq('id', id);
    if (error) {
      if (error.code === '23505') throw new Error('That slug is already used by another post');
      throw new Error(error.message || 'Blog post could not be saved');
    }
  } else {
    // Build a newly published post privately as a draft until its image rows
    // are synchronized. Readers never see a half-created article.
    const insertPayload = input.status === 'published' ? { ...payload, status: 'draft' as const } : payload;
    const { data, error } = await supabase
      .from('blog_posts')
      .insert({ ...insertPayload, author_id: admin.id })
      .select('id')
      .single();
    if (error || !data) {
      if (error?.code === '23505') throw new Error('That slug is already used by another post');
      throw new Error(error?.message || 'Blog post could not be created');
    }
    postId = data.id;
  }

  if (!postId) throw new Error('Blog post could not be saved');

  const desiredPaths = new Set(images.map(image => image.storage_path));
  const removedImagePaths = existingImages.map(image => image.storage_path).filter(path => !desiredPaths.has(path));
  if (removedImagePaths.length > 0) {
    const { error } = await supabase.from('blog_images').delete().eq('post_id', postId).in('storage_path', removedImagePaths);
    if (error) throw new Error('Removed article images could not be saved');
  }
  for (const image of images) {
    const imageUrl = publicImageUrl(supabase, image.storage_path);
    if (existingImages.some(item => item.storage_path === image.storage_path)) {
      const { error } = await supabase
        .from('blog_images')
        .update({ caption: image.caption, sort_order: image.sort_order, image_url: imageUrl })
        .eq('post_id', postId)
        .eq('storage_path', image.storage_path);
      if (error) throw new Error('An article image could not be updated');
    } else {
      const { error } = await supabase.from('blog_images').insert({
        post_id: postId,
        image_url: imageUrl,
        storage_path: image.storage_path,
        caption: image.caption,
        sort_order: image.sort_order,
      });
      if (error) {
        // A failed first save must not strand a row that the editor does not
        // know how to reopen. Uploaded objects stay available for a retry.
        if (!id) await supabase.from('blog_posts').delete().eq('id', postId);
        throw new Error('An article image could not be saved');
      }
    }
  }

  if (!id && input.status === 'published') {
    const { error } = await supabase.from('blog_posts').update({ status: 'published' }).eq('id', postId);
    if (error) {
      await supabase.from('blog_posts').delete().eq('id', postId);
      throw new Error('The post could not be published');
    }
  }

  const requestedUnused = (Array.isArray(input.unusedStoragePaths) ? input.unusedStoragePaths : [])
    .map(path => storagePath(path))
    .filter(path => !desiredPaths.has(path) && path !== featuredImagePath);
  const obsoleteFeatured = existing?.featured_image_path && existing.featured_image_path !== featuredImagePath
    ? [existing.featured_image_path]
    : [];
  const filesToRemove = [...new Set([...removedImagePaths, ...obsoleteFeatured, ...requestedUnused])];
  let storageWarning: string | undefined;
  if (filesToRemove.length > 0) {
    const { error } = await supabase.storage.from('blog').remove(filesToRemove);
    if (error) {
      storageWarning = 'The post was saved, but one or more unused image files could not be removed.';
      console.error('[blog admin] unused asset cleanup failed', { message: error.message });
    }
  }

  await auditBlog(admin, id ? 'blog_update' : 'blog_create', postId, { title, slug, status: input.status });
  refreshBlogPaths(slug);
  if (existing?.slug && existing.slug !== slug) revalidatePath(`/blog/${existing.slug}`);
  return { ok: true, id: postId, slug, publishedAt, ...(storageWarning ? { storageWarning } : {}) };
}

export async function adminSetBlogPostStatus(id: string, status: 'draft' | 'published') {
  const admin = await requireBlogAdmin();
  if (!validUuid(id) || (status !== 'draft' && status !== 'published')) throw new Error('Invalid blog action');
  const supabase = await createClient();
  const { data: post, error: readError } = await supabase
    .from('blog_posts')
    .select('slug, published_at')
    .eq('id', id)
    .maybeSingle();
  if (readError || !post) throw new Error('Blog post was not found');
  const patch = status === 'published'
    ? { status, published_at: post.published_at || new Date().toISOString() }
    : { status };
  const { error } = await supabase.from('blog_posts').update(patch).eq('id', id);
  if (error) {
    if (error.code === '23514') throw new Error('Add a featured image and article content before publishing');
    throw new Error('Blog status could not be changed');
  }
  await auditBlog(admin, status === 'published' ? 'blog_publish' : 'blog_unpublish', id, { status });
  refreshBlogPaths(post.slug);
  return { ok: true };
}

export async function adminDeleteBlogPost(id: string): Promise<{ ok: true; storageWarning?: string }> {
  const admin = await requireBlogAdmin();
  if (!validUuid(id)) throw new Error('Invalid blog post ID');
  const supabase = await createClient();
  const [{ data: post, error: postError }, { data: images, error: imageError }] = await Promise.all([
    supabase.from('blog_posts').select('slug, featured_image_path').eq('id', id).maybeSingle(),
    supabase.from('blog_images').select('storage_path').eq('post_id', id),
  ]);
  if (postError || !post) throw new Error('Blog post was not found');
  if (imageError) throw new Error('Blog images could not be checked');
  const { error } = await supabase.from('blog_posts').delete().eq('id', id);
  if (error) throw new Error('Blog post could not be deleted');

  const paths = [...new Set([post.featured_image_path, ...(images || []).map(image => image.storage_path)].filter(Boolean))] as string[];
  let storageWarning: string | undefined;
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('blog').remove(paths);
    if (storageError) {
      storageWarning = 'The post was deleted, but one or more image files could not be removed.';
      console.error('[blog admin] post asset cleanup failed', { message: storageError.message });
    }
  }
  await auditBlog(admin, 'blog_delete', id, { slug: post.slug });
  refreshBlogPaths(post.slug);
  return { ok: true, ...(storageWarning ? { storageWarning } : {}) };
}

/** Cleanup for a newly uploaded image removed before the post is saved. */
export async function adminDeleteUnusedBlogAsset(pathValue: string) {
  const admin = await requireBlogAdmin();
  const path = storagePath(pathValue);
  const match = path.match(STORAGE_PATH_RE)!;
  if (match[2].toLowerCase() !== admin.id.toLowerCase()) throw new Error('You cannot remove that image');
  const supabase = await createClient();
  const { count: featuredUse } = await supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('featured_image_path', path);
  const { count: contentUse } = await supabase.from('blog_images').select('id', { count: 'exact', head: true }).eq('storage_path', path);
  if ((featuredUse || 0) > 0 || (contentUse || 0) > 0) throw new Error('That image is currently in use');
  const { error } = await supabase.storage.from('blog').remove([path]);
  if (error) throw new Error('Unused image could not be removed');
  return { ok: true };
}
