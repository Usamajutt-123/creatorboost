'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  SlidersHorizontal,
  FileText,
  Megaphone,
  BarChart3,
  HandCoins,
  Network,
} from 'lucide-react';

const items = [
  { href: '/admin/monetization', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/monetization/settings', label: 'Settings', icon: SlidersHorizontal },
  { href: '/admin/monetization/content', label: 'Steps', icon: FileText },
  { href: '/admin/monetization/ads', label: 'Ads', icon: Megaphone },
  { href: '/admin/monetization/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/monetization/payouts', label: 'Payouts', icon: HandCoins },
  { href: '/admin/ads', label: 'Ad Networks', icon: Network },
];

export default function MonetizationNav() {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname?.startsWith(href);

  return (
    <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-6 scrollbar-thin" aria-label="Monetization sections">
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
            isActive(item.href, item.exact)
              ? 'bg-purple-500/15 border-purple-500/40 text-purple-200'
              : 'glass border-white/10 text-gray-400 hover:text-white hover:border-white/20'
          }`}
        >
          <item.icon className="w-3.5 h-3.5" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
