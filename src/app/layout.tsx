import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space', display: 'swap' });

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
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`}>
        {children}
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  );
}
