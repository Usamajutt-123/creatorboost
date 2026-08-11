'use client';
import { useState } from 'react';
import DashboardSidebar from './DashboardSidebar';
import { X, } from 'lucide-react';

export default function MobileSidebar(props: { level: string; levelProgress: number; isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);

  // The dashboard topbar doesn't currently trigger this. We'll attach to a custom event
  if (typeof window !== 'undefined') {
    (window as any).openMobileSidebar = () => setOpen(true);
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[#0a0716] shadow-2xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 right-4 p-2 text-gray-400 z-10">
              <X className="w-5 h-5" />
            </button>
            <DashboardSidebar {...props} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
