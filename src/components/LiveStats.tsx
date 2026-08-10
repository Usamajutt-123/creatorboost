export default function LiveStats() {
  const stats = [
    { v: '$2.4M+', l: 'Revenue paid to creators', i: '💰' },
    { v: '180+', l: 'Countries supported', i: '🌍' },
    { v: '$6', l: 'Maximum CPM (Tier 1)', i: '⚡' },
    { v: '99.7%', l: 'Fraud detection accuracy', i: '🛡️' },
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
