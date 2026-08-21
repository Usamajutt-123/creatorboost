/**
 * Server-side sanitization for admin-controlled monetization step content.
 *
 * Admin-authored rich content is third-party-controlled data from the
 * visitor's point of view, so it is sanitized TWICE: once before storage
 * (server actions) and again before rendering (public pages). The browser
 * never receives admin HTML that has not passed this allowlist.
 *
 * The allowlist is intentionally small:
 *   - structural: p, br, h2, h3, h4, ul, ol, li, div, span, blockquote,
 *     hr, pre, code
 *   - inline:     strong, b, em, i, a, img
 *   - attributes: a[href (http/https only), target, rel],
 *                 img[src (http/https only), alt, loading],
 *                 class (whitelisted design tokens only)
 *
 * Everything else — scripts, styles, iframes, event handlers, forms,
 * javascript: URLs — is stripped or escaped. The public renderer runs this
 * again, so a stored value that somehow bypassed the action still cannot
 * reach the DOM unsanitized.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'div', 'span', 'blockquote', 'hr', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'a', 'img',
]);

/** Self-closing tags that must not wrap content. */
const VOID_TAGS = new Set(['br', 'hr', 'img']);

/**
 * Tags whose CONTENT must be dropped entirely, not just the tag itself.
 * A <script>'s text is code, not visible prose — keeping it would leak it
 * into the page as rendered text.
 */
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
  'title', 'base', 'noscript', 'template', 'svg', 'math', 'textarea',
  'select', 'option', 'button', 'input', 'video', 'audio', 'source',
  'track', 'canvas',
]);

/**
 * Design tokens used by the seeded step content and styled in globals.css
 * under `.rich-content`. Arbitrary classes are not allowed: the value must
 * be a subset of this list, which keeps the styling surface closed.
 */
const ALLOWED_CLASSES = new Set([
  'grid-2', 'card', 'card-icon', 'card-title', 'card-body',
  'timeline', 'timeline-step', 'timeline-dot', 'timeline-arrow',
  'checklist', 'tip', 'badge', 'muted', 'pill', 'note',
]);

const MAX_CONTENT_LENGTH = 30_000;

function isSafeHttpUrl(value: string): boolean {
  if (value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    // Escape bare ampersands only — an ampersand that already starts a
    // valid HTML entity is left alone, which keeps sanitization idempotent
    // (a second pass cannot double-escape `&#39;` into `&amp;#39;`).
    .replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeClasses(raw: string | undefined): string {
  if (!raw) return '';
  const tokens = raw
    .split(/\s+/)
    .filter(token => ALLOWED_CLASSES.has(token));
  return tokens.join(' ');
}

function sanitizeAttributes(tag: string, attrs: Record<string, string>): string {
  const parts: string[] = [];
  const classes = sanitizeClasses(attrs.class);
  if (classes) parts.push(`class="${classes}"`);

  if (tag === 'a') {
    const href = (attrs.href || '').trim();
    if (isSafeHttpUrl(href)) {
      parts.push(`href="${href.replace(/"/g, '&quot;')}"`);
      // Always force a safe target/rel combination; admin values are ignored.
      parts.push('target="_blank"');
      parts.push('rel="noopener noreferrer"');
    }
  }

  if (tag === 'img') {
    const src = (attrs.src || '').trim();
    if (isSafeHttpUrl(src)) {
      parts.push(`src="${src.replace(/"/g, '&quot;')}"`);
      const alt = (attrs.alt || '').trim().slice(0, 200);
      parts.push(`alt="${escapeHtml(alt)}"`);
      parts.push('loading="lazy"');
    } else {
      // An <img> without a safe src renders nothing.
      return '';
    }
  }

  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Sanitizes an admin-authored HTML fragment against the allowlist above.
 *
 * Unknown tags are removed entirely (their children are re-processed), and
 * all text outside known tags is escaped. Returns an empty string for
 * non-string or oversized input.
 */
export function sanitizeRichContent(input: unknown): string {
  if (typeof input !== 'string') return '';
  const source = input.slice(0, MAX_CONTENT_LENGTH);

  let out = '';
  let cursor = 0;
  const tagPattern = /<(\/?)\s*([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    // Text before this tag is plain text — always escaped.
    out += escapeHtml(source.slice(cursor, match.index));

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosed = match[4] === '/';

    if (!ALLOWED_TAGS.has(tag) || (closing && selfClosed)) {
      if (DROP_CONTENT_TAGS.has(tag) && !closing && !selfClosed) {
        // Dangerous element: drop the tag AND everything up to its closing
        // tag — script/style payloads are never visible prose.
        const closePattern = new RegExp(`</\\s*${tag}\\s*>`, 'ig');
        closePattern.lastIndex = tagPattern.lastIndex;
        const closeMatch = closePattern.exec(source);
        if (closeMatch) {
          cursor = closePattern.lastIndex;
          tagPattern.lastIndex = closePattern.lastIndex;
          continue;
        }
        // No closing tag: drop the rest of the fragment.
        cursor = source.length;
        tagPattern.lastIndex = source.length;
        continue;
      }
      // Unknown but inert tag: drop the tag, keep the text inside.
      cursor = tagPattern.lastIndex;
      continue;
    }

    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      cursor = tagPattern.lastIndex;
      continue;
    }

    // Opening tag. Parse attributes defensively (values double or single
    // quoted, or bare tokens).
    const attrs: Record<string, string> = {};
    const attrPattern = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const attrText = match[3] || '';
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(attrText)) !== null) {
      const name = attrMatch[1].toLowerCase();
      // No event handlers, no style, no id, no data-* attributes.
      if (!['class', 'href', 'src', 'alt', 'target', 'rel', 'loading'].includes(name)) continue;
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
      // javascript: / vbscript: / data: URLs and on* handlers can never appear
      // because only the attribute names above are read, and href/src values
      // are scheme-validated — but block these schemes explicitly too.
      const lower = value.trim().toLowerCase();
      if (/^(javascript|vbscript|data):/.test(lower)) continue;
      if (name === 'class' && !sanitizeClasses(value)) continue;
      attrs[name] = value;
    }

    if (VOID_TAGS.has(tag)) {
      const rendered = sanitizeAttributes(tag, attrs);
      out += `<${tag}${rendered} />`;
      cursor = tagPattern.lastIndex;
      continue;
    }

    const rendered = sanitizeAttributes(tag, attrs);
    out += `<${tag}${rendered}>`;
    cursor = tagPattern.lastIndex;
  }

  out += escapeHtml(source.slice(cursor));
  return out;
}

/** Trim + sanitize a plain-text field used inside step content UI. */
export function sanitizeStepText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

/** An image URL for step content (http/https only, no credentials). */
export function sanitizeStepImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim().slice(0, 2_000);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return url;
  } catch {
    return null;
  }
}
