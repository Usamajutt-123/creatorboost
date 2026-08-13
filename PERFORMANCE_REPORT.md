# CreatorBoost — Performance Optimization Report

Branch: `arena/019ff9a4-creatorboost` · Base: `8dfbdc5` · Commit: `e01fe7f`
No UI, design, feature, flow, schema, or RLS changes. No migrations created.

---

## PERFORMANCE IMPROVEMENTS

### 1. Chart.js was in the initial JS bundle of every page
**What was slow.** `HeroChart`, `DashboardPreview`, `AdminPreview`, `DashboardCharts`, `AnalyticsCharts` and `AdminCharts` each imported `chart.js` + `react-chartjs-2` statically. Because the homepage renders three of those components, Chart.js (~171 KB minified) was part of the entry graph on `/` and pulled in before anything could become interactive — on mobile that is the single biggest parse/compile cost on the landing page.

**Why.** A static `import` from a Client Component puts the library in the route's initial chunk set, whether or not the chart is above the fold.

**Fix (smallest safe).** Added `src/components/charts/ChartKit.tsx` (one place that registers the Chart.js controllers, previously duplicated in six files) and `src/components/charts/LazyChart.tsx`, which re-exports the six chart components through `next/dynamic(..., { ssr: false })`. Every existing import path was repointed; no component's props, markup, options, colors, or container heights changed.

**Result.** Chart.js is now isolated in its own chunk (`0pz97kl14_rk8.js`, 171.6 KB) that **no prerendered page references in a `<script src>`** — it is fetched only when a chart actually mounts.

| Route | Initial JS before | after | change |
|---|---|---|---|
| `/` (homepage) | 829.9 KB | **654.2 KB** | **−175.7 KB (−21 %)** |
| `/login` | 877.3 KB | 877.3 KB | — |
| `/about` | 615.5 KB | 615.5 KB | — |

Chart containers already have fixed heights (`h-44 sm:h-48` … `h-64 sm:h-72`), so deferring the canvas causes **no layout shift (CLS)**.

### 2. Duplicate auth + profile round-trips on every dashboard render
**What was slow.** `dashboard/layout.tsx` and `dashboard/page.tsx` each called `supabase.auth.getUser()` and then separately queried `profiles`, so one dashboard navigation cost 2 auth verifications and 2 profile reads — all sequential and all on the server's critical path.

**Fix.** Added `src/lib/session.ts` with request-scoped `cache()`-wrapped `getSessionUser()` / `getSessionProfile()` helpers. The layout and page now share one resolved session and one profile row, and the page passes `userId` / `fullName` down as props instead of refetching.

**Result.** ~2 fewer Supabase round-trips per dashboard render; TTFB improves by roughly one network RTT to Supabase.

### 3. Sequential Supabase waterfalls
- **`dashboard/withdraw`** ran 4 dependent-looking but actually independent queries back-to-back (profile → withdrawals → platform settings → withdrawal methods). Now a single `Promise.all` — wall time drops from the sum of 4 round-trips to the slowest one. The post-submit refresh (2 queries) was parallelized the same way.
- **`dashboard/analytics`** aggregated 30 days of `views` on the server and then `AnalyticsCharts` refetched the same rows from the browser. The client component is now prop-driven off the server aggregate — one dataset, fetched once, no client fetch on mount.
- **`/c/[slug]`** (highest-traffic public route) called `loadPublicCampaign` once in `generateMetadata` and once in the page body — two identical Supabase lookups per visit. Wrapped in React `cache()`, so it is one lookup per request. Request-scoped only, so campaign edits still appear on the very next request.

### 4. `SELECT *` on hot paths
Replaced with explicit column lists on the pages that were pulling entire rows:
- `dashboard/campaigns` — 8 columns instead of the full campaign row.
- `dashboard/withdraw` — `id, available_balance, pending_earnings` for the profile and `id, amount, method, status, created_at` for history.
- `dashboard/settings` — only the 8 fields the form renders (notably stops sending balances, referral data and admin fields to the browser — a small security win too).
- `AdminCharts` — the `ad_revenue_imports` read is now bounded with `.gte('revenue_date', …)` instead of scanning the whole table.

`account/guard.ts` still uses `select('*')` **deliberately**: it probes for optional `*_reason` columns that may exist in a drifted production schema, and narrowing the select could silently change the reason text shown on the suspended/banned pages.

### 5. Client JS trimmed
- **`qrcode`** was statically imported by `dashboard/tools` even though it is only needed when the user clicks "Generate". Now `await import('qrcode')` inside the handler.
- **Removed 5 genuinely unused dependencies** (verified by grepping `src/` *and* `tests/`): `react-hot-toast`, `next-themes`, `react-hook-form`, `@hookform/resolvers`, `nanoid`. `react-icons` **is** used and was kept — it was also missing from `optimizePackageImports`, so it was added there (`recharts`, which is not installed, was removed from that list).
- **`NotificationBell`** now receives `userId` from the server instead of resolving it client-side, removing an auth round-trip from the topbar on every dashboard page.

