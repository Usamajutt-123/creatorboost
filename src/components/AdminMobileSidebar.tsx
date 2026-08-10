'use client';
import { useState, useEffect } from 'react';
import AdminSidebar from './AdminSidebar';
import { X, } from 'lucide-react';

export default function AdminMobileSidebar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).openAdminMobileSidebar = () => setOpen(true);
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>


      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 z-[55] w-72 max-w-[85vw] flex flex-col bg-[#0a0716]/95 backdrop-blur-xl border-r border-white/10 shadow-2xl transition-transform duration-300 ease-out lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'
          }`}
        aria-label="Admin mobile navigation"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <span className="font-display font-bold text-sm">Admin Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-2 -mr-2 text-gray-300 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AdminSidebar />
        </div>
      </aside>
    </>
  );
}