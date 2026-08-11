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

  // Read level thresholds from the database (admin-configurable).
  const { data: levels } = await supabase
    .from('creator_levels')
    .select('level, min_views')
    .eq('active', true)
    .order('min_views', { ascending: true });

  const sorted = (levels || []).sort((a: any, b: any) => Number(a.min_views) - Number(b.min_views));
  const idx = sorted.findIndex((l: any) => l.level === level);
  const next = idx >= 0 ? sorted[idx + 1] : null;
  const target = next ? Number(next.min_views) : Number(sorted[sorted.length - 1]?.min_views ?? 0);
  const base = idx > 0 ? Number(sorted[idx].min_views) : 0;
  const progress = target > base
    ? Math.min(100, Math.round((((profile.total_views || 0) - base) / (target - base)) * 100))
    : 100;

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