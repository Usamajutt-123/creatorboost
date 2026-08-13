# CreatorBoost — Mobile Performance Optimization (Round 3)

Branch: `arena/019ffa40-creatorboost` · Base: `0f22c29` (main)

**Scope rule respected: no UI/design change, no business-logic change, no auth/RBAC change, no CPM/earnings/finance change, no campaign/notification/announcement behaviour change, no RLS/schema change, no dependency added or removed. Nothing pushed.**

---

## STEP 1 — BASELINE PROFILE (measured before any change)

### How it was measured

Real Lighthouse (v12, `formFactor: mobile`, Moto G Power UA, **4× CPU slowdown + Slow 4G** — the standard LH mobile throttling profile) driven by headless Chromium 149 against a **production build** (`next build` + `next start`).

Because `/dashboard` and `/admin` are authenticated SSR routes, the harness signs in through the real login form first and Lighthouse then runs with `disableStorageReset`, so the measured navigation is a genuine authenticated initial page load. Supabase (GoTrue + PostgREST + Realtime WS) is served by a local mock behind a same-origin reverse proxy, so the app's real CSP (`connect-src 'self'`) is untouched. Dataset: 2,400 earnings rows / 6,000 view rows / 24 campaigns / 200 profiles — i.e. a realistically busy account.

3 runs per route, median reported.

### Baseline numbers

| Metric | `/dashboard` | `/admin` |
|---|---|---|
| **Performance** | **89** | **88** |
| FCP | 1030 ms | 924 ms |
| LCP | 1136 ms | 1087 ms |
| TBT | **462 ms** | **490 ms** |
| CLS | 0 | 0 |
| Speed Index | 1146 ms | 1009 ms |
| JS execution (`bootup-time`) | 1287 ms | 1260 ms |
| Main-thread work | 2734 ms | 2226 ms |
| Long tasks | **13** | **10** |

These reproduce the reported Lighthouse profile (TBT 450 ms, 13 long tasks, main-thread work ~5 s, JS execution ~2.6 s — the absolute ms differ because the reference run used a slower CPU multiplier, but the *shape* and the ranking of the bottlenecks are the same).

### 1a. Largest JavaScript chunks (Turbopack production output)

| Chunk | Raw size | What it is | On `/dashboard`? |
|---|---|---|---|
| `2tcxvjki4doiu.js` | **245.7 KB** | `@supabase/ssr` + `supabase-js` (GoTrue auth, PostgREST, **Realtime/phoenix**) | ✅ initial graph |
| `0pz97kl14_rk8.js` | 171.6 KB | `chart.js` + `react-chartjs-2` | ✅ (lazy chunk, but fetched during hydration) |
| `2-2x8-mvontrd.js` | 223.5 KB | `react-dom` client + Next polyfills | ✅ framework |
| `2mzqkt38aupor.js` | 129.4 KB | Next app-router client runtime | ✅ framework |
| `4418mm9y4urn4.js` | 42.8 KB | Next boundary components + `sonner` Toaster | ✅ root layout |
| `28ofp02s_lwab.js` | 35.5 KB | **`Navbar` + `Footer`** | ✅ — **but they are never rendered on `/dashboard`** |
| `0ov0i-0g6j1-a.js` | 26.2 KB | Dashboard sidebar / topbar / lucide icons | ✅ |
| `0cz1d0mv5g_q7.js` | 112.6 KB | Next legacy polyfill bundle (`nomodule`) | not executed on modern Chrome |

Shared runtime across all pages: **537 KB**. `/dashboard` client chunks: **370.2 KB**. `/admin`: **371.0 KB**.

### 1b. Largest client components (hydration cost)

| Component | Why it is expensive |
|---|---|
| **`DashboardCharts`** | Client component that receives **6,000 raw view rows + 2,400 raw earnings rows as props** (see 1e — this is the single biggest problem on the page) |
| **`AdminCharts`** | Same pattern: raw view rows (incl. an unused `created_at` column), raw earnings rows, raw creator rows |
| **`NotificationBell`** | Pulls the entire 245 KB Supabase client into the *critical* hydration path just to open a realtime channel |
| **`DashboardTopbar` / `DashboardSidebar` / `AdminSidebar`** | Each statically imports the Supabase browser client **only for the logout button's click handler** |
| **`AdminSidebar`** | Fires a `serverAdminMe()` server-action POST in a mount effect, and is **rendered twice per admin page** (desktop + mobile drawer) → 2 POSTs + 2 extra render passes |
| **`AnalyticsCharts`** | Aggregates in `useEffect` and then calls `setState` twice → a guaranteed double render after mount |

