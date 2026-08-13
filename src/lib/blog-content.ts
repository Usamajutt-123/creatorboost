export const BLOG_BLOCK_TYPES = [
  'paragraph',
  'heading2',
  'heading3',
  'quote',
  'bulleted-list',
  'numbered-list',
] as const;

export type BlogBlockType = (typeof BLOG_BLOCK_TYPES)[number];

export type BlogContentBlock = {
  id: string;
  type: BlogBlockType;
  text: string;
};

const BLOCK_TYPE_SET = new Set<string>(BLOG_BLOCK_TYPES);

export function slugifyBlogTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
    .replace(/-+$/g, '');
}

/**
 * Blog bodies are stored as a small structured document rather than trusted
 * HTML. That gives editors headings, lists, quotes, and paragraphs while
 * keeping public rendering XSS-safe without shipping a sanitizer/editor
 * runtime to readers.
 */
export function normalizeBlogContent(value: unknown): BlogContentBlock[] {
  if (!Array.isArray(value)) return [];
  const normalized: BlogContentBlock[] = [];
  for (let index = 0; index < Math.min(value.length, 200); index += 1) {
    const candidate = value[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.replace(/\r\n/g, '\n').trim().slice(0, 20_000) : '';
    if (!text) continue;
    const type = typeof row.type === 'string' && BLOCK_TYPE_SET.has(row.type)
      ? row.type as BlogBlockType
      : 'paragraph';
    const id = typeof row.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(row.id)
      ? row.id
      : `block-${index + 1}`;
    normalized.push({ id, type, text });
  }
  return normalized;
}

export function calculateBlogReadingTime(content: BlogContentBlock[]): number {
  const words = content.reduce((total, block) => {
    const count = block.text.trim() ? block.text.trim().split(/\s+/u).length : 0;
    return total + count;
  }, 0);
  return Math.max(1, Math.ceil(words / 220));
}

export function formatBlogDate(value: string | null | undefined, format: 'short' | 'long' = 'short'): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', format === 'long'
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function blogWordCount(content: BlogContentBlock[]): number {
  return content.reduce((total, block) => total + (block.text.trim() ? block.text.trim().split(/\s+/u).length : 0), 0);
}
