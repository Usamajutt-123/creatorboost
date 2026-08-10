import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function CtaBanner() {
  return (
    <section className="relative py-12 sm:py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative glass-strong rounded-3xl p-6 sm:p-10 text-center overflow-hidden">
          <div className="absolute -top-16 -left-16 w-64 h-64 bg-purple-600/30 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-16 -right-16 w-64 h-64 bg-blue-600/30 rounded-full blur-3xl"></div>
          <div className="relative">
            <h2 className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold mb-3">Ready to <span className="gradient-text">boost</span> your earnings?</h2>
            <p className="text-xs sm:text-base text-gray-400 mb-6 max-w-xl mx-auto">Join 12,000+ creators already monetizing their audience. Free to start, no credit card required.</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href="/signup" className="btn-primary text-white font-semibold px-6 sm:px-7 py-3 sm:py-3.5 rounded-xl flex items-center gap-2 text-sm">Start Earning Today <ArrowRight className="w-4 h-4" /></Link>
              <Link href="/contact" className="btn-ghost text-white font-semibold px-6 sm:px-7 py-3 sm:py-3.5 rounded-xl text-sm">Contact Sales</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
