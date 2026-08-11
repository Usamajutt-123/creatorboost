'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, Phone, Mail, MapPin, Send, ExternalLink } from 'lucide-react';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@creatorboost.io';
const WHATSAPP_NUMBER = '923209104702';
const WHATSAPP_DISPLAY = '+92 320 9104702';

export default function ContactForm() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ first: '', last: '', email: '', subject: 'General Inquiry', message: '' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first || !form.last || !form.email || !form.message) {
      toast.error('Please fill in all required fields');
      return;
    }
    setLoading(true);

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, to: SUPPORT_EMAIL }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to send. Please try again.');
        return;
      }
      toast.success('Message sent! We will reply within 24 hours.');
      setForm({ first: '', last: '', email: '', subject: 'General Inquiry', message: '' });
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openWhatsApp = () => {
    const text = encodeURIComponent('Hi CreatorBoost! I need help with...');
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <section id="contact" className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Get in touch</div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">We&apos;d love to <span className="gradient-text">hear from you</span></h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Questions about pricing, partnerships, or just want to say hi? Drop us a line.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="glass rounded-2xl p-5 text-center card-glow block">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-3 text-xl sm:text-2xl"><Mail className="w-5 h-5 text-white" /></div>
            <h3 className="font-semibold text-sm mb-1">Email</h3>
            <p className="text-xs text-gray-400 break-all">{SUPPORT_EMAIL}</p>
          </a>
          <button onClick={openWhatsApp} className="glass rounded-2xl p-5 text-center card-glow w-full">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-semibold text-sm mb-1">Live Chat (WhatsApp)</h3>
            <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
              <Phone className="w-3 h-3" /> {WHATSAPP_DISPLAY}
            </p>
          </button>
          <div className="glass rounded-2xl p-5 text-center card-glow">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-semibold text-sm mb-1">Help Center</h3>
            <p className="text-xs text-gray-400">FAQs and guides at /support</p>
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-5 sm:gap-6">
          <div className="glass-strong rounded-2xl p-5 sm:p-8">
            <h3 className="font-display text-xl sm:text-2xl font-bold mb-4">Send us a message</h3>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-300 block mb-1.5">First name *</label><input required value={form.first} onChange={e => setForm({ ...form, first: e.target.value })} className="input-field w-full px-4 py-3 rounded-xl text-sm" placeholder="John" /></div>
                <div><label className="text-xs text-gray-300 block mb-1.5">Last name *</label><input required value={form.last} onChange={e => setForm({ ...form, last: e.target.value })} className="input-field w-full px-4 py-3 rounded-xl text-sm" placeholder="Doe" /></div>
              </div>
              <div><label className="text-xs text-gray-300 block mb-1.5">Email *</label><input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-field w-full px-4 py-3 rounded-xl text-sm" placeholder="you@example.com" /></div>
              <div><label className="text-xs text-gray-300 block mb-1.5">Subject</label>
                <select value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="input-field w-full px-4 py-3 rounded-xl text-sm">
                  <option>General Inquiry</option><option>Sales</option><option>Partnership</option><option>Press</option><option>Bug Report</option><option>Account Help</option>
                </select>
              </div>
              <div><label className="text-xs text-gray-300 block mb-1.5">Message *</label><textarea required rows={5} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className="input-field w-full px-4 py-3 rounded-xl text-sm" placeholder="Tell us what's on your mind..."></textarea></div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {loading ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
          <div className="space-y-3 sm:space-y-4">
            <button onClick={openWhatsApp} className="glass-strong rounded-2xl p-5 sm:p-6 w-full text-left hover:bg-white/5 transition">
              <h4 className="font-semibold mb-2 text-sm sm:text-base flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-green-400" />
                Chat on WhatsApp
              </h4>
              <p className="text-xs text-gray-400 mb-3">Tap to open a WhatsApp chat with our team.</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                Chat Now <ExternalLink className="w-3 h-3" />
              </span>
            </button>
            <div className="glass-strong rounded-2xl p-5 sm:p-6">
              <h4 className="font-semibold mb-3 text-sm sm:text-base">Support hours</h4>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300">
                <li className="flex justify-between"><span>WhatsApp</span><span className="text-gray-400">Mon–Sat, 9am–9pm</span></li>
                <li className="flex justify-between"><span>Email response</span><span className="text-gray-400">&lt; 24h</span></li>
                <li className="flex justify-between"><span>Tickets</span><span className="text-purple-300">24/7 submission</span></li>
              </ul>
            </div>
            <div className="glass-strong rounded-2xl p-5 sm:p-6">
              <h4 className="font-semibold mb-2 text-sm sm:text-base">Need urgent help?</h4>
              <p className="text-xs text-gray-400 mb-3">Visit our help center for instant answers.</p>
              <a href="/support" className="btn-ghost w-full py-2 rounded-lg text-xs sm:text-sm block text-center">Visit Help Center</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}