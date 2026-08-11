export default function EarningsCalculator() {
  const tiers = [
    {
      name: 'Tier 1 Country',
      sub: 'USA',
      per100k: 1500,
      color: 'from-green-500/10 to-emerald-500/10',
      icon: '🇺🇸',
      desc: 'per 100K valid views',
    },
    {
      name: 'Tier 2 Country',
      sub: 'France',
      per100k: 825,
      color: 'from-blue-500/10 to-cyan-500/10',
      icon: '🇫🇷',
      desc: 'per 100K valid views',
    },
    {
      name: 'Tier 3 Country',
      sub: 'India',
      per100k: 300,
      color: 'from-purple-500/10 to-pink-500/10',
      icon: '🇮🇳',
      desc: 'per 100K valid views',
    },
    {
      name: 'Mixed Global Traffic',
      sub: '40% T1 / 35% T2 / 25% T3',
      per100k: 850,
      color: 'from-yellow-500/10 to-orange-500/10',
      icon: '🌍',
      desc: 'per 100K valid views (avg)',
    },
  ];

  return (
    <section className="relative py-20 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Earnings Calculator</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Project Your <span className="gradient-text">Annual Revenue</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Illustrative projections only. Actual rates are configured by the platform and vary by country and creator level.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tiers.map(t => (
            <div key={t.name} className={`glass-strong rounded-2xl p-6 card-glow bg-gradient-to-br ${t.color}`}>
              <div className="text-3xl mb-3">{t.icon}</div>
              <div className="text-xs text-gray-400 mb-1">{t.name} ({t.sub})</div>
              <div className="text-2xl sm:text-3xl font-bold text-white mb-1">${t.per100k.toLocaleString()}</div>
              <div className="text-[10px] sm:text-xs text-gray-500 mb-3">{t.desc}</div>
              <div className="space-y-1 text-[10px] sm:text-xs">
                <div className="flex justify-between text-gray-400"><span>Gold level</span><span className="text-green-400 font-semibold">${(t.per100k * 1.25).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                <div className="flex justify-between text-gray-400"><span>Platinum</span><span className="text-green-400 font-semibold">${(t.per100k * 1.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                <div className="flex justify-between text-gray-400"><span>Diamond</span><span className="text-green-400 font-semibold">${(t.per100k * 2).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 glass-strong rounded-2xl p-6 sm:p-8">
          <h3 className="font-semibold mb-1">Annual projection</h3>
          <p className="text-xs text-gray-500 mb-5">Monthly visitors: 100,000 mixed traffic • Gold creator</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="glass rounded-xl p-4 text-center"><div className="text-[10px] sm:text-xs text-gray-500 mb-1">Monthly</div><div className="text-lg sm:text-xl font-bold gradient-text">$1,063</div></div>
            <div className="glass rounded-xl p-4 text-center"><div className="text-[10px] sm:text-xs text-gray-500 mb-1">Quarterly</div><div className="text-lg sm:text-xl font-bold gradient-text">$3,189</div></div>
            <div className="glass rounded-xl p-4 text-center"><div className="text-[10px] sm:text-xs text-gray-500 mb-1">Yearly</div><div className="text-lg sm:text-xl font-bold gradient-text">$12,756</div></div>
            <div className="glass rounded-xl p-4 text-center"><div className="text-[10px] sm:text-xs text-gray-500 mb-1">5 Years</div><div className="text-lg sm:text-xl font-bold gradient-text">$63,780</div></div>
          </div>
        </div>
      </div>
    </section>
  );
}
