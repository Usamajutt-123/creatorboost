'use client';
import { useEffect, useState } from 'react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setProfile(data);
      }
    };
    load();
  }, []);

  const save = async () => {
    if (!profile) return;
    const supabase = createClient();
    const { error } = await supabase.from('profiles').update({
      full_name: profile.full_name,
      bio: profile.bio,
      country_code: profile.country_code,
    }).eq('id', profile.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Settings saved!');
  };

  if (!profile) return <><DashboardTopbar title="Profile Settings" /><div className="p-6"><div className="skeleton h-96 rounded-2xl" /></div></>;

  return (
    <>
      <DashboardTopbar title="Profile Settings" subtitle="Manage your account" fullName={profile.full_name} email={profile.email} />
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
              <select value={profile.country_code || ''} onChange={e => setProfile({ ...profile, country_code: e.target.value })} className="input-field">
                <option value="">Select...</option>
                {['US','GB','DE','FR','CA','AU','IN','PK','BR','MX','JP','OTHER'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
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
