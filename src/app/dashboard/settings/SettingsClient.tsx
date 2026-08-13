'use client';
import { useState } from 'react';
import DashboardTopbar from '@/components/DashboardTopbar';
import Select from '@/components/Select';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type SettingsProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string;
  bio: string | null;
  country_code: string | null;
  level: string | null;
  created_at: string;
};

/**
 * The profile is server-rendered (see page.tsx) with only the columns this
 * form uses — no balances, referral data or admin fields ever reach the
 * browser. Saving still updates the user's own row through RLS exactly as
 * before.
 */
export default function SettingsClient({
  initialProfile,
  userId,
  unreadCount,
}: {
  initialProfile: SettingsProfile | null;
  userId: string;
  unreadCount: number;
}) {
  const [profile, setProfile] = useState<SettingsProfile | null>(initialProfile);

  const save = async () => {
    if (!profile) return;
    const supabase = createClient();
    const { error } = await supabase.from('profiles').update({
      full_name: profile.full_name,
      bio: profile.bio,
      country_code: profile.country_code || null,
    }).eq('id', profile.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Settings saved!');
  };

  if (!profile) return <><DashboardTopbar title="Profile Settings" userId={userId} unreadCount={unreadCount} /><div className="p-6"><div className="skeleton h-96 rounded-2xl" /></div></>;

  return (
    <>
      <DashboardTopbar title="Profile Settings" subtitle="Manage your account" fullName={profile.full_name ?? undefined} email={profile.email} userId={userId} unreadCount={unreadCount} />
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
        <div className="glass-strong rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-4 pb-6 border-b border-white/5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-3xl font-bold">
              {profile.full_name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg">{profile.full_name}</h3>
              <p className="text-sm text-gray-500 capitalize">{profile.level} Creator • Member since {new Date(profile.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Full Name</label>
              <input value={profile.full_name || ''} onChange={e => setProfile({ ...profile, full_name: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Username</label>
              <input value={profile.username || ''} readOnly className="input-field opacity-70" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Email</label>
              <input value={profile.email} readOnly className="input-field opacity-70" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-300 block mb-1.5">Country</label>
              <Select value={profile.country_code || ''} onChange={value => setProfile({ ...profile, country_code: value })} ariaLabel="Country" options={[
                { value: '', label: 'Select...' },
                ...['US','GB','DE','FR','CA','AU','IN','PK','BR','MX','JP'].map(c => ({ value: c, label: c })),
              ]} />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-300 block mb-1.5">Bio</label>
            <textarea rows={3} value={profile.bio || ''} onChange={e => setProfile({ ...profile, bio: e.target.value })} className="input-field" />
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-6 space-y-3">
          <h3 className="font-semibold">Security & Notifications</h3>
          <div className="p-3 glass rounded-xl text-xs text-gray-400 leading-relaxed">
            <strong className="text-gray-200">Email notifications:</strong> withdrawal updates and account alerts are
            sent to your verified email address automatically.
          </div>
          <div className="p-3 glass rounded-xl text-xs text-gray-400 leading-relaxed">
            <strong className="text-gray-200">Two-factor authentication</strong> is not available yet. We will notify
            you when it can be enabled. In the meantime, account access is protected by email verification and
            server-side session security.
          </div>
        </div>

        <button onClick={save} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white">Save Changes</button>
      </div>
    </>
  );
}
