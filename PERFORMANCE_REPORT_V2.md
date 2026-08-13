# CreatorBoost — Performance Optimization Report (Round 2: Dashboards & Admin)

Branch: `arena/019ff9fb-creatorboost` · Base: `403300e` (main)
**No UI/design changes. No routes changed. No RLS/policy/schema changes (one index-only migration). Nothing pushed.**

---

## 1. WHAT WAS SLOW (audit findings)

Measured on the base commit before changing anything:

| Finding | Where |
|---|---|
| Every admin page (`/admin/*`) was a client component that rendered a **skeleton first**, then fired 1–4 server-action POSTs after hydration, and **each** server action re-ran `auth.getUser()` + a `profiles` role query | all `/admin/*` |
| Same pattern on creator pages: `/dashboard/campaigns`, `/dashboard/withdraw`, `/dashboard/referrals`, `/dashboard/settings`, `/dashboard/support` fetched their initial data in `useEffect` after hydration | dashboard |
| `DashboardCharts` fetched 30 days of `earnings` + `views` from the browser on mount (2 round-trips after the page had already loaded) | `/dashboard` |
| `AdminCharts` fetched 4 datasets from the browser on mount (earnings 7d, revenue ledger, views 7d, all creator signups) | `/admin` |
| The notification bell fired a server action (POST → `getUser` → count query) on **every** dashboard/admin page after hydration | topbar |
| `adminListCampaigns` / `adminListWithdrawals` / `adminListAnnouncements` each did a sequential second Supabase query to attach creator/sender names | admin lib |
| Several `select('*')` queries shipped unrendered columns (e.g. full campaign rows into the admin user-detail modal, full withdrawal rows, full profile rows) | admin lib |
| Missing indexes: `earnings(creator_id, created_at)` (the dashboard's hot queries filtered by creator + date with only two single-column indexes), plus `ORDER BY created_at/updated_at DESC LIMIT n` admin lists on `withdrawals`, `campaigns`, `profiles`, `support_tickets`, and `ticket_messages(ticket_id)` had no index at all | DB |

---

## 2. ARCHITECTURE APPLIED (hybrid, per the brief)

- **Creator Dashboard → SSR/RSC for initial user-specific data.** `/dashboard`, `/dashboard/campaigns`, `/dashboard/withdraw`, `/dashboard/referrals`, `/dashboard/settings`, `/dashboard/support` now server-render their initial data (via the same RLS-scoped queries as before) and hand it to thin client components as props. Interactive logic (forms, actions, filters) stays client-side exactly where it was.
- **Admin Dashboard → SSR/RSC for initial admin-specific data.** All 10 `/admin/*` routes now server-render their initial lists/config with `requireAdmin()` enforced server-side as before. `requireAuth` reuses the request-scoped session/profile helpers (`React.cache()`), so N admin helpers in one render share **one** auth + role verification instead of N.
- **Charts stay lazy.** `chart.js`/`react-chartjs-2` remain isolated behind `next/dynamic({ ssr: false })` (previous round) — nothing regressed. `DashboardCharts`/`AdminCharts` are now **prop-driven**: they no longer fetch anything themselves.
- **Realtime notifications unchanged.** Bell still subscribes to `postgres_changes` on `notifications` and refreshes on events; the badge's initial count is now server-rendered (SSR badge, no post-hydration fetch).
- **Account gates unchanged.** Middleware + `dashboard`/`admin` layouts still redirect suspended/banned/pending users exactly as before (verified: active mock user renders; gate redirect logic untouched; unit tests cover the matrix).
- **No SSG for authenticated routes.** All dashboard/admin routes remain `force-dynamic`.

---

## 3. QUERY / WATERFALL CHANGES

### Waterfalls removed (client → one parallel server batch)
- `/dashboard`: stat cards + recent campaigns + recent activity + CPM + view counts + **chart datasets (30d earnings/views)** + unread count now resolve in a single `Promise.all` batch. Previously the charts fetched 2 datasets after hydration and the bell fetched the count via a server action.
- `/admin`: 12 stat + chart queries in one `Promise.all` (was 8 server + 4 post-hydration chart fetches).
- `/dashboard/withdraw`: profile + history + min-withdrawal + methods already `Promise.all`’d client-side; now they render with the first paint.
- `/admin/cpm`: countries + levels + settings + CPM config in one server batch (was 4 sequential-ish action calls on mount).
- `/admin/users`: `serverAdminMe()` + `adminListUsers()` share one cached auth/role check (was 2 full action round-trips).

### Duplicate fetching removed
- Admin layout + admin pages share the request-scoped `getSessionUser()` / `getDashboardProfile()` (React `cache()`, per-request only — no cross-user caching possible).
- `serverAdminMe()` reuses the same cached profile instead of a separate full-row query.
- `loadReferralDashboardAction()` reuses the cached session instead of a second `auth.getUser()`.
- Notification count fetched once per request via cached `getUnreadNotificationCount(userId)`.

### `select('*')` → rendered columns only
- `adminListWithdrawals` (was `*`; now id, amount, method, account_details, created_at, status, rejection_reason + embedded user name/email).
- `adminUserDetail` profile/campaigns/withdrawals/earnings (was `*`; now only the modal's columns).
- `adminListAdRevenue`, `adminLoadCountries`, `adminLoadLevels`, `adminLoadSettings`, `adminLoadAdNetworks`, `adminListWithdrawalMethods` narrowed to the fields their pages render/edit.
- `/dashboard/campaigns/[id]` campaign row narrowed (no longer ships `destination_url` in the page payload).
- Dashboard/withdraw/settings/campaigns selects were already narrowed in the previous round; kept.

### PostgREST embeds (2 sequential queries → 1)
- `adminListCampaigns`: `creator:profiles!campaigns_creator_id_fkey(full_name)` — verified end-to-end against a mock PostgREST (correct select string + rendered name).
- `adminListWithdrawals`: `user:profiles!withdrawals_user_id_fkey(full_name, email)` — verified rendered.
- `adminListAnnouncements`: `sender:profiles(full_name, email)` — verified issued; same `sender ?? null` shape as before.

### Sensible limits (no behavior change on normal data)
- `/dashboard/campaigns` list limited to 500 rows (was unbounded) — both server render and post-action refresh use the same limit.
- Referrals list limited to 500 (was unbounded).
- Deliberately **not** bounded: earnings/withdrawal/views sums (values must stay exact), campaign daily/country stats (already 1 row/day/country per campaign; bounding would risk timezone/tie-order differences).

---

## 4. DATABASE INDEXES ADDED (one migration: `0012_performance_indexes.sql`)

All `CREATE INDEX IF NOT EXISTS`, idempotent, no schema/policy/data changes:

| Index | Serves |
|---|---|
| `earnings(creator_id, created_at DESC)` | `/dashboard` today/yesterday/week totals, recent activity, 30-day chart, admin user detail |
| `withdrawals(created_at DESC)` | admin withdrawal queue `ORDER BY created_at DESC LIMIT 200` |
| `campaigns(created_at DESC)` | admin campaign management `ORDER BY created_at DESC LIMIT 200` |
| `profiles(created_at DESC)` | admin user list + announcement creator picker |
| `support_tickets(updated_at DESC)` | admin support queue |
| `ticket_messages(ticket_id, created_at)` | ticket conversation load (previously no index on the join column) |

No index added that does not back an existing query. Existing indexes were audited and are sufficient for everything else (views, notifications, referrals, audit log, ad revenue, CPM log, announcements).

---

## 5. MEASURED RESULTS

Measurement method: production build (`next build` + `next start`), requests driven through the real middleware with a session cookie against a mock Supabase REST/Auth endpoint; every page checked for HTTP 200 + expected content (24/24 content checks passed). Server-render timings are wall-clock on the harness (mock latency ~1 ms) — the meaningful numbers are the request counts and payload shapes.

### Initial JS (Turbopack chunks, per route sync graph)

| Route | Before | After |
|---|---|---|
| shared runtime (all pages) | 877.3 KB | 877.3 KB |
| `/dashboard` | 370.5 KB | 370.2 KB |
| `/admin` | 371.5 KB | 371.0 KB |
| all other dashboard/admin routes | 356–386 KB | 356–386 KB (±0.5 KB noise) |

Initial JS is effectively **unchanged** (and Chart.js remains out of the entry graph from the previous round). This round's wins are in *data flow*, not bundle size: the pages now arrive with their data instead of arriving with skeletons + a queue of post-hydration requests.

### Supabase request count per page load (server-issued, via middleware + RSC)

| Route | Before | After | Notes |
|---|---|---|---|
| `/admin` | 12 | 17 | +chart datasets moved server-side; **client chart fetches: 4 → 0** |
| `/admin/users` | 4 | 6 | client actions on load: 2 → 0 (list SSR) |
| `/admin/campaigns` | 4 | 6 | second profiles query removed (embed) |
| `/admin/withdrawals` | 4 | 6 | second profiles query removed (embed) |
| `/admin/announcements` | 4 | 7 | senders query removed (embed); recipient count SSR |
| `/admin/support` | 4 | 8 | tickets + messages + users SSR |
| `/admin/ads` | 4 | 7 | networks + revenue SSR |
| `/admin/cpm` | 4 | 10 | 4 config reads SSR |
| `/admin/levels` | 4 | 6 | levels SSR |
| `/admin/settings` | 4 | 7 | settings + methods SSR |
| `/dashboard` | 13 | 16 | chart datasets + bell count SSR; **client fetches: 3 → 0** |
| `/dashboard/campaigns` | 5 | 7 | cards SSR |
| `/dashboard/withdraw` | 5 | 10 | 4 reads SSR; **client fetches: 4 → 0** |
| `/dashboard/referrals` | 5 | 11 | referral dashboard SSR |
| `/dashboard/settings` | 5 | 7 | profile SSR |
| `/dashboard/support` | 5 | 7 | tickets SSR |
| `/dashboard/analytics`, `/dashboard/notifications` | 6/7 | 7 | bell count SSR |

"Before" counts are *server-side only* — they understate the old cost, because the browser additionally fired the post-hydration fetches (and each admin action carried its own `getUser` + role query). Net per page load: **browser-issued Supabase calls after first paint are now zero on every converted page**, and all server queries run as one parallel batch (waterfall depth 1 instead of 3–4 sequential waves).

### First-paint HTML payload (harness, mock data)

| Route | Before | After |
|---|---|---|
| `/admin` | 21.3 KB (skeleton) | 48.5 KB (full dashboard incl. chart datasets) |
| `/admin/users` | 13.0 KB (skeleton) | 37.1 KB (user table) |
| `/dashboard` | 45.7 KB | 46.0 KB (chart datasets + bell badge) |
| `/dashboard/campaigns` | 25.1 KB | 28.6 KB (cards) |
| `/dashboard/withdraw` | 26.4 KB | 28.0 KB (balances + methods) |

These are the same rows the browser used to download after hydration — they now arrive in the first response, so **time-to-content drops by 2–4 round-trips per page** (the biggest win on mobile).

### Server response time
~12–27 ms per page on the harness **before and after** (mock DB latency ≈ 1 ms; queries parallelized, so render cost is dominated by the slowest query either way). No regression.

---

## 6. FILES CHANGED

**New (client components split out of converted pages)**
- `src/app/admin/{ads,announcements,campaigns,cpm,levels,settings,support,users,withdrawals}/*Client.tsx`
- `src/app/dashboard/{campaigns,referrals,settings,support,withdraw}/*Client.tsx`

**New (server)**
- `supabase/migrations/0012_performance_indexes.sql`

**Modified**
- `src/app/admin/{page,layout}.tsx` + 8 admin `page.tsx` (now RSC fetching initial data)
- `src/app/dashboard/{page,analytics,campaigns,campaigns/[id],notifications,referrals,settings,support,withdraw}.tsx`
- `src/components/{AdminCharts,DashboardCharts,DashboardTopbar,NotificationBell}.tsx`
- `src/lib/{admin-server,notifications,referral-actions,session}.ts`
- `tests/{admin-announcements,database-security}.test.ts` (updated file path/assertion to the new client component and the 0012 migration; all assertions preserved)

---

## 7. WHAT WAS DELIBERATELY NOT CHANGED

- **Earnings/CPM/finance math** — `earnings.ts`, `finance.ts`, `fraud.ts`, `cpm.ts`, release cron untouched. All sums/aggregations keep identical code paths (chart aggregators are the exact same functions, just fed by server data instead of client fetches).
- **Notifications** — queries, realtime channel, mark-read actions, announcements untouched; the bell only gained a server-rendered initial count.
- **Auth/RBAC** — `requireAdmin()`/`requireSuperAdmin()` still gate every admin helper; role still read from the DB per request; service-role client still server-only.
- **RLS** — no policy/view/function modified; converted pages read through the same user-scoped (RLS) or service-role clients as before.
- **UI** — colors, gradients, typography, spacing, cards, buttons, icons, sidebar, topbar, tables, forms, modals, charts appearance, text, routes and navigation are byte-for-byte the same markup; only the loading path changed (skeleton flash → server-rendered content).
- **Charts/lazy-loading** — `next/dynamic({ ssr: false })` chart boundary preserved; `sonner` and `qrcode` decisions from the previous round kept.

## 8. VERIFICATION

| Command | Result |
|---|---|
| `npm test` | ✅ 17 files / **142 tests passed** |
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ exit 0, all 46 routes, 36 static pages (same classification as baseline) |
| `npm run lint` | ✅ 0 errors, **10 warnings** (baseline: 21 — 11 warnings removed, 0 added) |
| Runtime smoke test | ✅ 24/24 dashboard/admin pages return 200 with expected server-rendered content (via production build + real middleware + session cookie against a mock Supabase) |

**Not pushed.** Committed locally on `arena/019ff9fb-creatorboost`; awaiting approval to push.