### 6. Static assets
- Deleted 4 unreferenced PNGs shipped in `public/`: `bbb.png` (1.05 MB), `1.png` (998 KB), `122.png` (22 KB), `favicon121.png` (11 KB) — **~2.1 MB** removed from the deployment.
- Losslessly recompressed `favicon.png` (219.8→157.0 KB), `og.png` (702.7→680.1 KB), `logo.png` (59.9→44.7 KB). Verified pixel-identical (`compare -metric AE` = 0) at identical dimensions.

**Total `public/` is now 928 KB, down from ~3.1 MB.**

### Considered and deliberately rejected
- **Lazy-loading `sonner`** (42.8 KB on every route). Rejected: the `toast` singleton and `<Toaster>` live in the same module, and four pages fire `toast.error(...)` from a mount effect (`auth/reset`, `admin/announcements`, `EditCampaignForm`, `dashboard/referrals`). Deferring the Toaster risks the store not being subscribed when the first toast fires — silently dropped error messages. Not worth 42 KB.
- **`next/image` for the 3 remote campaign images.** Rejected for now: they are user-supplied Supabase Storage URLs on `force-dynamic` pages, and routing them through the optimizer changes the emitted `<img>` attributes (`srcset`, `sizes`, `loading`) — i.e. a markup change on the public unlock page, plus optimizer cost/latency on a route that must stay fast. The other 5 `<img>` uses are blob/data URLs and cannot use `next/image` at all.
- **New indexes / migrations.** Audited all 11 migrations: every query touched here is already covered by an existing index (`views(creator+created)`, `notifications(user_id,read,created_at DESC)`, `ad_revenue_imports(revenue_date DESC)`, `campaigns(creator+deleted)`, etc.). **No migration was needed and none was created.**
- **Font optimization.** `globals.css` already uses system font stacks — no web fonts to optimize.
- **Caching public pages.** Left as `force-dynamic`. All 12 dynamic routes serve private user, campaign, or financial data; adding revalidation would risk cross-user cache bleed.

---

## UI

**Unchanged.** Verified mechanically, not by eye: the 13 prerendered pages from the baseline build were snapshotted, then compared against the post-optimization build with a normalizer that strips build-hash filenames.

- **12 of 13 pages are byte-identical** after normalization.
- `index.html` differs only by React's dynamic-import boundary markers — `<!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>` … `<!--/$-->` — wrapped around each of the 5 chart canvases. The canvases themselves are unchanged (`<canvas role="img" height="150" width="300">`). These are HTML comments and an empty `<template>`; neither renders.

No changes to colors, gradients, typography, spacing, borders, cards, icons, animations, layout, or responsive behavior. Existing markup quirks were preserved deliberately (the nested div in `DashboardPreview`, the stray `x` in `AdminPreview`, the two "Valid" columns in the campaigns table, `<Footer/ >` in `page.tsx`). No loading spinner was added anywhere.

---

## FUNCTIONALITY

All flows preserved; **all 46 routes build with identical static/dynamic classification** (36 static, 10 dynamic + 4 API routes + middleware).

- **Campaigns** — create/edit/delete server actions untouched; list page renders the same 8 fields it always displayed.
- **Public campaign links (`/c/[slug]`)** — same `loadPublicCampaign` logic, same `public_campaigns` view read with the same service-role fallback re-applying `status='active'` + `deleted_at IS NULL` + expiry. Only the number of times it runs per request changed (2 → 1). Canonical `/c/{slug}`, OG and Twitter metadata unchanged.
- **Unlock → destination** — `verifyUnlockToken` gate, HttpOnly cookie issuance in `/api/views/record`, and `isValidHttpUrl` validation untouched.
- **CPM / earnings** — `earnings.ts`, `finance.ts`, `fraud.ts` and the release-earnings cron were not modified.
- **Notifications** — same queries and realtime channel; the bell just receives `userId` as a prop instead of re-deriving it.
- **Admin** — `admin-server.ts` (role hierarchy, audit log, service-role writes) untouched; the admin dashboard's 8-query `Promise.all` was already optimal.
- **Auth** — middleware, `updateSession`, and `resolveAccountGate` untouched; suspended/banned/pending gating behaves exactly as before.

---

## SECURITY

- **RLS untouched.** No policy, view, function, or migration was modified.
- **No new exposure.** `destination_url` is still never selected on any public path. Earnings, CPM config, and admin data remain behind server-only reads.
- **Reduced** exposure: `dashboard/settings` no longer ships the full profile row (balances, referral fields, role) to the browser.
- Service-role client (`createAdminClient`) remains server-only; no key, secret, or protected check moved client-side.
- No server-side check was replaced with a client-side one. `cache()` is request-scoped in-memory memoization — it is not a shared or persistent cache and cannot leak data across users or requests.

