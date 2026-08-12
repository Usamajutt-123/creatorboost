'use client';

import { useEffect, useState } from 'react';
import DashboardSidebar from './DashboardSidebar';
import { X } from 'lucide-react';

export default function MobileSidebar(props: { level: string; levelProgress: number; isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (window as Window & { openMobileSidebar?: () => void }).openMobileSidebar = () => setOpen(true);
    return () => { delete (window as Window & { openMobileSidebar?: () => void }).openMobileSidebar; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60" /><div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[#0a0716] shadow-2xl"><button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 right-4 p-2 text-gray-400 z-10"><X className="w-5 h-5" /></button><DashboardSidebar {...props} onClose={() => setOpen(false)} /></div></div>;
}
