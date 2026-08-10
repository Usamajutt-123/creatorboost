'use client';
import Link from 'next/link';
import { ArrowRight, Play, Sparkles, ShieldCheck, Users, Star, TrendingUp, Zap } from 'lucide-react';
import HeroChart from './HeroChart';

export default function Hero() {
  return (
    <section
      id="hero"
      className="hero-gradient relative min-h-[100svh] flex items-center pt-20 sm:pt-24 pb-12 sm:pb-16 overflow-hidden isolate"
    >


      {/* Top fade to seamlessly meet the navbar */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-[#05030d] to-transparent -z-10 pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 w-full grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        {/* LEFT — content */}
        <div className="lg:col-span-7 xl:col-span-7">
          {/* Trust badges row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-5 sm:mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-[11px] sm:text-xs font-medium text-purple-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
              Trusted by 12,000+ creators
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[11px] sm:text-xs font-medium text-yellow-300">
              <Star className="w-3 h-3 fill-yellow-300" /> 4.9 / 5.0 rating
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[11px] sm:text-xs font-medium text-blue-300">
              <ShieldCheck className="w-3 h-3" /> AI fraud protection
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-[2.4rem] leading-[1.05] sm:text-5xl md:text-6xl lg:text-[3.75rem] xl:text-[4.25rem] font-bold tracking-tight mb-5 sm:mb-6 glow-text">
            Monetize Your{' '}
            <span className="relative inline-block">
              <span className="gradient-text">Audience.</span>
              <svg className="absolute -bottom-1.5 left-0 w-full" viewBox="0 0 200 8" fill="none" aria-hidden="true">
                <path d="M2 5 Q 50 1, 100 4 T 198 4" stroke="url(#hero-underline)" strokeWidth="3" strokeLinecap="round" />
                <defs>
                  <linearGradient id="hero-underline" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#60a5fa" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <br />
            Get Paid For Every{' '}
            <span className="gradient-text">Valid Visitor.</span>
          </h1>

          {/* Subtitle */}
          <p className="w-full max-w-full pr-4 text-[15px] sm:text-lg leading-relaxed text-gray-400 mb-8">
            CreatorBoost helps creators monetize their audience through smart unlock campaigns. Create campaigns, share your link, and earn money for every{' '}
            <strong className="text-white font-semibold">1000 valid views</strong>. Powered by AI fraud detection and dynamic CPM rates.
          </p>

          {/* CTA row */}
          <div className="flex flex-wrap items-center gap-3 mb-8 sm:mb-10">
            <Link
              href="/signup"
              className="btn-primary text-white font-semibold px-4 sm:px-7 py-3 sm:py-3.5 rounded-xl flex items-center gap-2 text-sm group"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              className="btn-ghost text-white font-semibold px-5 sm:px-6 py-3 sm:py-3.5 rounded-xl flex items-center gap-2 text-sm"
            >
              <Play className="w-3 h-4" /> Watch Demo
            </a>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-gray-500 ml-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" /> No credit card required
            </span>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mr-9 sm:gap-3 max-w-2xl">
            {[
              { v: '$2.4M+', l: 'Revenue Paid', i: '💰' },
              { v: '180+', l: 'Countries', i: '🌍' },
              { v: '12K+', l: 'Active Creators', i: '⚡' },
              { v: '$6', l: 'Avg CPM (T1)', i: '🛡️' },
            ].map(s => (
              <div
                key={s.l}
                className="glass rounded-xl p-3 sm:p-4 text-center stat-card group hover:border-purple-500/40"
              >
                <div className="text-base sm:text-lg mb-0.5 group-hover:scale-110 transition-transform">{s.i}</div>
                <div className="text-lg sm:text-xl font-bold text-white leading-tight">{s.v}</div>
                <div className="text-[10px] sm:text-[11px] text-gray-500 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — dashboard mockup */}
        <div className="lg:col-span-5 xl:col-span-5 relative w-full min-w-0">
          <div className="absolute -inset-4 bg-gradient-to-tr from-purple-600/30 via-blue-600/20 to-pink-500/20 rounded-3xl blur-2xl" aria-hidden="true" />
          <div className="relative glass-strong rounded-2xl p-4 sm:p-5 card-glow shadow-2xl shadow-purple-900/20 w-full max-w-full overflow-hidden">
            {/* Mockup window chrome */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-400/80" />
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-yellow-400/80" />
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-400/80" />
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-gray-500 font-mono bg-black/30 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                creatorboost.io/dashboard
              </div>
            </div>

            {/* Top KPI cards */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 mb-3 sm:mb-4">
              <div className="glass rounded-xl p-3 sm:p-4 stat-card">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] sm:text-xs text-gray-400">Total Earnings</div>
                  <DollarSign className="w-3.5 h-3.5 text-green-400" />
                </div>
                <div className="text-base sm:text-xl font-bold text-white">$12,847.32</div>
                <div className="text-[10px] sm:text-xs text-green-400 mt-0.5 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> 23.5% this month
                </div>
              </div>
              <div className="glass rounded-xl p-3 sm:p-4 stat-card">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] sm:text-xs text-gray-400">Valid Views</div>
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="text-base sm:text-xl font-bold text-white">2.4M</div>
                <div className="text-[10px] sm:text-xs text-green-400 mt-0.5 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> 18.2%
                </div>
              </div>
            </div>

            {/* Revenue chart */}
            <div className="glass rounded-xl p-3 sm:p-4 h-44 sm:h-48 relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] sm:text-xs font-semibold text-gray-300">Revenue</span>
                <span className="text-[10px] text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Live
                </span>
              </div>
              <HeroChart />
            </div>

            {/* CPM + level cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-3 sm:mt-4">
              <div className="glass rounded-lg p-2.5 sm:p-3">
                <div className="text-[9px] sm:text-[10px] text-gray-500">CPM</div>
                <div className="text-sm sm:text-base font-bold gradient-text">$5.00</div>
              </div>
              <div className="glass rounded-lg p-2.5 sm:p-3">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Level</div>
                <div className="text-sm sm:text-base font-bold text-yellow-300 flex items-center gap-1">★ Gold</div>
              </div>
              <div className="glass rounded-lg p-2.5 sm:p-3">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Balance</div>
                <div className="text-sm sm:text-base font-bold text-white">$847</div>
              </div>
            </div>

            {/* Floating notification chip */}
            <div className="hidden md:flex absolute -left-3 top-6 glass-strong rounded-full pl-2 pr-4 py-1.5 items-center gap-2 shadow-xl shadow-purple-900/30 animate-float">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="leading-tight">
                <div className="text-[10px] text-gray-400">+ $24.50 just earned</div>
                <div className="text-[10px] font-semibold text-white">YT Subscribe Boost</div>
              </div>
            </div>
            <div className="hidden md:flex absolute -right-3 bottom-6 glass-strong rounded-full pl-2 pr-3 py-1.5 items-center gap-2 shadow-xl shadow-purple-900/30 animate-float" style={{ animationDelay: '-3s' }}>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-[10px] font-bold">★</div>
              <div className="leading-tight">
                <div className="text-[10px] text-gray-400">Level Up</div>
                <div className="text-[10px] font-semibold text-white">Gold Tier unlocked</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#05030d] to-transparent pointer-events-none" aria-hidden="true" />
    </section>
  );
}

// small inline icon used in the mockup
function DollarSign({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
