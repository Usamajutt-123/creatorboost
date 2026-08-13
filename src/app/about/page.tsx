import { Heart, Shield, Target, Zap } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AboutBuilder from '@/components/AboutBuilder';
import Link from 'next/link';

export const metadata = { title: 'About', description: 'Learn how CreatorBoost is designed to give creators a transparent unlock-campaign workflow.' };

const values = [
  { icon: Target, title: 'Clear creator controls', desc: 'Creators configure their own task URLs, destination links, and campaign availability.' },
  { icon: Shield, title: 'Security by design', desc: 'Financial calculations, authorization, and traffic decisions are made on the server and protected by database policies.' },
  { icon: Heart, title: 'Transparent lifecycle', desc: 'Pending, available, and withdrawal-held earnings are tracked separately so balances remain understandable.' },
  { icon: Zap, title: 'Focused workflow', desc: 'Campaign creation, sharing, unlocks, analytics, and support are built into one creator dashboard.' },
];

export default function AboutPage() {
  return <><Navbar /><main className="min-h-screen pt-24 pb-12 hero-gradient"><div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8"><nav className="mb-8 text-sm text-gray-500"><Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">About</span></nav><header className="text-center mb-12"><span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">About CreatorBoost</span><h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Built around a safer <span className="gradient-text">creator workflow</span></h1><p className="text-gray-400 max-w-2xl mx-auto">CreatorBoost is a creator monetization platform for configuring task-based unlock campaigns while keeping campaign ownership, traffic validation, and earnings logic server controlled.</p></header>
    <section className="grid sm:grid-cols-2 gap-4 mb-12">{values.map(value => <article key={value.title} className="glass rounded-2xl p-6 card-glow"><value.icon className="w-6 h-6 text-purple-300 mb-3" /><h2 className="font-semibold mb-2">{value.title}</h2><p className="text-sm text-gray-400 leading-relaxed">{value.desc}</p></article>)}</section>
    <AboutBuilder />
    <section className="grid lg:grid-cols-2 gap-6 mb-12"><div className="glass-strong rounded-2xl p-6 sm:p-8"><h2 className="font-display text-2xl font-bold mb-3">What the platform does</h2><p className="text-sm text-gray-400 leading-relaxed">A creator builds a campaign, adds an exact URL for every task, shares the public unlock page, and sees recorded traffic and earnings in their dashboard. Visitors receive the creator&apos;s destination only after completing the browser-confirmed task flow.</p></div><div className="glass-strong rounded-2xl p-6 sm:p-8"><h2 className="font-display text-2xl font-bold mb-3">What we do not claim</h2><p className="text-sm text-gray-400 leading-relaxed">Third-party platforms do not provide CreatorBoost with universal proof of a follow, like, or subscription. The product clearly distinguishes browser-confirmed task openings from server-side traffic eligibility for earnings.</p></div></section>
    <section className="text-center"><h2 className="font-display text-2xl font-bold mb-3">Have a question?</h2><p className="text-sm text-gray-400 mb-6">Reach the team through the support center or create your first campaign.</p><div className="flex flex-wrap justify-center gap-3"><Link href="/support" className="btn-ghost px-6 py-3 rounded-xl text-sm">Get support</Link><Link href="/signup" className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white">Create an account</Link></div></section>
  </div></main><Footer /></>;
}
