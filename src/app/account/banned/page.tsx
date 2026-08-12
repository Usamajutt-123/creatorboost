import type { Metadata } from 'next';
import AccountRestrictionView from '@/components/AccountRestrictionView';
import { requireRestrictedAccount } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account Permanently Banned',
  robots: { index: false, follow: false },
};

const SUPPORT_HREF = '/contact';

export default async function BannedAccountPage() {
  const profile = await requireRestrictedAccount('banned');

  return (
    <AccountRestrictionView
      variant="banned"
      reason={profile.reason}
      supportHref={SUPPORT_HREF}
    />
  );
}
