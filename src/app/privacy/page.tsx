import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Link from 'next/link';

export const metadata = { title: 'Privacy Policy', description: 'CreatorBoost Privacy Policy — how we collect, use, and protect your data.' };

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Privacy</span>
          </nav>
          <div className="glass-strong rounded-2xl p-6 sm:p-10">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Legal</div>
            <h1 className="font-display text-4xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 mb-8">Last updated: January 15, 2026</p>
            <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
              <section><h2 className="font-display text-xl font-bold text-white mb-3">1. Information We Collect</h2><p>We collect information you provide (name, email, payment details) and technical data (IP address, device fingerprint, browser type) to operate the platform and prevent fraud.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">2. How We Use Your Information</h2><p>We use your information to provide services, process payments, detect fraud, and improve the platform. We never sell your data to third parties.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">3. Cookies &amp; Tracking</h2><p>We use cookies and similar technologies for authentication, analytics, and fraud prevention. You can control cookies through your browser settings.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">4. Data Security</h2><p>We use industry-standard encryption (TLS 1.3), Supabase RLS, and 2FA to protect your data. Payment information is never stored on our servers.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">5. Your Rights</h2><p>You have the right to access, correct, or delete your personal data. Contact privacy@creatorboost.io to exercise these rights.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">6. International Transfers</h2><p>Data may be transferred to and processed in the United States and other countries where our service providers operate.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">7. Children&apos;s Privacy</h2><p>CreatorBoost is not intended for users under 18. We do not knowingly collect data from children.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">8. Contact</h2><p>For privacy inquiries, contact privacy@creatorboost.io.</p></section>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
