import { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
  const staticRoutes = ['', '/about', '/blog', '/contact', '/support', '/terms', '/privacy'].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: route === '' ? 1 : 0.7,
  }));

  // Campaign routes are best-effort: if the DB is unavailable (e.g. during
  // build without env), fall back to static routes rather than failing.
  let campaignRoutes: MetadataRoute.Sitemap = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return staticRoutes;
  }
  try {
    const supabase = await createClient();
    const { data: campaigns } = await supabase
      .from('public_campaigns')
      .select('slug, updated_at')
      .limit(1000);
    campaignRoutes = (campaigns || []).map(c => ({
      url: `${baseUrl}/c/${c.slug}`,
      lastModified: new Date(c.updated_at),
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
  } catch (e) {
    console.error('[sitemap] could not fetch campaigns', e);
  }

  return [...staticRoutes, ...campaignRoutes];
}
