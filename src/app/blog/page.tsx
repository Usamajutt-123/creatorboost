'use client';
import { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Link from 'next/link';

const posts = [
  { category: 'SEO Tips', title: '10 SEO Strategies That Actually Work in 2026', excerpt: 'Google\'s algorithm has changed dramatically. Here are the tactics top creators use to rank.', author: 'Alex Chen', date: 'Jan 12, 2026', read: '8 min', icon: '🔍', color: 'from-blue-500/20 to-cyan-500/20' },
  { category: 'Creator Guides', title: 'How to Reach Gold Tier in 90 Days', excerpt: 'A step-by-step playbook for hitting 1M valid views and unlocking 25% higher CPM.', author: 'Sarah Kim', date: 'Jan 8, 2026', read: '12 min', icon: '🏆', color: 'from-yellow-500/20 to-orange-500/20' },
  { category: 'Traffic Tips', title: 'The Tier 1 Traffic Playbook', excerpt: 'Where to find high-value visitors from USA, UK, and Germany — and how to convert them.', author: 'Marcus Lee', date: 'Jan 5, 2026', read: '10 min', icon: '🌍', color: 'from-purple-500/20 to-pink-500/20' },
  { category: 'Monetization', title: 'CPM Rates Explained: A Complete Guide', excerpt: 'Everything you need to know about how CreatorBoost calculates your earnings per 1000 views.', author: 'Priya Patel', date: 'Dec 28, 2025', read: '6 min', icon: '💰', color: 'from-green-500/20 to-emerald-500/20' },
  { category: 'Case Studies', title: 'How Sarah Grew From $200 to $8,400/Month', excerpt: 'A deep dive into one creator\'s journey, the strategies she used, and what you can learn.', author: 'Sarah Kim', date: 'Dec 20, 2025', read: '15 min', icon: '📈', color: 'from-pink-500/20 to-purple-500/20' },
  { category: 'Creator Guides', title: 'YouTube Algorithm Secrets for 2026', excerpt: 'What we learned analyzing 1,000 successful channels. The data tells a clear story.', author: 'Alex Chen', date: 'Dec 15, 2025', read: '9 min', icon: '🎬', color: 'from-red-500/20 to-pink-500/20' },
  { category: 'Traffic Tips', title: 'How to Spot Bot Traffic in 60 Seconds', excerpt: 'A practical guide to identifying low-quality visitors before they cost you money.', author: 'Marcus Lee', date: 'Dec 10, 2025', read: '7 min', icon: '🛡️', color: 'from-orange-500/20 to-red-500/20' },
  { category: 'Monetization', title: 'Maximize Earnings with Smart Task Selection', excerpt: 'Which task combinations convert best? Data from 10,000+ active campaigns.', author: 'Priya Patel', date: 'Dec 5, 2025', read: '11 min', icon: '⚡', color: 'from-indigo-500/20 to-violet-500/20' },
  { category: 'SEO Tips', title: 'YouTube SEO: Rank #1 in 2026', excerpt: 'The exact checklist we use for our top-performing videos. Updated for this year.', author: 'Alex Chen', date: 'Nov 28, 2025', read: '14 min', icon: '🎯', color: 'from-cyan-500/20 to-blue-500/20' },
];

const categories = ['All Posts', 'SEO Tips', 'Creator Guides', 'Traffic Tips', 'Monetization', 'Case Studies'];

export default function BlogPage() {
  const [filter, setFilter] = useState('All Posts');
  const filtered = filter === 'All Posts' ? posts : posts.filter(p => p.category === filter);

  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Blog</span>
          </nav>
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Blog</div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Creator <span className="gradient-text">insights & guides</span></h1>
            <p className="text-gray-400 max-w-2xl mx-auto">Actionable tips, growth strategies, and monetization guides from the CreatorBoost team.</p>
          </div>

          <div className="flex gap-2 mb-8 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
            {categories.map(c => (
              <button key={c} onClick={() => setFilter(c)} className={`tab-btn whitespace-nowrap ${filter === c ? 'active' : ''}`}>{c}</button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((p, i) => (
              <article key={i} className="glass rounded-2xl overflow-hidden card-glow cursor-pointer">
                <div className={`h-40 bg-gradient-to-br ${p.color} flex items-center justify-center text-5xl`}>{p.icon}</div>
                <div className="p-5">
                  <div className="text-xs text-purple-300 mb-2">{p.category}</div>
                  <h3 className="font-semibold mb-2 line-clamp-2">{p.title}</h3>
                  <p className="text-sm text-gray-400 mb-4 line-clamp-2">{p.excerpt}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[10px] font-bold">{p.author[0]}</div>
                      <span>{p.author} • {p.date}</span>
                    </div>
                    <span>{p.read}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
