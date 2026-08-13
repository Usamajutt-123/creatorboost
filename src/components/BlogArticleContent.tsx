import type { BlogContentBlock } from '@/lib/blog-content';

function lines(text: string) {
  return text.split('\n').map(line => line.trim()).filter(Boolean);
}

export default function BlogArticleContent({ content }: { content: BlogContentBlock[] }) {
  return (
    <div className="space-y-6 sm:space-y-7 text-[15px] sm:text-base leading-7 sm:leading-8 text-gray-300">
      {content.map(block => {
        if (block.type === 'heading2') {
          return <h2 key={block.id} className="font-display text-2xl sm:text-3xl font-bold text-white pt-5 leading-tight">{block.text}</h2>;
        }
        if (block.type === 'heading3') {
          return <h3 key={block.id} className="font-display text-xl sm:text-2xl font-semibold text-white pt-3 leading-tight">{block.text}</h3>;
        }
        if (block.type === 'quote') {
          return <blockquote key={block.id} className="border-l-4 border-purple-500 bg-purple-500/10 rounded-r-xl px-5 py-4 text-purple-100 italic">{block.text}</blockquote>;
        }
        if (block.type === 'bulleted-list') {
          return <ul key={block.id} className="space-y-2 pl-6 list-disc marker:text-purple-400">{lines(block.text).map((line, index) => <li key={`${block.id}-${index}`}>{line.replace(/^[-*•]\s*/, '')}</li>)}</ul>;
        }
        if (block.type === 'numbered-list') {
          return <ol key={block.id} className="space-y-2 pl-6 list-decimal marker:text-purple-400 marker:font-semibold">{lines(block.text).map((line, index) => <li key={`${block.id}-${index}`}>{line.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>;
        }
        return <p key={block.id} className="whitespace-pre-line">{block.text}</p>;
      })}
    </div>
  );
}
