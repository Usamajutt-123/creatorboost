'use client';
import Link from 'next/link';
import Image from "next/image";
import { usePathname } from 'next/navigation';
import { Home, Megaphone, PlusCircle, BarChart3, Wallet, Users, Wrench, User, Bell, HelpCircle, LogOut, Zap, Shield, Settings } from 'lucide-react';
import { signOutClient } from '@/lib/supabase/sign-out';
import { useRouter } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/dashboard/create-campaign', label: 'Create Campaign', icon: PlusCircle },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/withdraw', label: 'Withdraw', icon: Wallet },
  { href: '/dashboard/referrals', label: 'Referrals', icon: Users },
  { href: '/dashboard/tools', label: 'Tools', icon: Wrench },
];

const accountLinks = [
  { href: '/dashboard/settings', label: 'Profile', icon: User },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/support', label: 'Support', icon: HelpCircle },
];

export default function DashboardSidebar({ level, levelProgress, isAdmin, onClose }: {
  level: string;
  levelProgress: number;
  isAdmin?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await signOutClient();
    router.push('/');
  };

  const isActive = (href: string) => href === '/dashboard' ? pathname === href : pathname?.startsWith(href);

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

          <span className="font-display text-lg font-bold">Creator<span className="gradient-text">Boost</span></span>
        </Link>

        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3 px-3">Main</div>
        <nav className="space-y-1">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onClose}
              className={`sidebar-link ${isActive(l.href) ? 'active' : 'text-gray-400'}`}
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3 mt-6 px-3">Account</div>
        <nav className="space-y-1">
          {accountLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onClose}
              className={`sidebar-link ${isActive(l.href) ? 'active' : 'text-gray-400'}`}
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" onClick={onClose} className="sidebar-link text-gray-400">
              <Shield className="w-4 h-4" />
              Admin Panel
            </Link>
          )}
        </nav>

        <div className="mt-6 p-4 glass rounded-xl">
          <div className="text-xs text-gray-400 mb-1">Current Level</div>
          <div className="flex items-center justify-between mb-2">
            <span className={`badge badge-${level}`}>★ {level.charAt(0).toUpperCase() + level.slice(1)}</span>
            <span className="text-xs text-gray-500">{levelProgress}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-yellow-400 to-orange-500" style={{ width: `${levelProgress}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">Keep growing to level up!</p>
        </div>

        <button onClick={handleLogout} className="sidebar-link text-gray-400 w-full mt-4">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
