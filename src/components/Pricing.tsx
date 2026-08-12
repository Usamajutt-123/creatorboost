import Link from 'next/link';
import { Check } from 'lucide-react';

const included = [
  'Creator dashboard and unlock campaigns',
  'Server-side view validation and earnings ledger',
  'Campaign, country, and device analytics',
  'Referral and withdrawal workflows',
];

export default function Pricing() {
  return <section id="pricing" className="relative py-20 sm:py-24"><div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8"><div className="text-center mb-10"><span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Platform access</span><h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Start with the <span className="gradient-text">creator workspace</span></h2><p className="text-gray-400 max-w-2xl mx-auto">CreatorBoost does not present unimplemented subscription tiers. Withdrawal minimums, methods, and any fees are shown from the live platform configuration when you request a payout.</p></div><div className="glass-strong rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto card-glow"><h3 className="font-display text-2xl font-bold mb-1">Creator account</h3><p className="text-sm text-gray-400 mb-5">Create campaigns and use the available creator tools after verifying your email.</p><ul className="space-y-3 text-sm text-gray-300 mb-6">{included.map(item => <li key={item} className="flex items-start gap-2"><Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />{item}</li>)}</ul><Link href="/signup" className="btn-primary block w-full text-center py-3 rounded-xl text-sm font-semibold text-white">Create an account</Link></div></div></section>;
}
