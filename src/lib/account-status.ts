/**
 * Account restriction helpers.
 *
 * Status values match the `user_status` Postgres enum:
 *   active | suspended | banned | pending_verification
 *
 * Keep this module free of I/O so middleware routing can be unit-tested
 * without a Supabase session.
 */

export const USER_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  PENDING_VERIFICATION: 'pending_verification',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const ACCOUNT_PATHS = {
  suspended: '/account/suspended',
  banned: '/account/banned',
} as const;

export type AccountProfile = {
  role: string;
  status: string;
};

export type AccountGateDecision = {
  redirectTo: string;
  error?: string;
};

export function isRestrictedAccountStatus(status: string | null | undefined): status is 'suspended' | 'banned' {
  return status === USER_STATUS.SUSPENDED || status === USER_STATUS.BANNED;
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function restrictionPathForStatus(status: string | null | undefined): string | null {
  if (status === USER_STATUS.SUSPENDED) return ACCOUNT_PATHS.suspended;
  if (status === USER_STATUS.BANNED) return ACCOUNT_PATHS.banned;
  return null;
}

export function isProtectedAppPath(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
    || pathname === '/admin' || pathname.startsWith('/admin/');
}

export function isAccountRestrictionPath(pathname: string): boolean {
  return pathname === ACCOUNT_PATHS.suspended || pathname === ACCOUNT_PATHS.banned;
}

export function isAuthEntryPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password';
}

export function isVerifyEmailPath(pathname: string): boolean {
  return pathname === '/verify-email';
}

/**
 * Show a stored reason only when it is a non-empty, human-safe string.
 * Never invent a reason when the database has none.
 */
export function sanitizeAccountReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.slice(0, 280);
}

/**
 * Decide whether the current request should be redirected based on auth and
 * `profiles.status`. Returns null when the request may continue.
 *
 * Public routes (including /c/[slug], /contact, /support, password reset)
 * are never blocked here.
 */
export function resolveAccountGate(input: {
  pathname: string;
  authenticated: boolean;
  profile: AccountProfile | null;
}): AccountGateDecision | null {
  const { pathname, authenticated, profile } = input;
  const protectedPath = isProtectedAppPath(pathname);
  const statusPath = isAccountRestrictionPath(pathname);
  const authEntry = isAuthEntryPath(pathname);
  const verify = isVerifyEmailPath(pathname);

  if (!authenticated) {
    if (protectedPath || statusPath) return { redirectTo: '/login' };
    return null;
  }

  if (!profile) {
    if (protectedPath || statusPath || verify) return { redirectTo: '/login', error: 'profile-unavailable' };
    if (authEntry) return { redirectTo: '/dashboard' };
    return null;
  }

  const restrictedPath = restrictionPathForStatus(profile.status);
  const admin = isAdminRole(profile.role);

  if (restrictedPath) {
    if (statusPath) {
      return pathname === restrictedPath ? null : { redirectTo: restrictedPath };
    }
    if (protectedPath || authEntry || verify) return { redirectTo: restrictedPath };
    return null;
  }

  if (statusPath) {
    if (profile.status === USER_STATUS.PENDING_VERIFICATION && !admin) {
      return { redirectTo: '/verify-email' };
    }
    return { redirectTo: '/dashboard' };
  }

  if (protectedPath) {
    if (profile.status === USER_STATUS.PENDING_VERIFICATION && !admin) {
      return { redirectTo: '/verify-email' };
    }
    if ((pathname === '/admin' || pathname.startsWith('/admin/')) && !admin) {
      return { redirectTo: '/dashboard' };
    }
    return null;
  }

  if (verify) {
    if (profile.status !== USER_STATUS.PENDING_VERIFICATION || admin) {
      return { redirectTo: '/dashboard' };
    }
    return null;
  }

  if (authEntry) {
    if (profile.status === USER_STATUS.PENDING_VERIFICATION && !admin) {
      return { redirectTo: '/verify-email' };
    }
    return { redirectTo: '/dashboard' };
  }

  return null;
}
