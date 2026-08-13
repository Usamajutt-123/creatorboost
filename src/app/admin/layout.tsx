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

  return (

    <div className="min-h-screen pt-16 flex">
      <div className="hidden lg:block sticky top-16 h-[calc(100vh-4rem)] flex-shrink-0">
        <AdminSidebar />
      </div>
      <AdminMobileSidebar />
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
