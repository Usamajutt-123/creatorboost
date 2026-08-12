import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
  const isProtectedRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
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
  const isVerifyRoute = pathname === '/verify-email';
  const isAuthEntryRoute = pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password';

  if (!user) {
    if (isProtectedRoute) return loginRedirect(request);
    return response;
  }

  // Profile status/role must be read from the server-backed session, never a
  // browser role value. Fetch it for every route where it affects a redirect.
  let profile: { role: string; status: string } | null = null;
  if (isProtectedRoute || isVerifyRoute || isAuthEntryRoute) {
    const { data } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .maybeSingle();
    profile = data;
  }

  if (isProtectedRoute) {
    if (!profile) return loginRedirect(request, 'profile-unavailable');
    if (profile.status === 'banned' || profile.status === 'suspended') return loginRedirect(request, 'account-suspended');
    const isAdmin = profile.role === 'admin' || profile.role === 'super_admin';
    if (profile.status === 'pending_verification' && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-email';
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/admin') && !isAdmin) return NextResponse.redirect(new URL('/dashboard', request.url));
    return response;
  }

  // This branch fixes the former /verify-email -> /dashboard ->
  // /verify-email loop for signed-in but unconfirmed users.
  if (isVerifyRoute) {
    if (!profile || profile.status === 'banned' || profile.status === 'suspended') return loginRedirect(request, 'account-suspended');
    if (profile.status !== 'pending_verification' || profile.role === 'admin' || profile.role === 'super_admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return response;
  }

  if (isAuthEntryRoute) {
    if (profile?.status === 'pending_verification' && profile.role !== 'admin' && profile.role !== 'super_admin') {
      return NextResponse.redirect(new URL('/verify-email', request.url));
    }
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}
