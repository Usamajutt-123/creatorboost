import { Users, Target, Heart, Zap, Shield } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Link from 'next/link';

export const metadata = { title: 'About Us', description: 'Built by creators, for creators. Learn about CreatorBoost mission and team.' };

const team = [
  { name: 'Alex Chen', role: 'Founder & CEO', initial: 'A' },
  { name: 'Sarah Kim', role: 'Head of Product', initial: 'S' },
  { name: 'Marcus Lee', role: 'Engineering Lead', initial: 'M' },
  { name: 'Priya Patel', role: 'Creator Success', initial: 'P' },
];

const values = [
  { icon: Target, title: 'Transparency First', desc: 'Every CPM rate, every fee, every payout — visible to creators.' },
  { icon: Heart, title: 'Fairness Always', desc: 'We pay out 70%+ to creators. The platform only wins when creators win.' },
  { icon: Shield, title: 'Quality Over Quantity', desc: 'Server-side fraud detection ensures only real views are rewarded.' },
  { icon: Zap, title: 'Creators Are Partners', desc: 'Our success is built on theirs — and we never forget it.' },
];

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">About</span>
          </nav>
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">About Us</div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Built by creators, <span className="gradient-text">for creators</span></h1>
            <p className="text-gray-400 max-w-2xl mx-auto">CreatorBoost started with a simple mission: give every creator a fair, transparent way to monetize their audience.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-12">
            {[
              { v: '$2.4M+', l: 'Paid to creators' },
              { v: '12,000+', l: 'Active creators' },
              { v: '180+', l: 'Countries served' },
            ].map(s => (
              <div key={s.l} className="glass rounded-2xl p-6 text-center stat-card">
                <div className="text-3xl font-bold gradient-text mb-1">{s.v}</div>
                <div className="text-xs text-gray-400">{s.l}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-12">
            <div className="glass-strong rounded-2xl p-6 sm:p-8">
              <h3 className="font-display text-2xl font-bold mb-3">Our Story</h3>
              <p className="text-sm text-gray-400 mb-3 leading-relaxed">We started in 2023 when our founder, a YouTuber with 500K subscribers, realized that traditional monetization platforms were opaque, slow, and unfair to creators. We built CreatorBoost to fix that.</p>
              <p className="text-sm text-gray-400 leading-relaxed">Today, CreatorBoost is a global platform with a team of 30+ engineers, designers, and creator-success specialists. We&apos;re profitable, independent, and creator-funded.</p>
            </div>
            <div className="glass-strong rounded-2xl p-6 sm:p-8">
              <h3 className="font-display text-2xl font-bold mb-3">Our Values</h3>
              <ul className="space-y-3 text-sm text-gray-300">
                <li className="flex items-start gap-2"><span className="text-purple-400 mt-1">●</span> <span><strong>Transparency first.</strong> Every CPM rate, every fee, every payout — visible to creators.</span></li>
                <li className="flex items-start gap-2"><span className="text-purple-400 mt-1">●</span> <span><strong>Fairness always.</strong> We pay out 70%+ to creators. The platform only wins when creators win.</span></li>
                <li className="flex items-start gap-2"><span className="text-purple-400 mt-1">●</span> <span><strong>Quality over quantity.</strong> Server-side fraud detection ensures only real views are rewarded.</span></li>
                <li className="flex items-start gap-2"><span className="text-purple-400 mt-1">●</span> <span><strong>Creators are partners.</strong> Our success is built on theirs.</span></li>
              </ul>
            </div>
          </div>

          <div className="glass-strong rounded-2xl p-6 sm:p-8 mb-12">
            <h3 className="font-display text-2xl font-bold mb-6 text-center">Meet the team</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {team.map(t => (
                <div key={t.name} className="glass rounded-xl p-4 text-center card-glow">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 mx-auto mb-3 flex items-center justify-center text-2xl font-bold">{t.initial}</div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-gray-500">{t.role}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center">
            <h3 className="font-display text-2xl font-bold mb-3">Want to join us?</h3>
            <p className="text-sm text-gray-400 mb-6">We&apos;re always looking for talented people who care about creators.</p>
            <Link href="/contact" className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2">
              Get in touch
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
