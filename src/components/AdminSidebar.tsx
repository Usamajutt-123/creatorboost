'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from "next/image";
import { usePathname } from 'next/navigation';
import { BarChart3, Users, Megaphone, Wallet, DollarSign, Network, Award, Settings, LogOut, ArrowLeft, LifeBuoy, BellRing } from 'lucide-react';
import { signOutClient } from '@/lib/supabase/sign-out';
import { useRouter } from 'next/navigation';
import { serverAdminMe } from '@/lib/admin-server';

const links = [
  { href: '/admin', label: 'Statistics', icon: BarChart3, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/admin/announcements', label: 'Announcements', icon: BellRing },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: Wallet },
  { href: '/admin/support', label: 'Support', icon: LifeBuoy },
  { href: '/admin/cpm', label: 'CPM Rates', icon: DollarSign },
  { href: '/admin/ads', label: 'Ad Networks', icon: Network },
  { href: '/admin/levels', label: 'Creator Levels', icon: Award },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

/**
 * `adminName`/`adminRole` are supplied by the admin layout, which has already
 * verified the session and loaded the profile server-side (same
 * `requireAuth()` + role check as before — nothing about who may see this
 * sidebar changed).
 *
 * They used to be resolved by a `serverAdminMe()` server action fired from a
 * mount effect. That action re-ran the auth + role verification over the
 * network, then triggered two `setState` calls. Because this component is
 * rendered **twice** on every admin page (the desktop rail and the mobile
 * drawer), each admin page load paid for two redundant POSTs and four extra
 * render passes — after the layout had already fetched exactly this data.
 *
 * The effect is kept only as a fallback for a caller that does not pass the
 * props, so behaviour is unchanged anywhere else.
 */
export default function AdminSidebar({ adminName: adminNameProp, adminRole: adminRoleProp }: {
  adminName?: string;
  adminRole?: string;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const hasServerIdentity = adminNameProp != null;
  const [adminName, setAdminName] = useState(adminNameProp ?? 'Admin');
  const [adminRole, setAdminRole] = useState(adminRoleProp ?? '');

  useEffect(() => {
    if (hasServerIdentity) return;
    serverAdminMe().then(me => {
      if (me.ok && me.admin) {
        setAdminName(me.admin.full_name || me.admin.email || 'Admin');
        setAdminRole(me.admin.role || 'admin');
      }
    }).catch(() => {});
  }, [hasServerIdentity]);

  const isActive = (href: string, exact?: boolean) => exact ? pathname === href : pathname?.startsWith(href);
  const handleLogout = async () => {
    await signOutClient();
    router.push('/');
  };

  return (
    <aside className="w-64 h-full glass-strong border-r border-white/5 overflow-y-auto">
      <div className="p-4">
        <Link href="/" className="flex items-center gap-2 mb-6">
          <Image
            src="/logo.png"
            alt="CreatorBoost"
            width={180}
            height={48}
            className="h-11 w-auto object-contain mt-1"
          />

          <span className="font-display text-lg font-bold">Creator<span className="gradient-text">Boost</span> Admin</span>
        </Link>

        <div className="mb-4 p-3 glass rounded-xl">
          <div className="text-xs text-gray-400">Logged in as</div>
          <div className="text-sm font-semibold flex items-center gap-2 mt-1">
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs text-white">
              {(adminName || 'A')[0]?.toUpperCase()}
            </span>
            <span className="truncate">{adminName}</span>
          </div>
          <div className="text-[10px] text-gray-500 capitalize mt-1">{adminRole.replace(/_/g, ' ')}</div>
        </div>

        <nav className="space-y-1">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`sidebar-link ${isActive(l.href, l.exact) ? 'active' : 'text-gray-400'}`}
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="mt-6 space-y-1">
          <Link href="/dashboard" className="sidebar-link text-gray-400">
            <ArrowLeft className="w-4 h-4" />
            Back to Creator
          </Link>
          <button onClick={handleLogout} className="sidebar-link text-gray-400 w-full">
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
