import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_PATHS,
  isRestrictedAccountStatus,
  resolveAccountGate,
  restrictionPathForStatus,
  sanitizeAccountReason,
} from '@/lib/account-status';

const creator = { role: 'creator', status: 'active' };
const suspended = { role: 'creator', status: 'suspended' };
const banned = { role: 'creator', status: 'banned' };
const pending = { role: 'creator', status: 'pending_verification' };
const admin = { role: 'admin', status: 'active' };
const pendingAdmin = { role: 'admin', status: 'pending_verification' };

describe('account status helpers', () => {
  it('recognizes the existing user_status enum values', () => {
    expect(isRestrictedAccountStatus('suspended')).toBe(true);
    expect(isRestrictedAccountStatus('banned')).toBe(true);
    expect(isRestrictedAccountStatus('active')).toBe(false);
    expect(isRestrictedAccountStatus('pending_verification')).toBe(false);
    expect(restrictionPathForStatus('suspended')).toBe(ACCOUNT_PATHS.suspended);
    expect(restrictionPathForStatus('banned')).toBe(ACCOUNT_PATHS.banned);
    expect(restrictionPathForStatus('active')).toBeNull();
  });

  it('shows a stored reason only when it is a safe non-empty string', () => {
    expect(sanitizeAccountReason(null)).toBeNull();
    expect(sanitizeAccountReason(undefined)).toBeNull();
    expect(sanitizeAccountReason('   ')).toBeNull();
    expect(sanitizeAccountReason(12)).toBeNull();
    expect(sanitizeAccountReason('Policy violation')).toBe('Policy violation');
    expect(sanitizeAccountReason('  repeated  fraud  ')).toBe('repeated fraud');
    expect(sanitizeAccountReason('x'.repeat(400))?.length).toBe(280);
  });
});

describe('resolveAccountGate', () => {
  it('lets anonymous visitors use public, auth, and campaign URLs', () => {
    expect(resolveAccountGate({ pathname: '/', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/c/demo-campaign', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/login', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/signup', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/forgot-password', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/auth/reset', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/contact', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/support', authenticated: false, profile: null })).toBeNull();
    expect(resolveAccountGate({ pathname: '/verify-email', authenticated: false, profile: null })).toBeNull();
  });

  it('sends anonymous users away from protected and restriction pages', () => {
    expect(resolveAccountGate({ pathname: '/dashboard', authenticated: false, profile: null }))
      .toEqual({ redirectTo: '/login' });
    expect(resolveAccountGate({ pathname: '/dashboard/campaigns', authenticated: false, profile: null }))
      .toEqual({ redirectTo: '/login' });
    expect(resolveAccountGate({ pathname: '/dashboard/withdraw', authenticated: false, profile: null }))
      .toEqual({ redirectTo: '/login' });
    expect(resolveAccountGate({ pathname: '/account/suspended', authenticated: false, profile: null }))
      .toEqual({ redirectTo: '/login' });
    expect(resolveAccountGate({ pathname: '/account/banned', authenticated: false, profile: null }))
      .toEqual({ redirectTo: '/login' });
  });

  it('blocks every protected creator route for suspended and banned accounts', () => {
    const protectedRoutes = [
      '/dashboard',
      '/dashboard/campaigns',
      '/dashboard/campaigns/abc/edit',
      '/dashboard/create-campaign',
      '/dashboard/analytics',
      '/dashboard/withdraw',
      '/dashboard/referrals',
      '/dashboard/settings',
      '/dashboard/notifications',
      '/dashboard/support',
      '/dashboard/tools',
      '/admin',
    ];
    for (const pathname of protectedRoutes) {
      expect(resolveAccountGate({ pathname, authenticated: true, profile: suspended }))
        .toEqual({ redirectTo: ACCOUNT_PATHS.suspended });
      expect(resolveAccountGate({ pathname, authenticated: true, profile: banned }))
        .toEqual({ redirectTo: ACCOUNT_PATHS.banned });
    }
  });

  it('does not send restricted creators into a login loop', () => {
    expect(resolveAccountGate({ pathname: '/login', authenticated: true, profile: suspended }))
      .toEqual({ redirectTo: ACCOUNT_PATHS.suspended });
    expect(resolveAccountGate({ pathname: '/signup', authenticated: true, profile: banned }))
      .toEqual({ redirectTo: ACCOUNT_PATHS.banned });
    expect(resolveAccountGate({ pathname: '/verify-email', authenticated: true, profile: suspended }))
      .toEqual({ redirectTo: ACCOUNT_PATHS.suspended });
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.suspended, authenticated: true, profile: suspended }))
      .toBeNull();
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.banned, authenticated: true, profile: banned }))
      .toBeNull();
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.banned, authenticated: true, profile: suspended }))
      .toEqual({ redirectTo: ACCOUNT_PATHS.suspended });
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.suspended, authenticated: true, profile: banned }))
      .toEqual({ redirectTo: ACCOUNT_PATHS.banned });
  });

  it('keeps public campaign and marketing pages available while restricted', () => {
    expect(resolveAccountGate({ pathname: '/c/my-campaign', authenticated: true, profile: suspended })).toBeNull();
    expect(resolveAccountGate({ pathname: '/c/my-campaign', authenticated: true, profile: banned })).toBeNull();
    expect(resolveAccountGate({ pathname: '/contact', authenticated: true, profile: suspended })).toBeNull();
    expect(resolveAccountGate({ pathname: '/', authenticated: true, profile: banned })).toBeNull();
    expect(resolveAccountGate({ pathname: '/auth/reset', authenticated: true, profile: suspended })).toBeNull();
  });

  it('restores dashboard access when the account is active again', () => {
    expect(resolveAccountGate({ pathname: '/dashboard', authenticated: true, profile: creator })).toBeNull();
    expect(resolveAccountGate({ pathname: '/dashboard/campaigns', authenticated: true, profile: creator })).toBeNull();
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.suspended, authenticated: true, profile: creator }))
      .toEqual({ redirectTo: '/dashboard' });
    expect(resolveAccountGate({ pathname: ACCOUNT_PATHS.banned, authenticated: true, profile: creator }))
      .toEqual({ redirectTo: '/dashboard' });
    expect(resolveAccountGate({ pathname: '/login', authenticated: true, profile: creator }))
      .toEqual({ redirectTo: '/dashboard' });
  });

  it('preserves pending verification and admin routing', () => {
    expect(resolveAccountGate({ pathname: '/dashboard', authenticated: true, profile: pending }))
      .toEqual({ redirectTo: '/verify-email' });
    expect(resolveAccountGate({ pathname: '/login', authenticated: true, profile: pending }))
      .toEqual({ redirectTo: '/verify-email' });
    expect(resolveAccountGate({ pathname: '/verify-email', authenticated: true, profile: pending })).toBeNull();
    expect(resolveAccountGate({ pathname: '/dashboard', authenticated: true, profile: pendingAdmin })).toBeNull();
    expect(resolveAccountGate({ pathname: '/admin', authenticated: true, profile: creator }))
      .toEqual({ redirectTo: '/dashboard' });
    expect(resolveAccountGate({ pathname: '/admin', authenticated: true, profile: admin })).toBeNull();
  });
});
