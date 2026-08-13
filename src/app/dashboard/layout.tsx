import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileSidebar from '@/components/MobileSidebar';
import { sendTemplateEmail, isConfigured as emailConfigured } from '@/lib/email';
import { getDashboardProfile, getSessionUser } from '@/lib/session';

/** One-time welcome email after the account becomes active. */
async function maybeSendWelcomeEmail(userId: string, email: string | null | undefined) {
  if (!email || !emailConfigured()) return;
  try {
    const supabase = createAdminClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('welcome_email_sent_at, status, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (!profile || profile.welcome_email_sent_at || profile.status !== 'active') return;
    const res = await sendTemplateEmail('welcome', email, { name: profile.full_name || 'creator' });
    if (res.sent) {
      await supabase.from('profiles').update({ welcome_email_sent_at: new Date().toISOString() }).eq('id', userId);
    }
  } catch (e) {
    console.error('[dashboard] welcome email failed', e);
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // The level thresholds do not depend on the profile, so both round-trips run
  // in parallel instead of one after the other. `getSessionUser`/
  // `getDashboardProfile` are request-scoped, so the page rendered inside this
  // layout reuses the same rows instead of re-querying Supabase.
  const [user, profile, { data: levels }] = await Promise.all([
    getSessionUser(),
    getDashboardProfile(),
    supabase
      .from('creator_levels')
      .select('level, min_views')
      .eq('active', true)
      .order('min_views', { ascending: true }),
  ]);

  if (!user) redirect('/login');

  if (!profile) redirect('/login');
  if (profile.status === 'suspended') redirect('/account/suspended');
  if (profile.status === 'banned') redirect('/account/banned');

  // Fire-and-forget welcome email (deduped by welcome_email_sent_at).
  void maybeSendWelcomeEmail(user.id, profile.email);

  const level = profile.level || 'bronze';

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