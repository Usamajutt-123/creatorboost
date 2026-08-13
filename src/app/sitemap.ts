import { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getPublishedPostSitemapRows } from '@/lib/blog-data';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
  const staticRoutes = ['', '/about', '/blog', '/contact', '/support', '/terms', '/privacy'].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: route === '' ? 1 : 0.7,
  }));

  // Dynamic routes are best-effort: if the DB is unavailable (e.g. during
  // build without env), fall back to static routes rather than failing.
  let campaignRoutes: MetadataRoute.Sitemap = [];
  let blogRoutes: MetadataRoute.Sitemap = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return staticRoutes;
  }
  try {
    const supabase = await createClient();
    const [{ data: campaigns }, posts] = await Promise.all([
      supabase.from('public_campaigns').select('slug, updated_at').limit(1000),
      getPublishedPostSitemapRows(),
    ]);
    campaignRoutes = (campaigns || []).map(c => ({
      url: `${baseUrl}/c/${c.slug}`,
      lastModified: new Date(c.updated_at),
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
    blogRoutes = posts.map(post => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  } catch (e) {
    console.error('[sitemap] could not fetch dynamic routes', e);
  }

  return [...staticRoutes, ...blogRoutes, ...campaignRoutes];
}
