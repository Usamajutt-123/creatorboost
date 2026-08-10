import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileSidebar from '@/components/MobileSidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  const level = profile.level || 'bronze';
  const nextLevelViews: Record<string, number> = {
    bronze: 100_000, silver: 1_000_000, gold: 5_000_000, platinum: 10_000_000, diamond: 50_000_000,
  };
  const target = nextLevelViews[level] || 100_000;
  const progress = Math.min(100, Math.round(((profile.total_views || 0) / target) * 100));

  return (
    <div className="min-h-screen pt-16 flex">
      <div className="hidden lg:block sticky top-16 h-[calc(100vh-4rem)] flex-shrink-0">
        <DashboardSidebar level={level} levelProgress={progress} isAdmin={profile.role === 'admin' || profile.role === 'super_admin'} />

      </div>

      <MobileSidebar level={level} levelProgress={progress} isAdmin={profile.role === 'admin' || profile.role === 'super_admin'} />
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}