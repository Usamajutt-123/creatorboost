import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateBlogReadingTime, normalizeBlogContent, slugifyBlogTitle } from '@/lib/blog-content';

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/0013_blog_system.sql'), 'utf8');

describe('blog content helpers', () => {
  it('creates canonical slugs without unsafe characters', () => {
    expect(slugifyBlogTitle('  Creator’s SEO Guide: 2026! ')).toBe('creators-seo-guide-2026');
  });

  it('normalizes structured blocks and discards empty/unknown data safely', () => {
    expect(normalizeBlogContent([
      { id: 'intro', type: 'heading2', text: ' Introduction ' },
      { id: '<script>', type: 'script', text: 'Safe text' },
      { type: 'paragraph', text: '  ' },
    ])).toEqual([
      { id: 'intro', type: 'heading2', text: 'Introduction' },
      { id: 'block-2', type: 'paragraph', text: 'Safe text' },
    ]);
  });

  it('calculates a minimum one-minute reading time', () => {
    expect(calculateBlogReadingTime([])).toBe(1);
    expect(calculateBlogReadingTime([{ id: 'a', type: 'paragraph', text: Array(221).fill('word').join(' ') }])).toBe(2);
  });
});

describe('blog database security', () => {
  it('creates isolated blog tables with RLS', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.blog_posts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.blog_images');
    expect(migration).toContain('ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.blog_images ENABLE ROW LEVEL SECURITY');
  });

  it('limits public rows to currently published posts', () => {
    expect(migration).toContain("status = 'published'");
    expect(migration).toContain('published_at <= NOW()');
    expect(migration).toContain('blog_posts_public_read_published');
  });

  it('requires database-backed admin authorization for writes', () => {
    expect(migration).toContain('blog_posts_admin_insert');
    expect(migration).toContain('blog_posts_admin_update');
    expect(migration).toContain('blog_posts_admin_delete');
    expect((migration.match(/public\.is_admin\(\)/g) || []).length).toBeGreaterThanOrEqual(10);
  });

  it('uses an image-only blog bucket with admin upload policies', () => {
    expect(migration).toContain("VALUES (\n  'blog'");
    expect(migration).toContain('8388608');
    expect(migration).toContain("ARRAY['image/png','image/jpeg','image/webp','image/avif']");
    expect(migration).toContain('blog_media_admin_insert');
    expect(migration).toContain("IN ('featured', 'content')");
  });
});