---

## TEST RESULTS

| Command | Result |
|---|---|
| `npm test` | ✅ **17 files, 142 tests passed** (3.54 s) |
| `npx tsc --noEmit` | ✅ **clean**, no errors |
| `npm run build` | ✅ **exit 0**, all 46 routes, 36 static pages |
| `npm run lint` | ✅ **0 errors, 21 warnings** — identical to the pre-change baseline (verified by stashing changes and re-running); no new warnings introduced |

**Build output analysis.** Turbopack does not print a First Load JS table, so bundles were measured by parsing `<script src>` out of the prerendered HTML. Remaining largest chunks on the heaviest route (`/login`, 877.3 KB): Supabase auth 245.8 KB, react-dom 223.5 KB, Next app-router runtime 129.4 KB, legacy polyfills 110.0 KB (served with `noModule` — **not downloaded by modern browsers**), sonner 42.8 KB, lucide 35.5 + 16.1 KB. These are framework/vendor floors, not application waterfalls. Total `.next/static` JS is flat (1.604 MB → 1.614 MB) by design: Chart.js was **moved out of the entry graph**, not deleted, at the cost of a little lazy-chunk overhead — the win is in what each route downloads up front, not in total bytes on disk.

---

## FILES CHANGED

**New**
| File | Reason |
|---|---|
| `src/components/charts/ChartKit.tsx` | Single Chart.js registration point (was duplicated in 6 files). |
| `src/components/charts/LazyChart.tsx` | `next/dynamic({ ssr: false })` wrappers so Chart.js leaves the initial bundle. |
| `src/lib/session.ts` | Request-scoped `cache()` helpers for user + profile, to stop duplicate auth/profile fetches. |

**Modified**
| File | Reason |
|---|---|
| `next.config.js` | `optimizePackageImports`: dropped uninstalled `recharts`, added the actually-used `react-icons`. |
| `package.json` / `package-lock.json` | Removed 5 unused deps (`react-hot-toast`, `next-themes`, `react-hook-form`, `@hookform/resolvers`, `nanoid`). |
| `src/app/layout.tsx` | *(unchanged — listed only to note the sonner Toaster was deliberately left eager.)* |
| `src/app/dashboard/layout.tsx` | Uses shared session/profile instead of its own auth + profile queries. |
| `src/app/dashboard/page.tsx` | Same; passes `userId`/`fullName` to children rather than refetching. |
| `src/app/dashboard/analytics/page.tsx` | Passes the server-side 30-day aggregate to the chart as props. |
| `src/app/dashboard/campaigns/page.tsx` | `select('*')` → explicit 8 columns. |
| `src/app/dashboard/settings/page.tsx` | `select('*')` → the 8 fields the form uses. |
| `src/app/dashboard/withdraw/page.tsx` | 4 sequential queries → one `Promise.all`; explicit columns; refresh parallelized. |
| `src/app/dashboard/notifications/page.tsx` | Reuses the shared session; passes `userId` to the topbar. |
| `src/app/dashboard/tools/page.tsx` | `qrcode` dynamically imported inside the click handler. |
| `src/app/admin/layout.tsx` | Passes `userId` to the topbar so the bell need not re-auth. |
| `src/app/c/[slug]/page.tsx` | `cache()` around the campaign lookup — 2 queries → 1 per request. |
| `src/components/HeroChart.tsx` | Uses shared `ChartKit`; local registration removed. |
| `src/components/DashboardPreview.tsx` | Same. |
| `src/components/AdminPreview.tsx` | Same. |
| `src/components/DashboardCharts.tsx` | Same; data now arrives as props. |
| `src/components/AnalyticsCharts.tsx` | Same; removed the duplicate client-side fetch. |
| `src/components/AdminCharts.tsx` | Same; bounded the `ad_revenue_imports` scan with `.gte('revenue_date', …)`. |
| `src/components/DashboardTopbar.tsx` | Accepts and forwards `userId`. |
| `src/components/NotificationBell.tsx` | Accepts `userId` as a prop instead of an auth round-trip. |
| `public/favicon.png`, `public/og.png`, `public/logo.png` | Lossless recompression (pixel-identical, same dimensions). |

**Deleted**
| File | Reason |
|---|---|
| `public/bbb.png`, `public/1.png`, `public/122.png`, `public/favicon121.png` | Unreferenced anywhere in `src/`, `public/sw.js` or the manifest — ~2.1 MB of dead weight. |

---

Nothing was pushed or deployed. The work is committed locally as `e01fe7f` on `arena/019ff9a4-creatorboost`.
