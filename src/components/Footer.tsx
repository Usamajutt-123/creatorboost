// Server Component. The single interactive control (back-to-top) lives in
// `BackToTopButton`, so this footer's markup, link tables and icons no longer
// enter the client bundle of every route that pulls in the root not-found
// boundary (which includes /dashboard and /admin, where no footer is rendered).
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Send } from 'lucide-react';
import BackToTopButton from '@/components/BackToTopButton';

const linkCols = [
  { title: 'Product', links: [{ href: '/#features', label: 'Features' }, { href: '/#how', label: 'How it works' }, { href: '/#calculator', label: 'Illustrative calculator' }, { href: '/signup', label: 'Create an account' }] },
  { title: 'Company', links: [{ href: '/about', label: 'About' }, { href: '/blog', label: 'Blog' }, { href: '/contact', label: 'Contact' }] },
  { title: 'Support', links: [{ href: '/support', label: 'Support center' }, { href: '/dashboard/support', label: 'Support tickets' }, { href: '/contact', label: 'Contact support' }] },
  { title: 'Legal', links: [{ href: '/terms', label: 'Terms of service' }, { href: '/privacy', label: 'Privacy policy' }] },
];

export default function Footer() {
  return <footer className="relative border-t border-white/5 pt-16 sm:pt-20 pb-6 sm:pb-8 bg-gradient-to-b from-[#05030d] to-[#02010a] overflow-hidden">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40rem] h-40 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid lg:grid-cols-12 gap-8 mb-12 sm:mb-16">
        <div className="lg:col-span-6"><Link href="/" className="inline-flex items-center gap-2 mb-4 group"><Image src="/logo.png" alt="CreatorBoost" width={180} height={48} className="h-11 w-auto object-contain mt-1" /><span className="font-display text-xl sm:text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span></Link><p className="text-sm text-gray-400 max-w-md">Creator monetization with configurable unlock campaigns, server-side traffic checks, and a real earnings ledger.</p></div>
        <div className="lg:col-span-4"><h2 className="font-semibold text-white mb-2 text-sm sm:text-base">Need help?</h2><p className="text-xs sm:text-sm text-gray-400 mb-4">Our support center and contact form are available whenever you need them.</p><div className="flex flex-wrap gap-2"><Link href="/support" className="btn-primary px-4 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2"><Send className="w-4 h-4" /> Support center</Link><a href="mailto:support@creatorboost.io" className="btn-ghost px-4 py-2.5 rounded-xl text-sm inline-flex items-center gap-2"><Mail className="w-4 h-4" /> Email support</a></div></div>
        <div className="lg:col-span-2 flex lg:justify-end items-start"><BackToTopButton /></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 pb-10 sm:pb-12 border-b border-white/5">{linkCols.map(column => <div key={column.title}><h2 className="font-semibold text-white mb-3 sm:mb-4 text-xs sm:text-sm">{column.title}</h2><ul className="space-y-2 sm:space-y-2.5">{column.links.map(link => <li key={link.href}><Link href={link.href} className="text-xs sm:text-sm text-gray-400 hover:text-white transition-colors">{link.label}</Link></li>)}</ul></div>)}</div>
      <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500"><span>© {new Date().getFullYear()} CreatorBoost</span><span>Built for creators</span></div>
    </div>
  </footer>;
}
