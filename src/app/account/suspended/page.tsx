import type { Metadata } from 'next';
import AccountRestrictionView from '@/components/AccountRestrictionView';
import { requireRestrictedAccount } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account Suspended',
  robots: { index: false, follow: false },
};

const SUPPORT_HREF = '/contact';

export default async function SuspendedAccountPage() {
  const profile = await requireRestrictedAccount('suspended');

  return (
    <AccountRestrictionView
      variant="suspended"
      reason={profile.reason}
      supportHref={SUPPORT_HREF}
    />
  );
}
