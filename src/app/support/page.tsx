import { BookOpen, Mail, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import FaqList from '@/components/FaqList';
import Link from 'next/link';
import { MessageCircle as WhatsAppIcon, Mail as MailIcon } from 'lucide-react';

export const metadata = {
  title: 'Support Center',
  description: 'Get help with CreatorBoost. Browse our knowledge base, FAQs, or contact our support team via WhatsApp or email.',
};

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@creatorboost.io';
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
            <p className="text-gray-400 max-w-xl mx-auto mb-8">Search our knowledge base or reach our support team via WhatsApp or email.</p>
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
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1">Help Center</h3>
              <p className="text-sm text-gray-400">Answers to common questions below</p>
            </div>
          </div>

          <FaqList />

          <div className="mt-12 text-center">
            <h3 className="font-display text-2xl font-bold mb-2">Still need help?</h3>
            <p className="text-sm text-gray-400 mb-4">Send us a message and we&apos;ll get back to you</p>
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