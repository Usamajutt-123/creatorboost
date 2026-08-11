import { TESTIMONIALS } from '@/lib/constants';

export default function Testimonials() {
  return (
    <section className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/20 to-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Testimonials</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold">Loved by <span className="gradient-text">creators</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto mt-3">Real stories from real creators earning with CreatorBoost every day.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="glass rounded-2xl p-4 sm:p-5 card-glow">
              <div className="flex items-center gap-1 mb-2 sm:mb-3 text-yellow-400 text-sm">★★★★★</div>
              <p className="text-[10px] sm:text-xs text-gray-300 mb-3 sm:mb-4 line-clamp-4">&ldquo;{t.text}&rdquo;</p>
              <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-white/5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center font-bold text-[10px] sm:text-sm flex-shrink-0">{t.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-[10px] sm:text-xs font-semibold truncate">{t.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{t.role}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
