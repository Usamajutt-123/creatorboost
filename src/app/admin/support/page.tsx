import { adminListSupportTickets } from '@/lib/admin-server';
import AdminSupportClient from './SupportClient';

export const dynamic = 'force-dynamic';

export default async function AdminSupportPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of a post-hydration server-action round-trip.
  const tickets = await adminListSupportTickets().catch((e: Error) => e);

  return (
    <AdminSupportClient
      initialTickets={(Array.isArray(tickets) ? tickets : []) as never[]}
      initialError={tickets instanceof Error ? tickets.message : null}
    />
  );
}
