import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { restrictionPathForStatus, sanitizeAccountReason, USER_STATUS } from '@/lib/account-status';

type RestrictedProfile = {
  status: string;
  reason: string | null;
};

/** Server-side check so restriction pages cannot be spoofed from the client. */
export async function requireRestrictedAccount(expected: 'suspended' | 'banned'): Promise<RestrictedProfile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/login');
  if (profile.status !== expected) {
    const restricted = restrictionPathForStatus(profile.status);
    if (restricted) redirect(restricted);
    if (profile.status === USER_STATUS.PENDING_VERIFICATION) redirect('/verify-email');
    redirect('/dashboard');
  }

  // Only surface a reason if the live profile row already stores one.
  // The current schema has no dedicated reason column — do not invent text.
  const row = profile as Record<string, unknown>;
  const reason = sanitizeAccountReason(
    row.status_reason ?? row.suspension_reason ?? row.ban_reason ?? row.restriction_reason,
  );

  return { status: profile.status, reason };
}
