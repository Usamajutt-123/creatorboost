const defaultContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co; media-src 'self'; worker-src 'self' blob:";

// Public unlock pages can load a platform administrator's vetted ad-network
// snippet. This exception is intentionally scoped to /c/*; all other routes
// keep the stricter default CSP above. Banner markup still runs in a sandboxed
// iframe, while popunder code is triggered only by the visitor's first task.
const unlockPageAdContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https:; frame-src 'self' https:; media-src 'self' https:; worker-src 'self' blob:";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.creatorboost.io' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: defaultContentSecurityPolicy },
        ],
      },
      {
        // Overrides only the CSP header from the catch-all rule above. Public
        // campaign pages need their admin-configured ad provider to load;
        // dashboard, admin, and marketing pages retain the restrictive CSP.
        source: '/c/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: unlockPageAdContentSecurityPolicy },
        ],
      },
      {
        // The unlock link (/unlock/*) and the monetized shortener flow
        // (/go/*) are the same public, ad-bearing surface as /c/* and share
        // the same scoped CSP exception. Everything else stays restrictive.
        source: '/unlock/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: unlockPageAdContentSecurityPolicy },
        ],
      },
      {
        source: '/go/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: unlockPageAdContentSecurityPolicy },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  experimental: {
    // Tree-shake the icon barrels that are actually imported in this app.
    // `recharts` is not a dependency here, so listing it did nothing.
    optimizePackageImports: ['lucide-react', 'react-icons'],
  },
};

module.exports = nextConfig;
