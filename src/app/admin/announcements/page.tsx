import { adminListAnnouncements, adminGetAnnouncementRecipientCount } from '@/lib/admin-server';
import AdminAnnouncementsClient from './AnnouncementsClient';

export const dynamic = 'force-dynamic';

export default async function AdminAnnouncementsPage() {
  // History and the initial "all creators" recipient count are authorized and
  // resolved server-side (requireAdmin), so the composer and history render
  // with the first paint instead of two post-hydration server-action calls.
  const [history, count] = await Promise.all([
    adminListAnnouncements().catch((e: Error) => e),
    adminGetAnnouncementRecipientCount('all_creators').catch(() => null),
  ]);

  return (
    <AdminAnnouncementsClient
      initialHistory={(Array.isArray(history) ? history : []) as never[]}
      initialHistoryError={history instanceof Error ? history.message : null}
      initialRecipientCount={count}
    />
  );
}
