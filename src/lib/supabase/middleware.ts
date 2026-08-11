import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/signup') ||
                      request.nextUrl.pathname.startsWith('/forgot-password') ||
                      request.nextUrl.pathname.startsWith('/verify-email');

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard') ||
                           request.nextUrl.pathname.startsWith('/admin');

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Enforce account status on protected routes (banned/suspended blocked).
  if (isProtectedRoute && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .maybeSingle();

    const blocked = profile && (profile.status === 'banned' || profile.status === 'suspended');
    if (blocked) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'account-suspended');
      return NextResponse.redirect(url);
    }

    // Enforce email verification for non-admin creators.
    const isAdmin = profile && (profile.role === 'admin' || profile.role === 'super_admin');
    if (profile?.status === 'pending_verification' && !isAdmin &&
        !request.nextUrl.pathname.startsWith('/verify-email')) {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-email';
      return NextResponse.redirect(url);
    }

    if (request.nextUrl.pathname.startsWith('/admin') &&
        profile?.role !== 'admin' && profile?.role !== 'super_admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}
