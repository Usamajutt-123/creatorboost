import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Link from 'next/link';

export const metadata = { title: 'Terms of Service', description: 'CreatorBoost Terms of Service — read our terms and conditions.' };

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-24 pb-12 hero-gradient">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="mb-8 text-sm text-gray-500">
            <Link href="/" className="hover:text-white">Home</Link><span className="mx-2">/</span><span className="text-white">Terms</span>
          </nav>
          <div className="glass-strong rounded-2xl p-6 sm:p-10">
            <div className="inline-block px-3 py-1 rounded-full glass text-xs font-medium text-purple-300 mb-4">Legal</div>
            <h1 className="font-display text-4xl font-bold mb-2">Terms of Service</h1>
            <p className="text-sm text-gray-500 mb-8">Last updated: August 12, 2026</p>
            <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
              <section><h2 className="font-display text-xl font-bold text-white mb-3">1. Acceptance of Terms</h2><p>By accessing or using CreatorBoost, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">2. Account Registration</h2><p>You must provide accurate, complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use CreatorBoost.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">3. Earnings &amp; Payouts</h2><p>Earnings are calculated from eligible views, country CPM rates, and your creator level. Rates, minimum withdrawal amounts, methods, fees, and holding periods are platform-configured and may change. Withdrawal requests remain pending until reviewed and are paid only after approval.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">4. Prohibited Activities</h2><p>You may not use bots, VPNs, proxies, or any fraudulent means to generate views. Fraudulent activity will result in immediate account suspension and forfeiture of earnings.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">5. Refunds &amp; Chargebacks</h2><p>All earnings are final once paid out. Chargebacks or fraudulent payment methods will result in account termination and legal action.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">6. Limitation of Liability</h2><p>CreatorBoost is not liable for any indirect, incidental, or consequential damages arising from use of the platform.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">7. Modifications</h2><p>We reserve the right to modify these terms at any time. Continued use of the service constitutes acceptance of modified terms.</p></section>
              <section><h2 className="font-display text-xl font-bold text-white mb-3">8. Contact</h2><p>For questions about these terms, contact us at legal@creatorboost.io.</p></section>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
