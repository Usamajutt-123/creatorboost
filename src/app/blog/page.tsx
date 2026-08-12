import Link from 'next/link';
import { BookOpen, ShieldCheck, WalletCards } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = { title: 'Blog', description: 'CreatorBoost product notes and creator workflow resources.' };

const topics = [
  { icon: BookOpen, title: 'Campaign setup', text: 'Create campaigns with an exact URL for every task, then share the public unlock link.' },
  { icon: ShieldCheck, title: 'Traffic eligibility', text: 'Understand the difference between browser-confirmed task openings and server-side traffic eligibility for earnings.' },
  { icon: WalletCards, title: 'Earnings lifecycle', text: 'Learn how view earnings move through pending, available, and withdrawal-held states.' },
];

export default function BlogPage() {
  return <><Navbar /><main className="min-h-screen pt-24 pb-12 hero-gradient"><div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8"><nav className="mb-8 text-sm text-gray-500"><Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Blog</span></nav><header className="text-center mb-12"><span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Resources</span><h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Creator <span className="gradient-text">resources</span></h1><p className="text-gray-400 max-w-2xl mx-auto">Product documentation and editorial publishing are being prepared. Until articles are published, the support center contains the current help material.</p></header><section className="grid sm:grid-cols-3 gap-5">{topics.map(topic => <article key={topic.title} className="glass rounded-2xl p-6 card-glow"><topic.icon className="w-7 h-7 text-purple-300 mb-4" /><h2 className="font-semibold mb-2">{topic.title}</h2><p className="text-sm text-gray-400 leading-relaxed">{topic.text}</p></article>)}</section><div className="text-center mt-10"><Link href="/support" className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white">Open support center</Link></div></div></main><Footer /></>;
}