### 1c. Heavy dependencies reaching `/dashboard` and `/admin`

| Dependency | Size | Verdict |
|---|---|---|
| `@supabase/ssr` + `@supabase/supabase-js` | 245.7 KB | **In the initial graph, but nothing needs it before first paint.** Auth data is already SSR'd; the only client uses are (a) the logout click handler and (b) the notification realtime channel. |
| `chart.js` + `react-chartjs-2` | 171.6 KB | Already isolated behind `next/dynamic({ssr:false})` ✅ — but the chunk is still requested *during hydration*, and charts are below the fold on mobile. |
| `lucide-react`, `react-icons` | small | Already tree-shaken via `optimizePackageImports`. |
| `sonner` | ~14 KB | Root-layout `<Toaster>`; genuinely global. |
| `qrcode` | — | Already dynamically imported in `/dashboard/tools` ✅ |
| `zod` | — | Server-only (`campaign-actions`, `view-schema`); never reaches the browser ✅ |
| `clsx` / `tailwind-merge` | tiny | Fine. |

**No unused dependency found.** `react-icons` (create/edit campaign forms), `qrcode` (tools page), `zod` (server validation) are all genuinely used. Nothing to remove.

### 1d. Long tasks on `/dashboard` (13)

| Duration | Attributed to |
|---|---|
| 170 ms, 155 ms, 72 ms, 63 ms, 61 ms | `2-2x8-mvontrd.js` — **React hydration** (836 ms bootup, 768 ms of it scripting) |
| 128 ms, 101 ms, 63 ms | **`/dashboard` document itself** — 452 ms bootup with **99 ms of pure parse** = deserializing the RSC flight payload |
| 99 ms, 65 ms | `0pz97kl14_rk8.js` — Chart.js (931 ms bootup) |
| 106 ms, 104 ms, 73 ms | Unattributable (GC / layout under memory pressure from the above) |

### 1e. ⚠️ Root cause: the `/dashboard` HTML document is **982 KB**

| | Bytes |
|---|---|
| `/dashboard` HTML document | **1,005,988 B (982 KB)** |
| …of which RSC flight payload | **957 KB** |
| Actual rendered markup | ~25 KB |
| `/admin` HTML document | 209 KB |

The flight payload contains, verbatim:

```
"viewRows":[{"country_code":"DE","user_agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}, …×6000]
"earningsRows":[{"amount":2.3292,"created_at":"2026-07-28T18:23:41.904Z"}, …×2400]
```

- `user_agent` appears **5,999 times**, `country_code` **5,999 times**, `created_at` **2,400 times**.
- Round 2 correctly moved these queries to the server — but it handed the **raw rows** to a *client* component, so every row has to be JSON-serialised into the HTML, downloaded, **parsed on the main thread**, and retained in memory, purely so the browser can reduce 6,000 rows down to **8 country counts and 3 device counts**.
- This is why the document alone costs 452 ms of bootup / 99 ms of parse and three long tasks, and why React hydration costs 768 ms of scripting.

`/admin` has the same defect at smaller scale, and additionally ships a `created_at` column on every view row that **`AdminCharts` never reads**.

### 1f. Unnecessary hydration / duplicate renders / duplicate effects

| Finding | Cost |
|---|---|
| `AdminSidebar` calls `serverAdminMe()` in a mount effect **although the admin layout already has the profile server-side** | 1 server-action POST + 2 `setState` re-renders per instance |
| `AdminSidebar` is mounted **twice** on every admin page (desktop + mobile drawer) | ⇒ **2** POSTs and **4** re-renders per page load |
| `AnalyticsCharts` aggregates inside `useEffect` then calls `setState` twice | forced double render after mount |
| `NotificationBell` constructs the Supabase client synchronously during hydration | 245 KB of parse on the critical path |
| Logout handlers statically import the Supabase client | 245 KB in the initial graph for a click that may never happen |
| **`Navbar` + `Footer` (35.5 KB)** are in the client graph of **every** dashboard/admin route (they belong to the root `not-found` boundary) although those routes never render them | 35.5 KB download + parse per route |
| Charts request the 171 KB Chart.js chunk **during hydration**, even though on a 412 px mobile viewport every chart is **below the fold** | 931 ms of bootup competing with hydration |

### 1g. Images / fonts / static assets

- **Fonts: nothing to fix.** The app uses a pure system font stack (`--font-inter`, `--font-space` fall back to `system-ui`); Lighthouse reports `numFonts: 0`. No web font is downloaded.
- **Images: nothing loaded on `/dashboard`.** Lighthouse reports 0 image requests. `logo.png` (44 KB) goes through `next/image`; `og.png` (664 KB) is a social-card meta reference and is never fetched by the browser; `favicon.png` (153 KB, 500×500) is only requested by the browser's icon fetch, off the critical path.
- No asset is loaded before it is needed, and CLS is already **0**.

