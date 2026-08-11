'use client';
import Link from 'next/link';
import Image from "next/image";
import { Zap, Twitter, Linkedin, Youtube, Instagram, MessageCircle, Github, ArrowUp, Send } from 'lucide-react';
import { useState } from 'react';

const linkCols = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#calculator', label: 'Earnings Calculator' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/#how', label: 'How it Works' },
      { href: '/blog', label: 'Changelog' },
      { href: '/blog', label: 'Roadmap' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About Us' },
      { href: '/blog', label: 'Blog' },
      { href: '/contact', label: 'Contact' },
      { href: '/contact', label: 'Careers' },
      { href: '/contact', label: 'Press Kit' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/support', label: 'Help Center' },
      { href: '/support', label: 'FAQs' },
      { href: '/blog', label: 'Creator Guides' },
      { href: '/contact', label: 'Contact Us' },
      { href: '/contact', label: 'API Status' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Cookie Policy' },
      { href: '/terms', label: 'DMCA' },
      { href: '/terms', label: 'Acceptable Use' },
    ],
  },
];

const socials = [
  { Icon: Twitter, href: '#', label: 'Twitter / X' },
  { Icon: Linkedin, href: '#', label: 'LinkedIn' },
  { Icon: Youtube, href: '#', label: 'YouTube' },
  { Icon: Instagram, href: '#', label: 'Instagram' },
  { Icon: MessageCircle, href: '#', label: 'Discord' },
  { Icon: Github, href: '#', label: 'GitHub' },
];

export default function Footer() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const subscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSubscribed(true);
    setEmail('');
    setTimeout(() => setSubscribed(false), 3000);
  };

  const scrollTop = () => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative border-t border-white/5 pt-16 sm:pt-20 pb-6 sm:pb-8 bg-gradient-to-b from-[#05030d] to-[#02010a] overflow-hidden">
      {/* Decorative gradient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40rem] h-40 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top: brand + newsletter + back-to-top */}
        <div className="grid lg:grid-cols-12 gap-8 mb-12 sm:mb-16">
          <div className="lg:col-span-5">
            <Link href="/" className="inline-flex items-center gap-2 mb-4 group">
              <Image
                src="/logo.png"
                alt="CreatorBoost"
                width={180}
                height={48}
                className="h-11 w-auto object-contain mt-1"
              />
              <span className="font-display text-xl sm:text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
            </Link>
            <p className="text-sm text-gray-400 max-w-md mb-5">
              The modern creator monetization platform. Earn from every valid view with smart unlock campaigns, server-side fraud detection, and dynamic CPM rates configured by you.
            </p>
            <div className="flex flex-wrap gap-2">
              {socials.map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="w-9 h-9 rounded-lg glass flex items-center justify-center hover:bg-white/10 hover:border-purple-500/40 transition-all hover:-translate-y-0.5"
                >
                  <Icon className="w-4 h-4 text-gray-300" />
                </a>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5">
            <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">Subscribe to creator insights</h3>
            <p className="text-xs sm:text-sm text-gray-400 mb-4">Get weekly growth tips, CPM updates, and creator stories.</p>
            <form onSubmit={subscribe} className="flex gap-2 max-w-md">
              <div className="relative flex-1">
                <Send className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@creator.com"
                  className="input-field pl-10"
                  aria-label="Email address"
                />
              </div>
              <button type="submit" className="btn-primary px-4 sm:px-5 py-3 rounded-xl text-sm font-semibold text-white whitespace-nowrap">
                {subscribed ? 'Subscribed ✓' : 'Subscribe'}
              </button>
            </form>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-2">No spam. Unsubscribe anytime.</p>
          </div>

          <div className="lg:col-span-2 flex lg:justify-end items-start">
            <button
              type="button"
              onClick={scrollTop}
              className="glass rounded-xl p-3 hover:bg-white/5 transition group"
              aria-label="Back to top"
            >
              <ArrowUp className="w-5 h-5 text-gray-300 group-hover:text-white transition" />
              <div className="text-[10px] text-gray-500 mt-1 group-hover:text-gray-300">Top</div>
            </button>
          </div>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 pb-10 sm:pb-12 border-b border-white/5">
          {linkCols.map(col => (
            <div key={col.title}>
              <h4 className="font-semibold text-white mb-3 sm:mb-4 text-xs sm:text-sm">{col.title}</h4>
              <ul className="space-y-2 sm:space-y-2.5">
                {col.links.map(l => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-xs sm:text-sm text-gray-400 hover:text-white transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span>© {new Date().getFullYear()} CreatorBoost, Inc.</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">All rights reserved.</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
              <span>All systems operational</span>
            </div>
            <span className="hidden sm:inline opacity-50">·</span>
            <span className="opacity-75">v2.4.1</span>
            <span className="hidden sm:inline opacity-50">·</span>
            <span>Made with 💜 for creators</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
