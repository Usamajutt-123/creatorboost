'use client';
import { useState } from 'react';
import { Mail, MessageCircle, MapPin, Send } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Select from '@/components/Select';
import Link from 'next/link';
import { toast } from 'sonner';


export default function ContactClient() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', subject: 'General Inquiry', message: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not send your message. Please try again.');
        return;
      }
      toast.success(data.message || 'Thanks! We will reply within 24 hours.');
      setForm({ firstName: '', lastName: '', email: '', subject: 'General Inquiry', message: '' });
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Contact</span>
          </nav>
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Get in touch</div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">We&apos;d love to <span className="gradient-text">hear from you</span></h1>
            <p className="text-gray-400 max-w-2xl mx-auto">Questions about pricing, partnerships, or just want to say hi? Drop us a line.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              { icon: Mail, title: 'Email', desc: 'support@creatorboost.io' },
              { icon: MessageCircle, title: 'Response Time', desc: 'Within 24 hours' },
              { icon: MapPin, title: 'Help Center', desc: 'Visit /support for FAQs' },
            ].map(s => (
              <div key={s.title} className="glass rounded-2xl p-5 text-center card-glow">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-3">
                  <s.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{s.title}</h3>
                <p className="text-xs text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="glass-strong rounded-2xl p-6 sm:p-8">
              <h3 className="font-display text-2xl font-bold mb-4">Send us a message</h3>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-300 block mb-1.5">First name</label>
                    <input required value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})} className="input-field" placeholder="John" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-300 block mb-1.5">Last name</label>
                    <input required value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})} className="input-field" placeholder="Doe" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-300 block mb-1.5">Email</label>
                  <input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" placeholder="you@example.com" />
                </div>
                <div>
                  <label className="text-xs text-gray-300 block mb-1.5">Subject</label>
                  <Select value={form.subject} onChange={value => setForm({...form, subject: value})} ariaLabel="Subject" options={[
                    { value: 'General Inquiry', label: 'General Inquiry' },
                    { value: 'Sales', label: 'Sales' },
                    { value: 'Partnership', label: 'Partnership' },
                    { value: 'Press', label: 'Press' },
                    { value: 'Bug Report', label: 'Bug Report' },
                  ]} />
                </div>
                <div>
                  <label className="text-xs text-gray-300 block mb-1.5">Message</label>
                  <textarea required rows={5} value={form.message} onChange={e => setForm({...form, message: e.target.value})} className="input-field" placeholder="Tell us what's on your mind..." />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                  <Send className="w-4 h-4" /> {loading ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            </div>

            <div className="space-y-4">
              <div className="glass-strong rounded-2xl p-6">
                <h4 className="font-semibold mb-3">Support options</h4>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li>Submit a support ticket from your dashboard after signing in.</li>
                  <li>Use the contact form for public questions and partnership requests.</li>
                  <li>Ticket replies remain attached to the original request for privacy.</li>
                </ul>
              </div>
              <div className="glass-strong rounded-2xl p-6">
                <h4 className="font-semibold mb-3">More resources</h4>
                <div className="grid grid-cols-3 gap-2">
                  <Link href="/support" className="glass rounded-lg p-3 text-center text-xs hover:bg-white/5 transition">Support</Link>
                  <Link href="/blog" className="glass rounded-lg p-3 text-center text-xs hover:bg-white/5 transition">Blog</Link>
                  <Link href="/about" className="glass rounded-lg p-3 text-center text-xs hover:bg-white/5 transition">About</Link>
                </div>
              </div>
              <div className="glass-strong rounded-2xl p-6">
                <h4 className="font-semibold mb-2">Need urgent help?</h4>
                <p className="text-xs text-gray-400 mb-3">Visit our help center for instant answers to common questions.</p>
                <Link href="/support" className="btn-ghost w-full py-2 rounded-lg text-sm block text-center">Visit Help Center</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
