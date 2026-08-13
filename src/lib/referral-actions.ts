'use server';

import { createAdminClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/session';

export type ReferralDashboardData = {
  referralCode: string;
  clicks: number;
  commissionRate: number;
  referralEarnings: number;
  referrals: Array<{ id: string; name: string; joinedAt: string; commission: number; status: string }>;
};

/** Returns a privacy-safe referral dashboard for the signed-in referrer only. */
export async function loadReferralDashboardAction(): Promise<{ success: true; data: ReferralDashboardData } | { success: false; error: string }> {
  try {
    // Request-scoped session helper: shared with the layout/page that already
    // resolved the session, so no duplicate auth round-trip happens here.
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'You must be signed in' };

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('referral_code, referral_earnings')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.referral_code) return { success: false, error: 'Referral profile is unavailable' };

    const [{ data: referrals }, { count: clicks }, { data: settings }] = await Promise.all([
      admin.from('referrals').select('id, referred_id, total_commission, status, created_at').eq('referrer_id', user.id).order('created_at', { ascending: false }).limit(500),
      admin.from('referral_clicks').select('id', { count: 'exact', head: true }).eq('referral_code', profile.referral_code),
      admin.from('platform_settings').select('referral_percentage').eq('id', 1).maybeSingle(),
    ]);

    const referredIds = (referrals || []).map(row => row.referred_id);
    const { data: publicProfiles } = referredIds.length
      ? await admin.from('public_profiles').select('id, username, full_name, created_at').in('id', referredIds)
      : { data: [] as Array<{ id: string; username: string; full_name: string | null; created_at: string }> };
    const people = new Map((publicProfiles || []).map(person => [person.id, person]));

    return {
      success: true,
      data: {
        referralCode: profile.referral_code,
        clicks: clicks || 0,
        commissionRate: Number(settings?.referral_percentage ?? 0),
        referralEarnings: Number(profile.referral_earnings ?? 0),
        referrals: (referrals || []).map(row => {
          const person = people.get(row.referred_id);
          return {
            id: row.id,
            name: person?.full_name || person?.username || 'Creator',
            joinedAt: person?.created_at || row.created_at,
            commission: Number(row.total_commission || 0),
            status: row.status,
          };
        }),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not load referrals' };
  }
}
