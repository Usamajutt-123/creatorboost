import { STEPS } from '@/lib/constants';

export default function Steps() {
  return (
    <section className="relative py-20 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">How it Works</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Start earning in <span className="gradient-text">5 simple steps</span></h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
          {STEPS.map(s => (
            <div key={s.n} className="glass rounded-2xl p-4 sm:p-5 text-center card-glow">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-2 sm:mb-3 text-base sm:text-xl font-bold shadow-lg shadow-purple-500/30">{s.n}</div>
              <div className="text-xl sm:text-2xl mb-1 sm:mb-2">{s.icon}</div>
              <h3 className="font-semibold mb-1 text-xs sm:text-sm">{s.title}</h3>
              <p className="text-[10px] sm:text-xs text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
