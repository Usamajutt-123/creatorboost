const countries = [
  { flag: '🇺🇸', name: 'United States', tier: 'Tier 1', tierCls: 'badge-gold', min: 4, cpm: 5, max: 6, payout: 70 },
  { flag: '🇬🇧', name: 'United Kingdom', tier: 'Tier 1', tierCls: 'badge-gold', min: 4, cpm: 5, max: 6, payout: 70 },
  { flag: '🇩🇪', name: 'Germany', tier: 'Tier 1', tierCls: 'badge-gold', min: 4, cpm: 5, max: 6, payout: 70 },
  { flag: '🇨🇦', name: 'Canada', tier: 'Tier 1', tierCls: 'badge-gold', min: 4, cpm: 5, max: 6, payout: 70 },
  { flag: '🇦🇺', name: 'Australia', tier: 'Tier 1', tierCls: 'badge-gold', min: 4, cpm: 5, max: 6, payout: 70 },
  { flag: '🇫🇷', name: 'France', tier: 'Tier 2', tierCls: 'badge-silver', min: 2, cpm: 2.75, max: 3.5, payout: 65 },
  { flag: '🇮🇹', name: 'Italy', tier: 'Tier 2', tierCls: 'badge-silver', min: 2, cpm: 2.75, max: 3.5, payout: 65 },
  { flag: '🇦🇪', name: 'UAE', tier: 'Tier 2', tierCls: 'badge-silver', min: 2.5, cpm: 3.25, max: 4, payout: 65 },
  { flag: '🇮🇳', name: 'India', tier: 'Tier 3', tierCls: 'badge-bronze', min: 0.5, cpm: 1, max: 1.5, payout: 60 },
  { flag: '🇵🇰', name: 'Pakistan', tier: 'Tier 3', tierCls: 'badge-bronze', min: 0.5, cpm: 1, max: 1.5, payout: 60 },
  { flag: '🇧🇷', name: 'Brazil', tier: 'Tier 3', tierCls: 'badge-bronze', min: 0.5, cpm: 1, max: 1.5, payout: 60 },
  { flag: '🇲🇽', name: 'Mexico', tier: 'Tier 3', tierCls: 'badge-bronze', min: 0.5, cpm: 1, max: 1.5, payout: 60 },
];

export default function CountryCpmTable() {
  return (
    <section className="relative py-20 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Country CPM</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Dynamic rates for <span className="gradient-text">every market</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">All CPM values are configurable by the admin. Edit any country from <code className="text-purple-300">/admin/cpm</code>.</p>
        </div>
        <div className="glass-strong rounded-2xl p-4 sm:p-5 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm min-w-[640px]">
            <thead>
              <tr className="text-[10px] sm:text-xs text-gray-500 border-b border-white/10">
                <th className="text-left py-2 font-medium">Country</th>
                <th className="text-left py-2 font-medium">Tier</th>
                <th className="text-left py-2 font-medium">Min CPM</th>
                <th className="text-left py-2 font-medium">Default CPM</th>
                <th className="text-left py-2 font-medium">Max CPM</th>
                <th className="text-left py-2 font-medium">Payout %</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {countries.map(c => (
                <tr key={c.name} className="border-b border-white/5 table-row">
                  <td className="py-3">{c.flag} {c.name}</td>
                  <td className="py-3"><span className={`badge ${c.tierCls}`}>{c.tier}</span></td>
                  <td className="py-3">${c.min.toFixed(2)}</td>
                  <td className="py-3 font-semibold">${c.cpm.toFixed(2)}</td>
                  <td className="py-3">${c.max.toFixed(2)}</td>
                  <td className="py-3">{c.payout}%</td>
                  <td className="py-3"><span className="badge status-active">active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
