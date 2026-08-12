import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  isAccountRestrictionPath,
  isAuthEntryPath,
  isProtectedAppPath,
  isVerifyEmailPath,
  resolveAccountGate,
} from '@/lib/account-status';

function loginRedirect(request: NextRequest, error?: string) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = isProtectedAppPath(pathname);
  const isVerifyRoute = isVerifyEmailPath(pathname);
  const isAuthEntryRoute = isAuthEntryPath(pathname);
  const isAccountStatusRoute = isAccountRestrictionPath(pathname);
  // Public marketing pages should remain renderable in a fresh checkout. In a
  // real deployment these variables are mandatory; fail protected routes
  // closed instead of accidentally treating an absent client as a session.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return isProtectedRoute ? loginRedirect(request, 'service-unavailable') : response;
  }
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // getAll/setAll is required by current @supabase/ssr so refresh-token
      // updates are atomically mirrored onto both request and response.
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Profile status/role must be read from the server-backed session, never a
  // browser role value. Fetch it for every route where it affects a redirect.
  let profile: { role: string; status: string } | null = null;
  if (user && (isProtectedRoute || isVerifyRoute || isAuthEntryRoute || isAccountStatusRoute)) {
    const { data } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .maybeSingle();
    profile = data;
  }

  const gate = resolveAccountGate({
    pathname,
    authenticated: Boolean(user),
    profile,
  });

  if (gate) {
    if (gate.redirectTo === '/login') return loginRedirect(request, gate.error);
    return NextResponse.redirect(new URL(gate.redirectTo, request.url));
  }

  return response;
}
