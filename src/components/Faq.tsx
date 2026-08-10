const faqs = [
  { q: 'How much can I earn?', a: 'Earnings depend on valid views and country tier. Tier 1: $4-6/1K views, Tier 2: $2-3.5, Tier 3: $0.5-1.5. Use the CPM calculator above.' },
  { q: 'When can I withdraw?', a: 'You can withdraw once your balance reaches $10. Payouts are processed within 24-48 hours.' },
  { q: 'How does fraud detection work?', a: 'Our AI analyzes 50+ signals including IP reputation, device fingerprinting, behavior patterns, VPN/proxy detection.' },
  { q: 'What payment methods are supported?', a: 'JazzCash, EasyPaisa, PayPal, Binance Pay, USDT (TRC20), and Bank Transfer.' },
  { q: 'How do I increase my CPM rate?', a: 'Level up! Bronze → Diamond unlocks higher CPM rates. Diamond = 100% CPM bonus plus dedicated account manager.' },
  { q: 'Is CreatorBoost free to use?', a: 'Yes! Creating an account and starting your first campaign is free. We only earn when you earn.' },
  { q: 'What are the 5 creator levels?', a: 'Bronze (1.0×), Silver (1.1×), Gold (1.25×), Platinum (1.5×), Diamond (2.0×). Each unlocks better rates and perks.' },
];

export default function Faq() {
  return (
    <section className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/20 to-transparent">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">FAQ</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold">Got <span className="gradient-text">questions?</span></h2>
        </div>
        <div className="space-y-2">
          {faqs.map((f, i) => (
            <details key={i} className="glass rounded-xl group" open={i === 0}>
              <summary className="cursor-pointer p-3 sm:p-4 font-medium text-xs sm:text-sm flex items-center justify-between list-none gap-2">
                <span>{f.q}</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div className="px-3 sm:px-4 pb-3 sm:pb-4 text-[10px] sm:text-xs text-gray-400 leading-relaxed">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
