'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from "next/image";
import { usePathname } from 'next/navigation';
import { Zap, Menu, X, ArrowRight, Sparkles } from 'lucide-react';

const NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#calculator', label: 'Calculator' },
  { href: '/#how', label: 'How it Works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#blog', label: 'Blog' },
  { href: '/#contact', label: 'Contact' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled || open
          ? 'glass-strong border-b border-white/5 shadow-[0_1px_20px_rgba(0,0,0,0.4)]'
          : 'glass border-b border-transparent'
          }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo (left) */}
            <Link
              href="/"
              onClick={close}
              className="flex items-center gap-2 group flex-shrink-0"
              aria-label="CreatorBoost home"
            >
              <Image
                src="/logo.png"
                alt="CreatorBoost"
                width={180}
                height={48}
                className="h-11 w-auto object-contain mt-1"
              />

              <span className="font-display text-lg sm:text-xl font-bold whitespace-nowrap">
                Creator<span className="gradient-text">Boost</span>
              </span>
            </Link>

            {/* Nav (center, desktop) */}
            <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
              {NAV_LINKS.map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="menu-link px-3 py-1.5 text-sm font-medium text-gray-300 hover:text-white rounded-lg transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            {/* CTA (right, desktop) */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <Link
                href="/login"
                className="hidden sm:inline-flex text-sm font-medium text-gray-300 hover:text-white transition px-3 py-1.5"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="btn-primary text-xs sm:text-sm font-semibold px-3.5 sm:px-4 py-2 rounded-lg text-white whitespace-nowrap inline-flex items-center gap-1.5"
              >
                Get Started
                <ArrowRight className="w-3.5 h-3.5 hidden sm:inline" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="lg:hidden p-2 -mr-2 text-gray-300 hover:text-white"
                aria-label="Open menu"
                aria-expanded={open}
              >
                <Menu className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile overlay */}
      <div
        onClick={close}
        className={`fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        aria-hidden="true"
      />

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-[70] w-[82%] max-w-[360px] flex flex-col bg-[#0a0716]/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 ease-out lg:hidden ${open ? 'translate-x-0' : 'translate-x-full'
          }`}
        aria-label="Mobile navigation"
        aria-hidden={!open}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <Link href="/" onClick={close} className="flex items-center gap-2">

            <Image
              src="/logo.png"
              alt="CreatorBoost"
              width={180}
              height={48}
              className="h-11 w-auto object-contain mt-1"
            />

            <span className="font-display font-bold">Creator<span className="gradient-text">Boost</span></span>
          </Link>
          <button
            type="button"
            onClick={close}
            className="p-2 -mr-2 text-gray-300 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5" aria-label="Mobile primary">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={close}
              className="block px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <div className="h-px bg-white/5 my-3" />
          <Link
            href="/about"
            onClick={close}
            className="block px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            About
          </Link>
          <Link
            href="/blog"
            onClick={close}
            className="block px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            Blog
          </Link>
          <Link
            href="/support"
            onClick={close}
            className="block px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            Support
          </Link>
        </nav>

        {/* Drawer footer with auth buttons */}
        <div className="p-4 border-t border-white/10 space-y-2 flex-shrink-0">
          <Link
            href="/login"
            onClick={close}
            className="btn-ghost w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            onClick={close}
            className="btn-primary w-full py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
          >
            Get Started Free <ArrowRight className="w-4 h-4" />
          </Link>
          <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-gray-500">
            <Sparkles className="w-3 h-3 text-purple-400" /> Free forever. No card.
          </div>
        </div>
      </aside>
    </>
  );
}
