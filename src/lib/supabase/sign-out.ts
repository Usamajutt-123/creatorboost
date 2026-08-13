/**
 * Client-side sign-out.
 *
 * The Supabase browser client (`@supabase/ssr` + `supabase-js`, ~246 KB of
 * GoTrue + PostgREST + Realtime) used to be a *static* import of every
 * component that renders a Logout button — the dashboard sidebar, the admin
 * sidebar, the topbar user menu and the account-restriction screens. That put
 * the whole library in the initial JavaScript graph of every authenticated
 * route, where it had to be downloaded, parsed and evaluated during hydration,
 * for a click that most page loads never perform.
 *
 * Importing it inside the handler moves it into its own chunk that is fetched
 * only when someone actually signs out. The handler was already `async` and
 * already awaited a network round-trip, so there is no perceptible difference:
 * behaviour, session clearing and the subsequent redirect are unchanged.
 */
export async function signOutClient(): Promise<void> {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  await supabase.auth.signOut();
}