### 1h. What was verified as *already correct* (do not regress)

- `/dashboard/*` and `/admin/*` are all `force-dynamic` SSR/RSC — **no SSG on authenticated routes** ✅
- Initial authenticated data is fetched server-side in one parallel batch; **zero** post-hydration Supabase round-trips ✅
- Charts are behind `next/dynamic({ ssr: false })` with a byte-identical `<canvas>` placeholder ✅
- Notification bell's initial unread count is server-rendered ✅
- `qrcode` is dynamically imported ✅

---

## STEPS 2–8 — WHAT WAS CHANGED (and why)

Every change below was driven by a measurement in Step 1. Nothing was optimized blindly.

### Fix 1 — Aggregate chart data on the server (STEP 2 + STEP 6) — *the big one*

**Problem:** `/dashboard` shipped 6,000 raw view rows + 2,400 raw earnings rows into the RSC flight payload so a *client* component could reduce them to 8 country counts and 3 device counts. 982 KB document, ~450 ms of main-thread parse, 3 long tasks.

**Fix:** new pure module `src/lib/chart-data.ts` holding the *exact same* aggregation functions. Aggregations that do **not** depend on the viewer's timezone (country breakdown, device split, per-network revenue) now run on the server; only the resulting label/count arrays cross the wire.

Aggregations that **do** depend on the viewer's local calendar (per-local-day earnings; per-local-month revenue/payouts/growth) deliberately **stay on the client** — moving them would change the numbers for anyone outside UTC. Their inputs are shipped as compact tuples (`[amount, epochMs]`, `[revenue_date, revenue]`, `epochMs[]`) instead of full row objects.

Also dropped two columns that were being fetched and serialised but **never read**: `views.created_at` and `ad_revenue_imports.source` on `/admin`.

| Document | Before | After |
|---|---|---|
| `/dashboard` HTML | **982 KB** | **114 KB** (−88%) |
| `/admin` HTML | 209 KB | 74 KB (−65%) |

### Fix 2 — Get the 246 KB Supabase client off the critical path (STEP 3 + STEP 7)

**Problem:** `@supabase/ssr` + `supabase-js` (GoTrue + PostgREST + Realtime/phoenix, 245.7 KB) was a **static** import of `DashboardSidebar`, `AdminSidebar`, `DashboardTopbar` and `AccountRestrictionView` — solely for their Logout click handlers — and of `NotificationBell`. It therefore had to be downloaded, parsed and evaluated during hydration on every authenticated route.

**Fix:**
- New `src/lib/supabase/sign-out.ts`: imports the client *inside* the handler. The handler was already `async` and already awaited a network round-trip, so sign-out behaviour is identical.
- `NotificationBell` imports the client inside its effect and opens the socket on `load` + `requestIdleCallback` (see Fix 4).

The library now lives in a chunk fetched only when it is actually needed. **Realtime functionality is fully preserved.**

### Fix 3 — Charts load when visible, not during hydration (STEP 3 + STEP 6)

**Problem:** charts were already behind `next/dynamic({ssr:false})` ✅, but the browser still fetched and evaluated all 171.6 KB of Chart.js *during hydration* — 725–930 ms of bootup. On a 412 px mobile viewport the first chart starts at y≈791 px, i.e. **every chart is below the fold**.

**Fix:** `LazyChart` now gates the import behind `load` → `requestIdleCallback` → `IntersectionObserver` (300 px `rootMargin`). The pre-mount DOM is the *same* placeholder `<canvas role="img" height="150" width="300">` the `dynamic` loading state already rendered, so there is **no layout shift and no spinner**. Charts remain lazy, appearance and data unchanged. Verified: all 3 dashboard / 2 analytics / 4 admin charts still paint (canvas resized by Chart.js, not left at the 300×150 placeholder).

Chart.js registration was audited: only the 9 needed components are registered — no radar/polar/bubble/scatter/time-scale code is pulled in. Nothing further to trim.

### Fix 4 — Remove duplicate fetches, subscriptions and re-renders (STEP 4 + STEP 5)

