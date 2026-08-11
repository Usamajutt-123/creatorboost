import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'CreatorBoost – Grow Your Audience. Earn From Every Valid View.',
    template: '%s | CreatorBoost',
  },
  description: 'CreatorBoost helps creators monetize their audience through smart unlock campaigns. Create campaigns, share your link, and earn money for every 1000 valid views.',
  keywords: ['creator monetization', 'CPM', 'YouTube subscribers', 'Instagram followers', 'TikTok', 'earn money', 'SaaS'],
  authors: [{ name: 'CreatorBoost' }],
  creator: 'CreatorBoost',
  publisher: 'CreatorBoost',
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'CreatorBoost',
    title: 'CreatorBoost – Grow Your Audience. Earn From Every Valid View.',
    description: 'A premium creator monetization platform. Earn money for every 1000 valid views.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CreatorBoost' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CreatorBoost – Grow Your Audience. Earn From Every Valid View.',
    description: 'A premium creator monetization platform.',
    images: ['/og.png'],
    creator: '@creatorboost',
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  alternates: { canonical: siteUrl },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#05030d',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'CreatorBoost',
              url: siteUrl,
              description: 'CreatorBoost helps creators monetize their audience through smart unlock campaigns.',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            }),
          }}
        />
        {children}
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  );
}
