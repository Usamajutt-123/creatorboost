import { serverAdminMe, adminListUsers } from '@/lib/admin-server';
import AdminUsersClient from './UsersClient';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  // Both helpers authorize against the session (server-side); the cached
  // session/profile means this render costs one auth + one role check, not
  // one per helper. Previously this data loaded in the browser after
  // hydration through two server-action round-trips.
  const [me, users] = await Promise.all([
    serverAdminMe().catch(() => ({ ok: false as const, admin: null, isSuper: false })),
    adminListUsers().catch((e: Error) => e),
  ]);

  return (
    <AdminUsersClient
      initialUsers={(Array.isArray(users) ? users : []) as never[]}
      initialIsSuper={me.isSuper}
      initialError={users instanceof Error ? users.message : null}
    />
  );
}