| Fix | Effect |
|---|---|
| `AdminSidebar` now receives `adminName`/`adminRole` from the admin layout (which had already loaded and role-verified that profile) instead of calling `serverAdminMe()` in a mount effect. Because it renders **twice** per admin page (desktop rail + mobile drawer), this removes **2 server-action POSTs and 4 re-renders** per page load. The effect is kept as a fallback for callers that pass no props. | fewer round-trips, fewer renders |
| `NotificationBell`: a `cancelled` guard prevents a duplicate channel if the effect is torn down before the dynamic import resolves (StrictMode / `userId` change). Bell owns only its own `count`, so a refresh re-renders the bell and nothing else. | **no duplicate subscriptions**, no page re-render |
| `AnalyticsCharts`: aggregation moved out of a mount `useEffect` (which started from empty state then called `setDaily` **and** `setHourly`) into a single `useMemo`. Removes a guaranteed triple render for data already present in props. | 3 renders → 1 |

`useMemo`/`useCallback` were **not** added anywhere else — no other component showed a measurable benefit.

### Fix 5 — Footer split so it stops hydrating on dashboard/admin (STEP 2)

The whole footer was a Client Component because of one "back to top" button. Since it lives in the root `not-found` boundary, its 35.5 KB (with the navbar) sat in the client graph of **every** route — including `/dashboard` and `/admin`, which never render a footer. Extracted `BackToTopButton` (the only interactive element); `Footer` is now a Server Component. Markup is character-identical.

### STEP 7 — Dependencies: nothing added, nothing removed

Audited `package.json` against the bundle. **No unused dependency exists.** `react-icons` (campaign forms), `qrcode` (tools, already dynamic ✅), `zod` (server-only validation — never reaches the browser), `clsx`/`tailwind-merge` (tiny), `sonner` (global Toaster) are all genuinely used. No major version was upgraded. **`package.json` and `package-lock.json` are untouched.**

### STEP 8 — Images / fonts / assets: no change needed, none made

Profiling showed nothing to fix: `numFonts: 0` (pure system font stack — no web font is ever downloaded), and **zero image requests** on `/dashboard`. `og.png` is a meta reference the browser never fetches; `favicon.png` is off the critical path. No asset was recompressed or replaced, so the UI is bit-identical.

### STEP 9 — SSR preserved

All `/dashboard/*` and `/admin/*` routes remain `ƒ (Dynamic)` / `force-dynamic` server-rendered — confirmed in the build output. **No authenticated route was converted to SSG.** Public pages keep their existing static/dynamic classification. The SSR/RSC architecture from rounds 1–2 was extended, never undone: initial authenticated data is still fetched on the server in one parallel batch, with zero post-hydration Supabase round-trips.

---

## STEP 10 & 11 — VERIFICATION

### UI is identical — proven, not assumed

Screenshot diffing alone was **not** trustworthy here: re-running the *unchanged baseline against itself* produced diffs of up to 0.12% (sticky topbars, scroll timing, CSS animations, relative timestamps). So UI equivalence was proven with a **deterministic DOM+computed-style dump** of every element on **24 routes × 2 viewports (mobile 412px + desktop 1440px) = 48 combinations**: tag, class list, box geometry, direct text (timestamps normalised) and 28 computed style properties (colour, background, gradient, font, spacing, radius, border, shadow, flex/grid, z-index…).

| Result | |
|---|---|
| Page/viewport combinations compared | **48** |
| Combinations with any structural or style difference | **3** |
| Differing elements (out of ~30,000) | **4** |
| Differences that are real UI changes | **0** |

All 4 are mid-flight **CSS animation sampling phase** on public marketing pages — e.g. `opacity: 0.434995 → 0.434991` on an `animate-ping` dot, and a sub-pixel `box-shadow` on the scroll-transition navbar. Every element's classes, geometry, text and all other style properties match exactly. **Zero differences on any dashboard or admin route.**

### Functional verification (22/22 passed, real browser, mobile viewport)

Dashboard charts (3, painted) · analytics charts (2, painted) · admin charts (4, painted) · CPM value · earnings · valid views · recent-campaigns table · server-rendered notification badge · **realtime: exactly one socket per load, no duplicates** · mobile sidebar drawer · topbar user menu · create-campaign form · **QR generation (dynamic `qrcode` import)** · admin stat cards · admin sidebar identity · admin users table · notifications list · **logout (exercises the lazily-imported Supabase chunk)** · post-logout redirect to `/login` · **no page errors**.

**Auth / RBAC / suspend-ban gates re-verified unchanged** by swapping the mock profile:

| Profile | `/dashboard` | `/admin` |
|---|---|---|
| active + super_admin | ✅ dashboard | ✅ admin panel |
| **suspended** | → `/account/suspended` | → `/account/suspended` |
| **banned** | → `/account/banned` | → `/account/banned` |
| active + **creator** (non-admin) | ✅ dashboard | → `/dashboard` (blocked) |

### Commands

