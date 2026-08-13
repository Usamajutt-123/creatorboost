import { adminLoadLevels } from '@/lib/admin-server';
import AdminLevelsClient from './LevelsClient';

export const dynamic = 'force-dynamic';

export default async function AdminLevelsPage() {
  // Authorized server-side (requireAdmin), rendered with the first paint
  // instead of a post-hydration server-action round-trip.
  const levels = await adminLoadLevels().catch((e: Error) => e);

  return (
    <AdminLevelsClient
      initialLevels={(Array.isArray(levels) ? levels : []) as never[]}
      initialError={levels instanceof Error ? levels.message : null}
    />
  );
}
