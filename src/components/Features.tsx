import { FEATURES } from '@/lib/constants';

export default function Features() {
  return (
    <section id="features" className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Features</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Everything you need to <span className="gradient-text">monetize</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Powerful tools designed for modern creators. From unlock campaigns to server-side fraud detection, we&apos;ve got you covered.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {FEATURES.map((f, i) => (
            <div key={i} className="glass rounded-2xl p-4 sm:p-6 card-glow relative overflow-hidden">
              <div className="absolute -top-4 -right-4 w-20 h-20 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-full blur-2xl"></div>
              <div className="text-2xl sm:text-3xl mb-2 sm:mb-3 relative">{f.icon}</div>
              <h3 className="font-semibold text-sm sm:text-base mb-1 relative">{f.title}</h3>
              <p className="text-[10px] sm:text-xs text-gray-400 relative">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
