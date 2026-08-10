import Link from 'next/link';

const posts = [
  { category: 'SEO Tips', title: '10 SEO Strategies That Actually Work in 2026', excerpt: 'Google\'s algorithm has changed. Here are the tactics top creators use to rank.', author: 'Alex Chen', date: 'Jan 12', read: '8 min', icon: '🔍', color: 'from-blue-500/20 to-cyan-500/20' },
  { category: 'Creator Guides', title: 'How to Reach Gold Tier in 90 Days', excerpt: 'A step-by-step playbook for hitting 1M valid views and unlocking 25% higher CPM.', author: 'Sarah Kim', date: 'Jan 8', read: '12 min', icon: '🏆', color: 'from-yellow-500/20 to-orange-500/20' },
  { category: 'Traffic Tips', title: 'The Tier 1 Traffic Playbook', excerpt: 'Where to find high-value visitors from USA, UK, and Germany.', author: 'Marcus Lee', date: 'Jan 5', read: '10 min', icon: '🌍', color: 'from-purple-500/20 to-pink-500/20' },
  { category: 'Monetization', title: 'CPM Rates Explained: A Complete Guide', excerpt: 'Everything you need to know about how CreatorBoost calculates your earnings.', author: 'Priya Patel', date: 'Dec 28', read: '6 min', icon: '💰', color: 'from-green-500/20 to-emerald-500/20' },
  { category: 'Case Studies', title: 'How Sarah Grew From $200 to $8,400/Month', excerpt: 'A deep dive into one creator\'s journey and the strategies she used.', author: 'Sarah Kim', date: 'Dec 20', read: '15 min', icon: '📈', color: 'from-pink-500/20 to-purple-500/20' },
  { category: 'Creator Guides', title: 'YouTube Algorithm Secrets for 2026', excerpt: 'What we learned analyzing 1,000 successful channels.', author: 'Alex Chen', date: 'Dec 15', read: '9 min', icon: '🎬', color: 'from-red-500/20 to-pink-500/20' },
];

export default function BlogPreview() {
  return (
    <section className="relative py-20 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-12 flex-wrap gap-3">
          <div>
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-2">From the blog</div>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Tips, guides & <span className="gradient-text">insights</span></h2>
          </div>
          <Link href="/blog" className="text-xs sm:text-sm text-purple-400 hover:text-purple-300">View all posts →</Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {posts.map((p, i) => (
            <article key={i} className="glass rounded-2xl overflow-hidden card-glow cursor-pointer">
              <div className={`h-32 sm:h-40 bg-gradient-to-br ${p.color} flex items-center justify-center text-4xl sm:text-5xl`}>{p.icon}</div>
              <div className="p-4 sm:p-5">
                <div className="text-[10px] sm:text-xs text-purple-300 mb-1 sm:mb-2">{p.category}</div>
                <h3 className="font-semibold mb-1 sm:mb-2 line-clamp-2 text-xs sm:text-sm">{p.title}</h3>
                <p className="text-[10px] sm:text-xs text-gray-400 mb-3 sm:mb-4 line-clamp-2">{p.excerpt}</p>
                <div className="flex items-center justify-between text-[10px] sm:text-xs text-gray-500">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[9px] sm:text-[10px] font-bold flex-shrink-0">{p.author[0]}</div>
                    <span className="truncate">{p.author} • {p.date}</span>
                  </div>
                  <span className="flex-shrink-0">{p.read}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
