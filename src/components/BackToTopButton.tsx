'use client';

import { ArrowUp } from 'lucide-react';

/**
 * The only interactive element in the site footer.
 *
 * The footer used to be a Client Component in its entirety because of this one
 * `onClick`. Since the footer sits in the root `not-found` boundary, that put
 * its whole subtree — markup, link tables and icons, ~35 KB with the navbar —
 * into the client graph of **every** route, including `/dashboard` and
 * `/admin`, which never render a footer at all.
 *
 * Splitting just the button out lets the footer render as a Server Component;
 * the markup below is character-for-character what the footer used to emit.
 */
export default function BackToTopButton() {
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="glass rounded-xl p-3 hover:bg-white/5 transition group"
      aria-label="Back to top"
    >
      <ArrowUp className="w-5 h-5 text-gray-300 group-hover:text-white transition" />
      <span className="block text-[10px] text-gray-500 mt-1 group-hover:text-gray-300">Top</span>
    </button>
  );
}
