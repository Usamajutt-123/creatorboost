import { LEVELS } from '@/lib/constants';

export default function Levels() {
  return (
    <section className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Creator Levels</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Level up to unlock <span className="gradient-text">higher CPM</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Default level examples are shown below. Live thresholds, multipliers, and benefits are configured by the platform administrator and applied server-side.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-10 sm:mb-12">
          {LEVELS.map((l, i) => (
            <div key={l.level} className={`glass rounded-2xl p-4 sm:p-5 card-glow ${i === 2 ? 'ring-2 ring-yellow-500/50 bg-gradient-to-br from-yellow-500/5 to-orange-500/5' : ''}`}>
              {i === 2 && <div className="text-[10px] sm:text-xs text-yellow-300 font-semibold mb-1">⭐ POPULAR</div>}
              <div className="text-2xl sm:text-3xl mb-1 sm:mb-2">{l.icon}</div>
              <h3 className="font-display text-base sm:text-lg font-bold mb-1">{l.name}</h3>
              <div className="text-[10px] sm:text-xs text-gray-400 mb-2 sm:mb-3">From {(l.min / 1000).toFixed(0)}K views</div>
              <div className="text-lg sm:text-2xl font-bold gradient-text mb-2 sm:mb-3">${l.cpm}<span className="text-[10px] sm:text-xs text-gray-400">/1K</span></div>
              <ul className="space-y-1">
                {l.perks.slice(0, 3).map((p, j) => (
                  <li key={j} className="text-[10px] sm:text-xs text-gray-300 flex items-start gap-1.5">
                    <span className="text-purple-400 flex-shrink-0">✓</span><span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-center mb-6 sm:mb-8">
          <h3 className="font-display text-xl sm:text-2xl font-bold mb-1">Compare features</h3>
          <p className="text-xs sm:text-sm text-gray-500">All plans include core features. Higher tiers unlock more.</p>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-6 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm min-w-[640px]">
            <thead>
              <tr className="text-[10px] sm:text-xs text-gray-500 border-b border-white/10">
                <th className="text-left py-3 font-medium">Feature</th>
                <th className="py-3 font-medium">Bronze</th>
                <th className="py-3 font-medium">Silver</th>
                <th className="py-3 font-medium text-yellow-300">Gold</th>
                <th className="py-3 font-medium">Platinum</th>
                <th className="py-3 font-medium">Diamond</th>
              </tr>
            </thead>
            <tbody className="text-center">
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">CPM Multiplier</td><td className="py-3">1.0×</td><td className="py-3">1.1×</td><td className="py-3 text-yellow-300 font-semibold">1.25×</td><td className="py-3">1.5×</td><td className="py-3">2.0×</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Min Views Required</td><td className="py-3">0</td><td className="py-3">100K</td><td className="py-3 text-yellow-300">1M</td><td className="py-3">5M</td><td className="py-3">10M</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Verified Badge</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">✓</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Priority Support</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">VIP</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Fast Withdrawals</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">Instant</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Premium Analytics</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td><td className="py-3 text-green-400">✓</td></tr>
              <tr className="border-b border-white/5"><td className="text-left py-3 text-gray-400">Account Manager</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td></tr>
              <tr><td className="text-left py-3 text-gray-400">Custom Features</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-gray-600">—</td><td className="py-3 text-green-400">✓</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
