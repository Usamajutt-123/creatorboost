import { redirect } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import AdminMobileSidebar from '@/components/AdminMobileSidebar';
import DashboardTopbar from "@/components/DashboardTopbar";
import { getDashboardProfile, getSessionUser } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/notifications';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Request-scoped helpers: the user and profile are verified once per request
  // (the role/status checks below are unchanged), and admin pages rendered
  // inside this layout reuse the same cached rows instead of re-querying.
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [profile, unreadCount] = await Promise.all([
    getDashboardProfile(),
    // Server-rendered unread badge count for the topbar bell.
    getUnreadNotificationCount(user.id),
  ]);

  if (profile?.status === 'suspended') redirect('/account/suspended');
  if (profile?.status === 'banned') redirect('/account/banned');
  if (profile?.role !== 'admin' && profile?.role !== 'super_admin') redirect('/dashboard');

  // The layout has already loaded (and role-verified) this profile, so the
  // sidebars receive the identity they render instead of each firing its own
  // `serverAdminMe()` server action from a mount effect.
  const adminName = profile.full_name || profile.email || 'Admin';
  const adminRole = profile.role || 'admin';

  return (

    <div className="min-h-screen pt-16 flex">
      <div className="hidden lg:block sticky top-16 h-[calc(100vh-4rem)] flex-shrink-0">
        <AdminSidebar adminName={adminName} adminRole={adminRole} />
      </div>
      <AdminMobileSidebar adminName={adminName} adminRole={adminRole} />
      <div className="flex-1 min-w-0">
        <DashboardTopbar
          title="Admin Panel"
          subtitle="Manage your platform"
          userId={user.id}
          unreadCount={unreadCount}
        />
        {children}
      </div>
    </div>
  );
}
