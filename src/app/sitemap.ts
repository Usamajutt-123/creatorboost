import { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
  const supabase = createClient();

  const staticRoutes = ['', '/login', '/signup', '/support', '/terms', '/privacy'].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: route === '' ? 1 : 0.7,
  }));

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('slug, updated_at')
    .eq('status', 'active')
    .limit(1000);

  const campaignRoutes = (campaigns || []).map(c => ({
    url: `${baseUrl}/c/${c.slug}`,
    lastModified: new Date(c.updated_at),
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...campaignRoutes];
}
