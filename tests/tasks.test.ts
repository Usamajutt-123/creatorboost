import { describe, expect, it } from 'vitest';
import { configuredTaskUrl, hasCompleteTaskSet, isValidHttpUrl, taskDisplayName } from '@/lib/tasks';

describe('campaign task URL flow', () => {
  const metadata = {
    youtube_subscribe: { url: 'https://www.youtube.com/watch?v=ABC123' },
    instagram_follow: { url: 'https://instagram.com/example' },
    custom: { title: 'Read the launch notes', url: 'https://example.com/test?source=campaign' },
  };

  it('returns each exact configured creator URL and never substitutes a platform default', () => {
    expect(configuredTaskUrl(metadata, 'youtube_subscribe')).toBe('https://www.youtube.com/watch?v=ABC123');
    expect(configuredTaskUrl(metadata, 'instagram_follow')).toBe('https://instagram.com/example');
    expect(configuredTaskUrl(metadata, 'custom')).toBe('https://example.com/test?source=campaign');
    expect(configuredTaskUrl(metadata, 'telegram_join')).toBeNull();
  });

  it('rejects non-http task destinations rather than opening a fallback', () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('ftp://example.com/file')).toBe(false);
    expect(configuredTaskUrl({ website_visit: { url: 'javascript:alert(1)' } }, 'website_visit')).toBeNull();
  });

  it('keeps custom titles while standard task labels remain descriptive', () => {
    expect(taskDisplayName(metadata, 'custom')).toBe('Read the launch notes');
    expect(taskDisplayName(metadata, 'youtube_subscribe')).toMatch(/subscribe/i);
  });

  it('requires the exact complete task set before an unlock request', () => {
    const tasks = ['youtube_subscribe', 'instagram_follow', 'custom'];
    expect(hasCompleteTaskSet(tasks, tasks)).toBe(true);
    expect(hasCompleteTaskSet(tasks, ['youtube_subscribe', 'custom'])).toBe(false);
    expect(hasCompleteTaskSet(tasks, ['youtube_subscribe', 'instagram_follow', 'extra'])).toBe(false);
    expect(hasCompleteTaskSet(tasks, ['youtube_subscribe', 'youtube_subscribe', 'custom'])).toBe(false);
  });
});
