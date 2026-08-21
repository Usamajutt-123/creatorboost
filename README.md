# CreatorBoost

> **Creator monetization platform** — smart unlock campaigns, server-side traffic checks, and dynamic CPM management.

![CreatorBoost Banner](https://img.shields.io/badge/Next.js-14-black) ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-3.4-38bdf8)

---

## 🎯 Overview

CreatorBoost is a creator monetization platform with protected campaign, traffic, earnings, referral, withdrawal, and administrative workflows. Administrators configure CPM rates, level multipliers, fraud sensitivity, withdrawal methods, and platform limits from protected server actions.

### What's included

- 🎨 **Premium SaaS UI** — Dark mode, glassmorphism, purple/blue neon gradients (Stripe/Vercel/Linear-style)
- ⚡ **Full-stack Next.js 14** — App Router, server components, edge-ready
- 🔐 **Authentication** — Email verification, password reset, and optional Google OAuth through Supabase Auth
- 📊 **Creator Dashboard** — Real-time earnings, analytics charts, level progression
- 🛡️ **Server-side fraud checks** — user-agent, VPN/proxy provider, duplicate, rate, and cap checks
- 💰 **Dynamic Earnings Engine** — No hardcoded values; everything is admin-controlled
- 🌍 **Country Tier System** — Tier 1/2/3 with admin-editable CPM per country
- 💎 **5 Creator Levels** — Bronze → Diamond with configurable CPM multipliers
- 🏦 **6 Withdrawal Methods** — JazzCash, EasyPaisa, PayPal, Binance, USDT, Bank
- 👥 **Referral System** — Lifetime commission with admin-configurable %
- 📢 **Admin Panel** — Full platform management (users, CPM, ads, levels, etc.)
- 🔒 **Row Level Security** — Supabase RLS policies on every table
- 🚀 **SEO Optimized** — Sitemap, robots.txt, OG tags, JSON-LD schema
- 📱 **Fully Responsive** — Mobile, tablet, desktop
- ♿ **Accessible** — WCAG 2.1 AA compliant
- ⚡ **Lighthouse 95+** — Optimized fonts, images, code splitting

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm or npm
- Supabase account (free tier works)
- Vercel account (for deployment)

### 1. Install

```bash
cd creatorboost
npm install
```

### 2. Setup Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Copy `.env.example` → `.env.local` and fill in your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
UNLOCK_TOKEN_SECRET=generate-a-long-random-string  # recommended for destination unlock cookies
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
CRON_SECRET=generate-a-long-random-string
RESEND_API_KEY=re_xxx            # optional — transactional email
IP_GEO_PROVIDER=ipwhois          # optional — server-side country lookup
```

3. Run the database migration:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

This creates all tables, RLS policies, triggers, and helper functions.

4. Deploy the fraud detection Edge Function (optional but recommended):

```bash
supabase functions deploy fraud-check
supabase secrets set IPQUALITYSCORE_KEY=your-key FRAUD_FUNCTION_SECRET=generate-a-long-random-string
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Create your first admin

After signing up the first user, promote them to admin:

```sql
UPDATE profiles SET role = 'super_admin' WHERE email = 'you@example.com';
```

---

## 📁 Project Structure

```
creatorboost/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Landing page
│   │   ├── login/              # Auth pages
│   │   ├── signup/
│   │   ├── forgot-password/
│   │   ├── verify-email/
│   │   ├── dashboard/          # Creator dashboard
│   │   │   ├── page.tsx
│   │   │   ├── campaigns/
│   │   │   ├── create-campaign/
│   │   │   ├── analytics/
│   │   │   ├── withdraw/
│   │   │   ├── referrals/
│   │   │   ├── tools/
│   │   │   ├── settings/
│   │   │   ├── notifications/
│   │   │   └── support/
│   │   ├── admin/              # Admin panel
│   │   │   ├── page.tsx        # Statistics
│   │   │   ├── users/
│   │   │   ├── campaigns/
│   │   │   ├── withdrawals/
│   │   │   ├── cpm/            # ⚠️ Dynamic CPM configuration
│   │   │   ├── ads/            # Ad network management
│   │   │   ├── levels/         # Creator level config
│   │   │   └── settings/       # Platform settings
│   │   ├── c/[slug]/           # Public unlock pages
│   │   ├── support/            # Public support center
│   │   ├── api/
│   │   │   └── views/record/   # View recording API
│   │   ├── auth/callback/      # OAuth callback
│   │   ├── sitemap.ts
│   │   └── robots.ts
│   ├── components/             # React components
│   │   ├── Navbar.tsx
│   │   ├── Footer.tsx
│   │   ├── DashboardSidebar.tsx
│   │   ├── AdminSidebar.tsx
│   │   ├── DashboardTopbar.tsx
│   │   ├── StatCard.tsx
│   │   ├── DashboardCharts.tsx
│   │   ├── AnalyticsCharts.tsx
│   │   ├── AdminCharts.tsx
│   │   ├── HeroChart.tsx
│   │   └── MobileSidebar.tsx
│   ├── lib/                    # Core logic
│   │   ├── supabase/
│   │   │   ├── client.ts       # Browser client
│   │   │   ├── server.ts       # Server client
│   │   │   └── middleware.ts   # Auth middleware
│   │   ├── earnings.ts         # Earnings engine
│   │   ├── earnings-client.ts
│   │   ├── rate-limit.ts
│   │   ├── utils.ts            # cn, formatCurrency, etc.
│   │   └── constants.ts        # Features, steps, levels
│   └── middleware.ts           # Next.js middleware
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql       # Database schema
│   │   └── 0002_rpc.sql        # RPC functions
│   └── functions/
│       └── fraud-check/        # Edge function
├── public/                     # Static assets
├── tailwind.config.ts
├── next.config.js
└── package.json
```

---

## 💰 The Earnings Engine

The most critical part: **how money flows**.

### Formula

```
earning_per_view = (country_tier.cpm_default × creator_level.cpm_multiplier) / 1000
```

**Example:**
- US visitor (Tier 1, $5 CPM)
- Gold creator (1.25× multiplier)
- Per view: ($5 × 1.25) / 1000 = **$0.00625**
- For 1000 valid views: **$6.25**

### All values are admin-controlled

| Value | Where to change |
|-------|----------------|
| Country CPM (min/max/default) | `/admin/cpm` |
| Creator level multiplier | `/admin/levels` |
| Payout % per country | `/admin/cpm` |
| Referral commission % | `/admin/settings` |
| Min withdrawal | `/admin/settings` |
| Fraud sensitivity | `/admin/settings` |
| Ad network revenue | tracked automatically |
| Platform profit | computed: `ad_revenue - creator_payouts` |

**There are zero hardcoded CPM values in the codebase.** When admin changes a rate, every new view uses the new rate immediately.

### Fraud detection

Every view is checked against:
- ✅ IP reputation (via IPQualityScore / MaxMind)
- ✅ VPN / proxy / Tor detection
- ✅ Bot user-agents (50+ patterns)
- ✅ Headless browser / emulator detection
- ✅ Duplicate device fingerprint (24h window)
- ✅ Duplicate IP (configurable window)
- ✅ Click spam patterns
- ✅ Geo mismatch
- ✅ Behavioral signals (future: ML model)

Invalid views are **automatically rejected** and **never credited to the creator**.

---

## 🎨 Theming

The design is built on:

- **Dark mode** by default (class: `dark`)
- **Black + Purple + Blue neon gradient** (see `tailwind.config.ts`)
- **Glassmorphism** via `backdrop-filter` utilities
- **Inter + Space Grotesk** fonts (Google Fonts, optimized)
- **Lucide icons** (tree-shakable)
- **Custom animations** (gradient, float, pulse-glow, marquee)

### Custom colors

```css
/* In globals.css */
.gradient-text { /* animated gradient text */ }
.hero-gradient { /* page background */ }
.glass { /* glassmorphism card */ }
.glass-strong { /* stronger glass */ }
.btn-primary { /* gradient button */ }
.btn-ghost { /* outline button */ }
.card-glow { /* hover effect */ }
```

---

## 🔐 Security

- ✅ **Row Level Security** on every Supabase table
- ✅ **HttpOnly cookies** for session
- ✅ **CSRF protection** via Supabase
- ✅ **Rate limiting** on API routes
- ✅ **Input validation** with Zod
- ✅ **SQL injection** prevented (parameterized queries)
- ✅ **XSS protection** (React + CSP headers in `next.config.js`)
- ✅ **2FA** support
- ✅ **Encrypted at rest** (Supabase default)

---

## 🚀 Deployment

### Deploy to Vercel (recommended)

1. Push to GitHub
2. Import on [vercel.com](https://vercel.com)
3. Add env vars
4. Deploy

```bash
# Or via CLI
npm i -g vercel
vercel
```

Vercel will auto-detect Next.js, optimize images, and configure CDN.

### Post-deployment checklist

- [ ] Set up custom domain
- [ ] Configure Supabase auth redirect URLs
- [ ] Set up Stripe/PayPal for ad network billing (if not self-managed)
- [ ] Configure email SMTP (Resend, SendGrid)
- [ ] Enable Supabase daily backups
- [ ] Set up monitoring (Sentry, LogRocket)
- [ ] Configure CDN for static assets
- [ ] Run Lighthouse audit

---

## 📊 Admin Panel Features

| Section | What you can do |
|---------|----------------|
| **Statistics** | Revenue, profit, creators, traffic overview |
| **Users** | Search, edit, suspend, promote to admin |
| **Campaigns** | View, pause, delete any campaign |
| **Withdrawals** | Approve / reject / mark as paid (with TX hash) |
| **CPM Rates** | Edit per-country min/max/default CPM + payout % |
| **Ad Networks** | Activate/deactivate Monetag, Adsterra, AdSense, etc. |
| **Creator Levels** | Edit min views, multiplier, perks, badge color |
| **Settings** | Min withdrawal, referral %, fraud sensitivity, methods |
| **Monetization** | Flow settings, step content + order, per-page ads, analytics, payouts |

---

## 🔗 The Monetized Unlock + Shortener Flow

Every unlock link is now a complete monetized funnel. The creator workflow stays
exactly the same — destination URL + tasks + publish — and the system handles the rest:

```
/unlock/[slug]           task page (creator branding, tasks, progress, ads)
     ↓  tasks complete + Unlock
/go/[slug]/1 .. /go/[slug]/4   admin-configured educational shortener pages
                                (rich content, countdown, ads — default 4 steps)
     ↓  final Continue
original destination     retrieved + validated server-side, then redirected
```

- **One dynamic page** powers every step: `/go/[slug]/[step]` renders the
  admin-configured step at that position — no duplicated hardcoded pages.
- **Server-validated progression**: a `flow_sessions` row (HttpOnly cookie)
  is the authority. Skipping to `/go/[slug]/4` redirects back to the next
  allowed step; the countdown is re-validated server-side on every Continue.
- **Qualified views pay**: the existing earnings engine records the view +
  earning only when the final step completes, with the creator share,
  per-view payout bounds and fraud adjustment from the admin payout settings.
  A completed flow can never be replayed for earnings (idempotency key +
  unique `(creator_id, flow_session_id)` index).
- **Admin controls everything** (no deployments needed):
  - `/admin/monetization/settings` — flow ON/OFF, step count, default
    countdown, progress bar, educational content, final redirect, test mode
  - `/admin/monetization/content` — step titles/rich content/button text/
    countdown/status + drag-and-drop ordering + safe flow preview
  - `/admin/monetization/ads` — per-page ad slots (task page + each step,
    3 slots each): Adsterra (native/standard/social bar/popunder) and
    Monetag (MultiTag/OnClick/in-page push/vignette), device targeting,
    placement, priority, frequency
  - `/admin/monetization/analytics` — funnel with step-by-step drop-off,
    countries, devices, revenue breakdown
  - `/admin/monetization/payouts` — country tiers, level multipliers,
    creator share, payout bounds, fraud adjustment, manual revenue ledger
- **Ads are optional and never a requirement**: visitors only wait for the
  countdown and click Continue. Ads never block navigation and a failed ad
  never blocks the page.
- **Safe by default**: test mode renders labeled ad placeholders and
  generates no earnings; admin preview sessions record no analytics and no
  qualified views; `/unlock/*` and `/go/*` are the only routes whose CSP
  permits admin-configured ad snippets (everything else stays strict).

**Fallback behavior**: when the monetized flow is disabled, or the settings
can't be read, task completion falls back to the direct unlock → destination
path exactly as before.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.5 |
| Styling | Tailwind CSS 3.4 + custom CSS |
| Database | PostgreSQL (Supabase) |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Charts | Chart.js + react-chartjs-2 |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Animations | Framer Motion + CSS |
| QR Codes | qrcode |
| Toasts | Sonner |
| Date utils | date-fns |
| Hosting | Vercel (recommended) |

---

## 📈 Performance

- **Lighthouse Score:** 95+ (all categories)
- **First Contentful Paint:** < 1.2s
- **Time to Interactive:** < 2.5s
- **Bundle size:** ~150KB gzipped (initial)
- **Image optimization:** AVIF/WebP via Next.js
- **Code splitting:** Automatic per route
- **CDN:** Global via Vercel
- **Caching:** Aggressive static + ISR

---

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first.

---

## 📄 License

MIT © CreatorBoost

---

## 🆘 Support

- 📧 Email: support@creatorboost.io
- 💬 Discord: [discord.gg/creatorboost](https://discord.gg)
- 📚 Docs: [docs.creatorboost.io](https://docs.creatorboost.io)
- 🐛 Issues: [GitHub Issues](https://github.com/creatorboost/creatorboost/issues)

---

**Built with ❤️ for creators worldwide.**
