import { BookOpen, MessageCircle, Mail, Search, Phone, ArrowRight } from 'lucide-react';
import { FAQS } from '@/lib/constants';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Link from 'next/link';
import { MessageCircle as WhatsAppIcon, Mail as MailIcon, Phone as PhoneIcon } from 'lucide-react';

export const metadata = {
  title: 'Support Center',
  description: 'Get help with CreatorBoost. Browse our knowledge base, FAQs, or contact our support team via WhatsApp or email.',
};

const SUPPORT_EMAIL = 'royalsenpai0@gmail.com';
const WHATSAPP_NUMBER = '923209104702';
const WHATSAPP_DISPLAY = '+92 320 9104702';

export default function SupportPage() {
  return (
    <>
      <Navbar />
      <div className="hero-gradient min-h-screen pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-white">Support</span>
          </nav>
          <div className="text-center mb-12">
            <h1 className="font-display text-5xl font-bold mb-4">How can we <span className="gradient-text">help?</span></h1>
            <p className="text-gray-400 max-w-xl mx-auto mb-8">Search our knowledge base or reach our support team via WhatsApp or email. We&apos;re here 24/7.</p>
            <form className="max-w-2xl mx-auto flex gap-2">
              <input className="input-field flex-1 px-5 py-3.5 rounded-xl text-sm" placeholder="Search for answers..." />
              <button type="submit" className="btn-primary px-6 py-3.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2">
                <Search className="w-4 h-4" /> Search
              </button>
            </form>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="glass rounded-2xl p-6 card-glow text-center block">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4">
                <MailIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1">Email</h3>
              <p className="text-sm text-gray-400 break-all">{SUPPORT_EMAIL}</p>
            </a>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi CreatorBoost! I need help with...')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="glass rounded-2xl p-6 card-glow text-center block"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4">
                <WhatsAppIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1">WhatsApp Chat</h3>
              <p className="text-sm text-gray-400">{WHATSAPP_DISPLAY}</p>
            </a>
            <div className="glass rounded-2xl p-6 card-glow text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1">Knowledge Base</h3>
              <p className="text-sm text-gray-400">Browse tutorials & guides</p>
            </div>
            <div className="glass rounded-2xl p-6 card-glow text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center mx-auto mb-4">
                <PhoneIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1">24/7 Support</h3>
              <p className="text-sm text-gray-400 flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" /> Always online
              </p>
            </div>
          </div>

          <div className="glass-strong rounded-2xl p-6 max-w-3xl mx-auto">
            <h3 className="font-semibold mb-4">Frequently Asked Questions</h3>
            <div className="space-y-2">
              {FAQS.map((f, i) => (
                <details key={i} className="glass rounded-xl group">
                  <summary className="cursor-pointer p-4 font-medium text-sm flex items-center justify-between list-none">
                    {f.q}
                    <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gray-400">{f.a}</div>
                </details>
              ))}
            </div>
          </div>

          <div className="mt-12 text-center">
            <h3 className="font-display text-2xl font-bold mb-2">Still need help?</h3>
            <p className="text-sm text-gray-400 mb-4">Our team is here to assist you 24/7</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi CreatorBoost! I need help with...')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-green-500 to-emerald-500 hover:scale-105 transition shadow-lg shadow-green-500/30"
              >
                <WhatsAppIcon className="w-4 h-4" /> Chat on WhatsApp
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2"
              >
                <MailIcon className="w-4 h-4" /> Email Us
              </a>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}