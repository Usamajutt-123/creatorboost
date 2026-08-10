import Link from 'next/link';
import { Check } from 'lucide-react';

const plans = [
  { name: 'Free', price: '$0', desc: 'Forever, no card required', cta: 'Get Started', ctaLink: '/signup', featured: false, features: ['1 active campaign', 'Bronze tier', 'Standard CPM rates', 'Email support', 'Basic analytics'] },
  { name: 'Starter', price: '5%', desc: 'platform fee, billed on earnings', cta: 'Start Trial', ctaLink: '/signup', featured: false, features: ['5 active campaigns', 'Up to Silver tier', '+10% CPM boost', 'Priority support', 'Advanced analytics'] },
  { name: 'Professional', price: '3%', desc: 'platform fee, billed on earnings', cta: 'Get Professional', ctaLink: '/signup', featured: true, badge: 'POPULAR', features: ['Unlimited campaigns', 'Up to Gold tier', '+25% CPM boost', '24/7 chat support', 'Premium analytics', 'Verified badge'] },
  { name: 'Enterprise', price: 'Custom', desc: 'volume-based, contact sales', cta: 'Contact Sales', ctaLink: '/contact', featured: false, features: ['Everything in Pro', 'Diamond tier access', '+100% CPM boost', 'Dedicated manager', 'Custom integrations', 'SLA guarantee'] },
];

export default function Pricing() {
  return (
    <section id="pricing" className="relative py-20 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Pricing</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Simple, <span className="gradient-text">creator-first</span> pricing</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Pay only when you earn. No upfront fees, no monthly minimums.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {plans.map(p => (
            <div key={p.name} className={`glass-strong rounded-2xl p-5 sm:p-6 card-glow relative ${p.featured ? 'ring-2 ring-yellow-500/50' : ''}`}>
              {p.badge && <div className="absolute -top-2 right-4 bg-gradient-to-r from-yellow-500 to-orange-500 text-[10px] font-bold px-2 py-0.5 rounded-full">{p.badge}</div>}
              <div className="text-xs text-gray-400 mb-1">{p.name}</div>
              <div className="text-2xl sm:text-3xl font-bold mb-1">{p.price}</div>
              <div className="text-[10px] sm:text-xs text-gray-500 mb-4">{p.desc}</div>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300 mb-5">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2"><Check className="w-3 h-3 text-green-400 flex-shrink-0" /><span>{f}</span></li>
                ))}
              </ul>
              <Link href={p.ctaLink} className={`block w-full text-center py-2.5 rounded-xl text-xs sm:text-sm font-semibold ${p.featured ? 'btn-primary text-white' : 'btn-ghost text-white'}`}>{p.cta}</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
