import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = { title: '404 — Page Not Found' };

export default function NotFound() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen hero-gradient flex items-center justify-center px-4 relative overflow-hidden pt-24 pb-16">
        <div className="floating-orb w-72 h-72 bg-purple-600/20 -top-32 -left-32 animate-float"></div>
        <div className="floating-orb w-72 h-72 bg-blue-600/20 -bottom-32 -right-32 animate-float" style={{ animationDelay: '-3s' }} />
        <div className="text-center relative">
          <div className="font-display text-[120px] sm:text-[180px] font-bold leading-none gradient-text">404</div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">Page not found</h1>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">The page you&apos;re looking for doesn&apos;t exist or has been moved. Let&apos;s get you back on track.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/" className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white">Back to Home</Link>
            <Link href="/support" className="btn-ghost px-6 py-3 rounded-xl text-sm">Get Support</Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
