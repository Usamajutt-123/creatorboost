'use client';
import { useState } from 'react';
import { Menu, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import NotificationBell from '@/components/NotificationBell';

export default function DashboardTopbar({ title, subtitle, onMenu, fullName, email, avatar, userId }: {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
  fullName?: string;
  email?: string;
  avatar?: string;
  /** Passed by server pages so the bell can skip its own auth round-trip. */
  userId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-30 glass-strong border-b border-white/5">
      <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-4">


        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                if (title === "Admin Panel") {
                  (window as any).openAdminMobileSidebar?.();
                } else {
                  (window as any).openMobileSidebar?.();
                }
              }
            }}
            className="lg:hidden p-2 rounded-lg hover:bg-white/10 text-gray-300"
          >
            <Menu className="w-5 h-5" />
          </button>


          <div>
            <h1 className="font-display text-lg font-bold">{title}</h1>
            {subtitle && <p className="text-xs text-gray-500 hidden sm:block">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell userId={userId} />
          <div className="relative">
            <button onClick={() => setOpen(!open)} className="flex items-center gap-2 pl-2 pr-1 py-1 border-l border-white/10 hover:bg-white/5 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-bold">
                {avatar || (fullName?.[0]?.toUpperCase()) || 'U'}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-semibold leading-tight">{fullName || 'User'}</div>
                <div className="text-[10px] text-gray-500 leading-tight">{email || ''}</div>
              </div>
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-48 glass-strong rounded-xl p-2 shadow-2xl z-50">
                <div className="px-3 py-2 border-b border-white/5">
                  <div className="text-xs font-semibold">{fullName}</div>
                  <div className="text-xs text-gray-500 truncate">{email}</div>
                </div>
                <button onClick={handleLogout} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 rounded-lg flex items-center gap-2 text-red-300">
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
