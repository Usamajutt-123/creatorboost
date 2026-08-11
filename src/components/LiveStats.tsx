export default function LiveStats() {
  // Figures shown here are illustrative examples, not audited platform
  // metrics, until real revenue analytics are wired to live ad networks.
  const stats = [
    { v: '100%', l: 'Server-side view verification', i: '💰' },
    { v: 'Tier 1–3', l: 'Country CPM tiers (admin-configurable)', i: '🌍' },
    { v: '24h', l: 'Default earnings holding period', i: '⚡' },
    { v: 'Fraud-aware', l: 'Traffic is verified on our servers', i: '🛡️' },
  ];
  return (
    <section className="relative py-14 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {stats.map(s => (
            <div key={s.l} className="glass rounded-2xl p-5 sm:p-6 text-center stat-card">
              <div className="text-3xl sm:text-4xl mb-2">{s.i}</div>
              <div className="text-xl sm:text-2xl font-bold gradient-text">{s.v}</div>
              <div className="text-[10px] sm:text-xs text-gray-500 mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
