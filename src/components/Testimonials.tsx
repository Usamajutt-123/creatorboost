const principles = [
  { title: 'Exact task links', text: 'Every configured task uses the creator’s persisted URL. The unlock flow does not substitute a generic platform URL.', icon: '🔗' },
  { title: 'Server-side earnings', text: 'Country, CPM, fraud signals, accounting, and balance movements are derived on the server and in protected database functions.', icon: '🛡️' },
  { title: 'Clear earning states', text: 'Pending earnings, available balance, and withdrawal holds remain separate throughout the payout lifecycle.', icon: '💰' },
  { title: 'Real dashboard data', text: 'Campaign, country, device, and earnings displays are sourced from recorded database data rather than mock analytics.', icon: '📊' },
];

export default function Testimonials() {
  return <section className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/20 to-transparent"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="text-center mb-12"><span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Platform principles</span><h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold">Designed for <span className="gradient-text">creator confidence</span></h2><p className="text-gray-400 max-w-2xl mx-auto mt-3">The product focuses on transparent configuration and server-enforced platform rules rather than unsupported performance claims.</p></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">{principles.map(principle => <article key={principle.title} className="glass rounded-2xl p-5 card-glow"><span className="text-2xl" aria-hidden="true">{principle.icon}</span><h3 className="font-semibold mt-3 mb-2">{principle.title}</h3><p className="text-xs text-gray-400 leading-relaxed">{principle.text}</p></article>)}</div></div></section>;
}
