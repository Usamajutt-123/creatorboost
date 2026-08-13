export default function BlogPreviewSkeleton() {
  return (
    <section id="blog" className="relative py-20 sm:py-24 scroll-mt-16" aria-label="Loading blog posts">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-12 flex-wrap gap-3">
          <div><div className="skeleton h-6 w-24 rounded-full mb-3" /><div className="skeleton h-10 w-72 max-w-full rounded-xl" /></div>
          <div className="skeleton h-5 w-28 rounded-lg" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="glass rounded-2xl overflow-hidden">
              <div className="skeleton h-32 sm:h-40" />
              <div className="p-4 sm:p-5 space-y-3"><div className="skeleton h-3 w-20 rounded" /><div className="skeleton h-4 w-full rounded" /><div className="skeleton h-3 w-5/6 rounded" /><div className="skeleton h-6 w-full rounded" /></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
