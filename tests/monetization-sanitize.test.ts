/**
 * Server-side sanitization for admin-authored monetization step content.
 * The allowlist must hold even for hostile input: no scripts, no event
 * handlers, no javascript:/data: URLs, no style/id/data-* attributes.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeRichContent, sanitizeStepImageUrl } from '@/lib/monetization/sanitize';

describe('sanitizeRichContent', () => {
  it('keeps allowlisted structure and inline tags', () => {
    const input = '<h2>Hello</h2><p>A <strong>bold</strong> and <em>italic</em> paragraph with a <a href="https://example.com" target="_blank">link</a>.</p><ul><li>One</li><li>Two</li></ul>';
    const out = sanitizeRichContent(input);
    expect(out).toContain('<h2>Hello</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<li>One</li>');
  });

  it('strips script and style tags entirely', () => {
    const out = sanitizeRichContent('<p>safe</p><script>alert(1)</script><style>body{display:none}</style><p>also safe</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('style');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>safe</p>');
    expect(out).toContain('<p>also safe</p>');
  });

  it('removes event handlers and javascript: URLs', () => {
    const out = sanitizeRichContent('<a href="javascript:alert(1)" onclick="steal()">x</a><img src="javascript:alert(1)" onerror="boom()" alt="i" />');
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
  });

  it('forces safe link target/rel and validates http(s)', () => {
    const out = sanitizeRichContent('<a href="https://example.com" target="_self">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    // A non-http(s) href removes the anchor destination entirely.
    const bad = sanitizeRichContent('<a href="data:text/html,evil">x</a>');
    expect(bad).not.toContain('href');
  });

  it('keeps only allowlisted classes', () => {
    const out = sanitizeRichContent('<div class="card grid-2"><div class="evil-class" style="color:red">x</div></div>');
    expect(out).toContain('class="card grid-2"');
    expect(out).not.toContain('evil-class');
    expect(out).not.toContain('style');
  });

  it('escapes raw text and drops unknown tags while keeping inner text', () => {
    const out = sanitizeRichContent('<marquee>plain <b>text</b> & < > " \'</marquee>');
    expect(out).not.toContain('marquee');
    expect(out).toContain('plain <b>text</b>');
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('handles img with valid src and lazy loading', () => {
    const out = sanitizeRichContent('<img src="https://example.com/a.png" alt="A picture" />');
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('alt="A picture"');
  });

  it('rejects non-string and oversized input', () => {
    expect(sanitizeRichContent(null)).toBe('');
    expect(sanitizeRichContent(42)).toBe('');
    expect(sanitizeRichContent('x'.repeat(40_000)).length).toBeLessThan(31_000);
  });
});

describe('sanitizeStepImageUrl', () => {
  it('accepts plain http(s) URLs', () => {
    expect(sanitizeStepImageUrl('https://cdn.example.com/img.png')).toBe('https://cdn.example.com/img.png');
  });

  it('rejects credentials and non-http schemes', () => {
    expect(sanitizeStepImageUrl('https://user:pass@example.com/x.png')).toBeNull();
    expect(sanitizeStepImageUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeStepImageUrl('ftp://example.com/x.png')).toBeNull();
    expect(sanitizeStepImageUrl('not a url')).toBeNull();
  });
});
