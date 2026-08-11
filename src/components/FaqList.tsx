'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';

const FAQS = [
  { q: 'How much can I earn?', a: 'Earnings depend on valid views and country tier. Tier 1 countries pay $4-6 per 1000 valid views, Tier 2: $2-3.5, Tier 3: $0.5-1.5. Rates are fully configurable by admin.' },
  { q: 'When can I withdraw?', a: 'You can withdraw once your balance reaches the configured minimum. Withdrawals are processed within 24-48 hours via JazzCash, EasyPaisa, PayPal, Binance Pay, USDT, or Bank Transfer.' },
  { q: 'How does fraud detection work?', a: 'Traffic is verified on our servers: automated checks screen user agents, request frequency, IP reputation, VPN/proxy signals and device behavior before a view is counted as valid.' },
  { q: 'What payment methods are supported?', a: 'We support JazzCash, EasyPaisa, PayPal, Binance Pay, USDT (TRC20), and Bank Transfer. The admin can enable/disable any method from the dashboard.' },
  { q: 'How do I increase my CPM rate?', a: 'Level up! Higher creator levels (Bronze → Diamond) unlock progressively higher CPM multipliers and additional perks. Reach Diamond for a 2.0x CPM multiplier.' },
  { q: 'Is CreatorBoost free to use?', a: 'Yes! Creating an account and starting your first campaign is completely free.' },
  { q: 'Why is my view counted as invalid?', a: 'Views are validated server-side. Bots, automated traffic, VPN/proxy connections, repeated views from the same device/IP, and views from a suspended account do not earn.' },
  { q: 'What is the holding period?', a: 'Earnings enter a holding period (configurable by the admin) before they become available for withdrawal. This protects creators and advertisers from chargebacks and fraud.' },
];

export default function FaqList() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? FAQS.filter(f => (f.q + ' ' + f.a).toLowerCase().includes(q))
    : FAQS;

  return (
    <div className="glass-strong rounded-2xl p-6 max-w-3xl mx-auto">
      <div className="max-w-2xl mx-auto flex gap-2 mb-5">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input-field flex-1 px-5 py-3 rounded-xl text-sm"
          placeholder="Search for answers..."
          aria-label="Search frequently asked questions"
        />
        <span className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white flex items-center gap-2 cursor-default">
          <Search className="w-4 h-4" /> Search
        </span>
      </div>
      <h3 className="font-semibold mb-4">Frequently Asked Questions</h3>
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            No results for &ldquo;{query}&rdquo;. Try different keywords or email{' '}
            <a href="mailto:support@creatorboost.io" className="text-purple-400">support@creatorboost.io</a>.
          </p>
        )}
        {filtered.map((f, i) => (
          <details key={i} className="glass rounded-xl group">
            <summary className="cursor-pointer p-4 font-medium text-sm flex items-center justify-between list-none">
              {f.q}
              <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </summary>
            <div className="px-4 pb-4 text-sm text-gray-400">{f.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
