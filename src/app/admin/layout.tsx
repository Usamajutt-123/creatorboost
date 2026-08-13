import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import AdminMobileSidebar from '@/components/AdminMobileSidebar';
import DashboardTopbar from "@/components/DashboardTopbar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', user.id).single();
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
        />
        {children}
      </div>
    </div>
  );
}