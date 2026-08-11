'use client';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function CopyLinkButton({ slug }: { slug: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/c/${slug}`);
      toast.success('Link copied!');
    } catch {
      toast.error('Could not copy — copy the link from the address bar.');
    }
  };
  return (
    <button onClick={copy} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5" aria-label="Copy campaign link">
      <Copy className="w-3.5 h-3.5" /> Copy Link
    </button>
  );
}
