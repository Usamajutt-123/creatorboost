'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, MapPin, Send, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import Select from '@/components/Select';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@creatorboost.io';

export default function ContactForm() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ first: '', last: '', email: '', subject: 'General Inquiry', message: '' });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.first || !form.last || !form.email || !form.message) { toast.error('Please fill in all required fields'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { toast.error(data.error || 'Could not send your message'); return; }
      toast.success(data.message || 'Support request received');
      setForm({ first: '', last: '', email: '', subject: 'General Inquiry', message: '' });
    } catch { toast.error('Network error. Please try again.'); } finally { setLoading(false); }
  };

  return <section id="contact" className="relative py-20 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent"><div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8"><div className="text-center mb-12"><span className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-3">Get in touch</span><h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">We&apos;d love to <span className="gradient-text">hear from you</span></h2><p className="text-gray-400 max-w-2xl mx-auto">Send a public question here, or use an authenticated support ticket from your dashboard.</p></div>
    <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8"><a href={`mailto:${SUPPORT_EMAIL}`} className="glass rounded-2xl p-5 text-center card-glow block"><span className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-3"><Mail className="w-5 h-5 text-white" /></span><h3 className="font-semibold text-sm mb-1">Email</h3><p className="text-xs text-gray-400 break-all">{SUPPORT_EMAIL}</p></a><Link href="/dashboard/support" className="glass rounded-2xl p-5 text-center card-glow block"><span className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-3"><Ticket className="w-5 h-5 text-white" /></span><h3 className="font-semibold text-sm mb-1">Support tickets</h3><p className="text-xs text-gray-400">Sign in to create and track tickets</p></Link><Link href="/support" className="glass rounded-2xl p-5 text-center card-glow block"><span className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center mx-auto mb-3"><MapPin className="w-5 h-5 text-white" /></span><h3 className="font-semibold text-sm mb-1">Help center</h3><p className="text-xs text-gray-400">FAQs and platform guidance</p></Link></div>
    <div className="grid lg:grid-cols-2 gap-5 sm:gap-6"><div className="glass-strong rounded-2xl p-5 sm:p-8"><h3 className="font-display text-xl sm:text-2xl font-bold mb-4">Send a message</h3><form onSubmit={submit} className="space-y-4"><div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-gray-300 block">First name *<input required value={form.first} onChange={event => setForm({ ...form, first: event.target.value })} className="input-field w-full mt-1.5" maxLength={100} /></label><label className="text-xs text-gray-300 block">Last name *<input required value={form.last} onChange={event => setForm({ ...form, last: event.target.value })} className="input-field w-full mt-1.5" maxLength={100} /></label></div><label className="text-xs text-gray-300 block">Email *<input type="email" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="input-field w-full mt-1.5" /></label><label className="text-xs text-gray-300 block">Subject<Select value={form.subject} onChange={value => setForm({ ...form, subject: value })} className="w-full mt-1.5" options={[{ value: 'General Inquiry', label: 'General Inquiry' }, { value: 'Sales', label: 'Sales' }, { value: 'Partnership', label: 'Partnership' }, { value: 'Press', label: 'Press' }, { value: 'Bug Report', label: 'Bug Report' }, { value: 'Account Help', label: 'Account Help' }]} /></label><label className="text-xs text-gray-300 block">Message *<textarea required rows={5} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} className="input-field w-full mt-1.5" maxLength={5000} /></label><button disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"><Send className="w-4 h-4" /> {loading ? 'Sending…' : 'Send message'}</button></form></div><div className="space-y-4"><div className="glass-strong rounded-2xl p-6"><h3 className="font-semibold mb-2">How support works</h3><p className="text-sm text-gray-400 leading-relaxed">Public messages are stored as support requests. Signed-in creators can open tickets and read staff replies in the dashboard.</p></div><div className="glass-strong rounded-2xl p-6"><h3 className="font-semibold mb-2">Need account help?</h3><p className="text-xs text-gray-400 mb-3">Use a support ticket so your account context stays attached to the conversation.</p><Link href="/dashboard/support" className="btn-ghost w-full py-2 rounded-lg text-xs block text-center">Open support tickets</Link></div></div></div>
  </div></section>;
}