| Command | Result |
|---|---|
| `npm test` | ✅ **17 files / 142 tests passed** |
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ **0 errors**, 10 warnings (identical to baseline — none added) |
| `npm run build` | ✅ exit 0, all 46 routes, same static/dynamic classification as baseline |

---

## STEP 12 — BEFORE / AFTER

Lighthouse mobile · Moto G Power emulation · Slow 4G · 4× CPU throttle · production build · authenticated initial page load · **median of 5 runs**.

### `/dashboard`

| Metric | Before | After | |
|---|---|---|---|
| **Performance** | **89** | **98** | ✅ target 90+ |
| FCP | 1030 ms | **814 ms** | ✅ ≤1.5 s |
| LCP | 1136 ms | **864 ms** | ✅ ≤1.5 s |
| **TBT** | **462 ms** | **181 ms** | ✅ <200 ms (−61%) |
| CLS | 0 | **0** | ✅ |
| Speed Index | 1146 ms | **845 ms** | ✅ <3.5 s |
| **JavaScript execution** | 1287 ms | **687 ms** | −47% |
| **Main-thread work** | 2734 ms | **1718 ms** | −37% |
| Long tasks | 13 | **5** | −62% |

### `/admin`

| Metric | Before | After | |
|---|---|---|---|
| **Performance** | **88** | **96** | ✅ target 90+ |
| FCP | 924 ms | **823 ms** | ✅ |
| LCP | 1087 ms | **991 ms** | ✅ |
| **TBT** | **490 ms** | **240 ms** | −51% |
| CLS | 0 | **0** | ✅ |
| Speed Index | 1009 ms | **823 ms** | ✅ |
| **JavaScript execution** | 1260 ms | **1043 ms** | −17% |
| **Main-thread work** | 2226 ms | **1723 ms** | −23% |
| Long tasks | 10 | **7** | −30% |

### Bundle / payload size

| | Before | After | Δ |
|---|---|---|---|
| `/dashboard` client chunks | 370.2 KB | **121.6 KB** | **−67%** |
| `/admin` client chunks | 371.0 KB | **122.7 KB** | **−67%** |
| every other `/dashboard/*`, `/admin/*` route | 356–386 KB | **107–135 KB** (except 3 routes that genuinely use the Supabase browser client) | −65% |
| **`/dashboard` HTML document** | **982 KB** | **114 KB** | **−88%** |
| `/admin` HTML document | 209 KB | 74 KB | −65% |
| Shared runtime | 537.2 KB | 537.2 KB | unchanged |

### Files changed

**New (4)**
- `src/lib/chart-data.ts` — shared pure chart aggregators
- `src/lib/supabase/sign-out.ts` — lazily-imported client sign-out
- `src/components/BackToTopButton.tsx` — the footer's only interactive element
- `PERFORMANCE_REPORT_V3.md` — this report

**Modified (14)**
- `src/app/dashboard/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/layout.tsx`
- `src/components/DashboardCharts.tsx`, `AdminCharts.tsx`, `AnalyticsCharts.tsx`, `charts/LazyChart.tsx`
- `src/components/NotificationBell.tsx`, `DashboardTopbar.tsx`, `DashboardSidebar.tsx`, `AdminSidebar.tsx`, `AdminMobileSidebar.tsx`, `AccountRestrictionView.tsx`, `Footer.tsx`

### Explicit confirmations

| Question | Answer |
|---|---|
| Did the UI change? | **NO** — proven across 48 page/viewport combinations; the only 4 deltas are CSS-animation sampling phase on public pages (see Step 10) |
| Did the database schema / RLS / policies change? | **NO** — zero migrations, zero policy edits. `supabase/` untouched |
| Did business logic change? | **NO** |
| Did CPM / earnings / finance math change? | **NO** — `cpm.ts`, `earnings.ts`, `finance.ts`, `fraud.ts` untouched. Chart aggregation code is character-identical, only relocated |
| Did auth / RBAC change? | **NO** — re-verified across active/suspended/banned/non-admin |
| Did campaign behaviour change? | **NO** |
| Did notifications / announcements change? | **NO** — realtime preserved; one socket per load, no duplicates |
| Were dependencies added/removed/upgraded? | **NO** — `package.json` and `package-lock.json` untouched |
| Were any features replaced with placeholders? | **NO** |
| Were loading-state regressions introduced? | **NO** — chart placeholder markup is byte-identical; CLS stays 0 |
| Was SSR preserved on authenticated routes? | **YES** — all `/dashboard/*` and `/admin/*` remain `force-dynamic` |
| Pushed to GitHub? | **NO** — local only, awaiting approval |
