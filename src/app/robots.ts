import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin', '/dashboard', '/api', '/destination', '/auth', '/login', '/signup', '/forgot-password', '/verify-email'] },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
