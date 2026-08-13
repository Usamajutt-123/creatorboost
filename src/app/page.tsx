import { Suspense } from 'react';
import Hero from '@/components/Hero';
import LiveStats from '@/components/LiveStats';
import CpmCalculator from '@/components/CpmCalculator';
import EarningsCalculator from '@/components/EarningsCalculator';
import Features from '@/components/Features';
import DashboardPreview from '@/components/DashboardPreview';
import AdminPreview from '@/components/AdminPreview';
import CountryCpmTable from '@/components/CountryCpmTable';
import Levels from '@/components/Levels';
import Steps from '@/components/Steps';
import Testimonials from '@/components/Testimonials';
import Pricing from '@/components/Pricing';
import Faq from '@/components/Faq';
import BlogPreview from '@/components/BlogPreview';
import BlogPreviewSkeleton from '@/components/BlogPreviewSkeleton';
import ContactForm from '@/components/ContactForm';
import CtaBanner from '@/components/CtaBanner';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';


export default function Home() {
  return (
    <>
      {/* 1. Hero (no blank space below navbar) */}
      <Navbar />
      <Hero />

      {/* 2. Live Stats */}
      <LiveStats />

      {/* 3. CPM Calculator */}
      <CpmCalculator />

      {/* 4. Earnings Calculator */}
      <EarningsCalculator />

      {/* 5. Features */}
      <Features />

      {/* 6. Creator Dashboard Preview */}
      <DashboardPreview />

      {/* 7. Admin Dashboard Preview */}
      <AdminPreview />

      {/* 8. Country CPM Table */}
      <CountryCpmTable />

      {/* 9. Creator Levels (with feature comparison) */}
      <Levels />

      {/* 10. How It Works */}
      <Steps />

      {/* 11. Testimonials */}
      <Testimonials />

      {/* 12. Pricing */}
      <Pricing />

      {/* 13. FAQ */}
      <Faq />

      {/* 14. Blog Preview — streamed so its database query never blocks the homepage shell. */}
      <Suspense fallback={<BlogPreviewSkeleton />}>
        <BlogPreview />
      </Suspense>

      {/* 15. Contact Form */}
      <ContactForm />

      {/* CTA strip */}
      <CtaBanner />
      <Footer/ >
    </>
  );
}
