import { BookOpen } from 'lucide-react';

export default function BlogEmptyState({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="glass rounded-2xl px-6 py-12 sm:py-16 text-center border border-white/10">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-400/20 flex items-center justify-center mx-auto mb-4">
        <BookOpen className="w-7 h-7 text-purple-300" />
      </div>
      <h3 className="font-display text-lg font-semibold mb-2">{filtered ? 'No matching posts' : 'Stories are on the way'}</h3>
      <p className="text-sm text-gray-400 max-w-md mx-auto">
        {filtered
          ? 'Try a different search or category to discover more CreatorBoost resources.'
          : 'There are no published articles yet. Check back soon for CreatorBoost tips, guides, and insights.'}
      </p>
    </div>
  );
}
