# Deployment Guide

This is a step-by-step guide to deploy CreatorBoost to production.

## 1. Supabase Setup

### 1.1 Create project
1. Go to [supabase.com](https://supabase.com) → New project
2. Choose a strong database password
3. Pick a region close to your users

### 1.2 Run migrations
```bash
# Install Supabase CLI
brew install supabase/tap/supabase  # macOS
# or scoop install supabase         # Windows
# or: npm install -g supabase

# Login
supabase login

# Link to project (find ref in project settings)
supabase link --project-ref your-ref-here

# Apply schema
supabase db push
```

### 1.3 Deploy Edge Function (fraud detection)
```bash
supabase functions deploy fraud-check
supabase secrets set IPQUALITYSCORE_KEY=your-key-here
```

Get a free IPQualityScore key at [ipqualityscore.com](https://www.ipqualityscore.com).

### 1.4 Configure Auth
In Supabase dashboard → Authentication → URL Configuration:
- Site URL: `https://yourdomain.com`
- Redirect URLs:
  - `https://yourdomain.com/auth/callback`
  - `https://yourdomain.com/dashboard`

Enable Google OAuth:
- Authentication → Providers → Google
- Add OAuth client ID & secret from Google Cloud Console

Enable Email confirmations: Authentication → Email Templates (optional)

## 2. Vercel Deployment

### 2.1 Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/creatorboost.git
git push -u origin main
```

### 2.2 Import on Vercel
1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repo
3. Add environment variables (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — server-side only, never exposed to the browser
   - `NEXT_PUBLIC_SITE_URL` = `https://yourdomain.com`
   - `NEXT_PUBLIC_SUPPORT_EMAIL` (optional)
   - `SUPPORT_EMAIL_WEBHOOK_URL` (optional)
   - `CRON_SECRET` (required for the earnings-release cron)
   - `IP_GEO_PROVIDER` / `IP_GEO_SERVICE_URL` / `IP_GEO_SERVICE_TOKEN` (optional, server-side country lookup — see `.env.example`)
   - `RESEND_API_KEY` / `EMAIL_FROM` / `SUPPORT_EMAIL` (optional, transactional email)
   - `SUPABASE_FRAUD_FN_ENABLED=true` (optional, enables the `fraud-check` edge function)
   - `ADSTERRA_API_URL` / `MONETAG_API_URL` (optional, real ad-revenue integration)
4. Deploy

### 2.2.1 Apply database migrations
The repo ships migrations `0001`–`0007`. Apply them in order to a fresh
Supabase project (this brings schema, RLS, RPCs, the earnings lifecycle,
withdrawal fees, anonymous support tickets and the revenue ledger into
alignment):

```bash
supabase link --project-ref YOUR_REF
supabase db push
```

Optionally deploy the fraud edge function:
```bash
supabase functions deploy fraud-check
supabase secrets set IPQUALITYSCORE_KEY=your-key
```

### 2.2.2 Scheduled earnings release (cron)
Matured pending earnings are released into creators' available balance by
`POST /api/cron/release-earnings`. Configure a scheduler (Vercel Cron /
GitHub Actions) to call it with the `x-cron-secret` header set to `CRON_SECRET`
(e.g. every hour).

### 2.3 Custom domain
1. Vercel → Settings → Domains → Add your domain
2. Update Supabase auth redirect URLs to use your domain

## 3. Post-deployment

### 3.1 Create first admin
After signing up at your domain, run this SQL in Supabase:
```sql
UPDATE profiles SET role = 'super_admin' WHERE email = 'you@example.com';
```

### 3.2 Configure initial settings
1. Sign in as admin
2. Go to `/admin/settings`
3. Set:
   - Site name
   - Support email
   - Min withdrawal
   - Referral %
4. Go to `/admin/cpm`
5. Review default CPM rates per country (already seeded)
6. Adjust as needed

### 3.3 Activate ad networks
Go to `/admin/ads` and configure each network's API credentials.

### 3.4 Test
- Create a campaign as a creator
- Visit the public unlock URL
- Complete tasks → unlock
- Verify earnings appear
- Test withdrawal flow

## 4. Production checklist

- [ ] Custom domain configured
- [ ] SSL auto-enabled (Vercel default)
- [ ] Supabase daily backups enabled
- [ ] Email SMTP configured (Resend, SendGrid)
- [ ] Real IPQualityScore key added
- [ ] Admin user created and promoted
- [ ] All CPM rates reviewed
- [ ] Test withdrawal flow end-to-end
- [ ] Test signup + email confirmation
- [ ] Google OAuth tested
- [ ] Mobile responsive check
- [ ] Lighthouse score > 95
- [ ] SEO meta tags verified
- [ ] sitemap.xml accessible
- [ ] robots.txt accessible
- [ ] Sentry error tracking
- [ ] PostHog or GA4 analytics
- [ ] Uptime monitoring (Betterstack, etc.)

## 5. Scaling

### Database
- Supabase handles ~10K concurrent users out of the box
- For more, enable connection pooling (PgBouncer in Supabase)
- Add read replicas for analytics queries

### Caching
- Vercel Edge Cache for static pages
- Upstash Redis for rate limiting (replace in-memory limiter)
- ISR for campaign pages

### Background jobs
- Supabase Edge Functions or Inngest for:
  - Weekly balance release (pending → available)
  - Email digests
  - Analytics aggregation
  - Anti-fraud ML model training

### Cost estimates (10K MAU)
- Vercel Pro: $20/mo
- Supabase Pro: $25/mo
- Resend: $20/mo (50K emails)
- IPQualityScore: $50/mo (50K lookups)
- **Total: ~$115/mo** to serve 10,000 active users

## 6. Monitoring

Add to your stack:
- **Sentry** for error tracking
- **PostHog** for product analytics
- **LogRocket** for session replay
- **Betterstack** for uptime monitoring
- **Grafana** for metrics dashboards

---

**Need help?** Open an issue or contact support@creatorboost.io.
