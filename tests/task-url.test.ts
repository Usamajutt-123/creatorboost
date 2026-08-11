/**
 * Tests for the task destination-URL pipeline.
 *
 * THE RULE UNDER TEST: the URL the visitor opens is ALWAYS the exact URL
 * the creator stored for that specific task (campaigns.task_metadata).
 * There are no hardcoded platform URLs, no default destinations and no
 * fallbacks (in particular: NO YouTube fallback).
 *
 * Flow: creator enters URL -> buildTaskMetadata() stores it -> the unlock
 * page reads it back with getTaskUrl() -> the visitor opens that exact URL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildTaskMetadata,
  getTaskUrl,
  getTaskName,
  getTaskHostname,
  isValidTaskUrl,
  TASK_DEFINITIONS,
  mapViewCheck,
} from '../src/lib/tasks';

describe('A. Creator creates a task with https://example.com/test', () => {
  it('stores the exact URL in task_metadata', () => {
    const meta = buildTaskMetadata([{ id: 'website_visit', url: 'https://example.com/test' }]);
    expect(meta).toEqual({ website_visit: { url: 'https://example.com/test' } });
    expect(meta.website_visit?.url).toBe('https://example.com/test');
  });

  it('persists URLs for EVERY task type, not just custom', () => {
    const meta = buildTaskMetadata([
      { id: 'youtube_subscribe', url: 'https://youtube.com/@mychannel' },
      { id: 'custom', title: 'Visit us', url: 'https://example.com/test' },
      { id: 'telegram_join', url: 'https://t.me/mygroup' },
      { id: 'discord_join', url: 'https://discord.gg/abc123' },
    ]);
    expect(meta).toEqual({
      youtube_subscribe: { url: 'https://youtube.com/@mychannel' },
      custom: { title: 'Visit us', url: 'https://example.com/test' },
      telegram_join: { url: 'https://t.me/mygroup' },
      discord_join: { url: 'https://discord.gg/abc123' },
    });
  });
});

describe('B. Unlock page receives the task', () => {
  it('getTaskUrl returns the exact stored URL the unlock page opens', () => {
    const meta = buildTaskMetadata([{ id: 'website_visit', url: 'https://example.com/test' }]);
    // This is the same helper the unlock page (UnlockClient.tsx) uses.
    expect(getTaskUrl('website_visit', meta)).toBe('https://example.com/test');
  });

  it('does not invent a URL when a task has no stored URL (no fallback)', () => {
    expect(getTaskUrl('website_visit', {})).toBe('');
    expect(getTaskUrl('website_visit', null)).toBe('');
    expect(getTaskUrl('youtube_subscribe', {})).toBe('');
  });
});

describe('C. YouTube tasks still work with the creator\'s own URL', () => {
  it('preserves the exact YouTube video URL', () => {
    const meta = buildTaskMetadata([{ id: 'watch_video', url: 'https://www.youtube.com/watch?v=ABC123' }]);
    expect(meta.watch_video?.url).toBe('https://www.youtube.com/watch?v=ABC123');
    expect(getTaskUrl('watch_video', meta)).toBe('https://www.youtube.com/watch?v=ABC123');
  });

  it('preserves the exact YouTube channel URL', () => {
    const meta = buildTaskMetadata([{ id: 'youtube_subscribe', url: 'https://www.youtube.com/@CreatorBoost' }]);
    expect(getTaskUrl('youtube_subscribe', meta)).toBe('https://www.youtube.com/@CreatorBoost');
  });
});

describe('D. Different tasks in the same campaign have different URLs', () => {
  it('each task opens exactly its own stored URL', () => {
    const meta = buildTaskMetadata([
      { id: 'website_visit', url: 'https://google.com/' },
      { id: 'youtube_subscribe', url: 'https://example.com/' },
      { id: 'custom', title: 'Join', url: 'https://youtube.com/' },
    ]);
    expect(getTaskUrl('website_visit', meta)).toBe('https://google.com/');
    expect(getTaskUrl('youtube_subscribe', meta)).toBe('https://example.com/');
    expect(getTaskUrl('custom', meta)).toBe('https://youtube.com/');
    // Distinct values — no cross-talk between tasks.
    const urls = ['website_visit', 'youtube_subscribe', 'custom'].map(t => getTaskUrl(t, meta));
    expect(new Set(urls).size).toBe(3);
  });
});

describe('E. Editing a task URL replaces the old URL', () => {
  it('the new URL wins after an update', () => {
    // Old campaign state
    const oldMeta = buildTaskMetadata([{ id: 'website_visit', url: 'https://example.com/a' }]);
    expect(getTaskUrl('website_visit', oldMeta)).toBe('https://example.com/a');
    // Creator edits: a -> b, save writes a fresh metadata object
    const newMeta = buildTaskMetadata([{ id: 'website_visit', url: 'https://example.com/b' }]);
    expect(getTaskUrl('website_visit', newMeta)).toBe('https://example.com/b');
    expect(getTaskUrl('website_visit', newMeta)).not.toBe('https://example.com/a');
    expect('https://example.com/a' in Object.values(newMeta).map(m => m.url)).toBe(false);
  });

  it('removed tasks leave no stale URL', () => {
    const meta = buildTaskMetadata([
      { id: 'website_visit', url: 'https://example.com/a' },
      { id: 'telegram_join', url: 'https://t.me/x' },
    ]);
    const afterRemoval = buildTaskMetadata([{ id: 'website_visit', url: 'https://example.com/a' }]);
    expect(afterRemoval.telegram_join).toBeUndefined();
    expect(getTaskUrl('telegram_join', afterRemoval)).toBe('');
    void meta;
  });
});

describe('F. No hardcoded YouTube / default destination behavior', () => {
  it('task definitions carry no URLs at all', () => {
    for (const [id, def] of Object.entries(TASK_DEFINITIONS)) {
      expect(def, `task ${id} must not embed a URL`).not.toHaveProperty('url');
    }
  });

  it('getTaskUrl never falls back to YouTube or any platform homepage', () => {
    expect(getTaskUrl('youtube_subscribe', {})).toBe('');
    expect(getTaskUrl('youtube_like', {})).toBe('');
    expect(getTaskUrl('youtube_comment', {})).toBe('');
    expect(getTaskUrl('watch_video', {})).toBe('');
    expect(getTaskUrl('instagram_follow', {})).toBe('');
    expect(getTaskUrl('telegram_join', {})).toBe('');
    expect(getTaskUrl('custom', {})).toBe('');
  });

  it('the unlock flow sources contain no hardcoded destination URLs', () => {
    const files = [
      '../src/app/c/[slug]/UnlockClient.tsx',
      '../src/lib/tasks.ts',
      '../src/app/dashboard/create-campaign/page.tsx',
      '../src/app/dashboard/campaigns/[id]/edit/page.tsx',
    ];
    const forbidden = [
      'https://youtube.com/',
      'http://youtube.com/',
      'https://www.youtube.com/',
      'watch?v=',
      'https://google.com/search',
      "url: 'https://youtube",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      for (const needle of forbidden) {
        expect(src, `${f} must not contain hardcoded "${needle}"`).not.toContain(needle);
      }
    }
  });
});

describe('URL validation & preservation', () => {
  it('rejects malformed and non-http(s) URLs', () => {
    expect(isValidTaskUrl('')).toBe(false);
    expect(isValidTaskUrl('not a url')).toBe(false);
    expect(isValidTaskUrl('example.com/test')).toBe(false);
    expect(isValidTaskUrl('javascript:alert(1)')).toBe(false);
    expect(isValidTaskUrl('ftp://example.com/x')).toBe(false);
    expect(getTaskUrl('website_visit', { website_visit: { url: 'javascript:alert(1)' } })).toBe('');
  });

  it('accepts http and https', () => {
    expect(isValidTaskUrl('http://example.com')).toBe(true);
    expect(isValidTaskUrl('https://example.com')).toBe(true);
  });

  it('trims whitespace but preserves path, query and fragment exactly', () => {
    const meta = buildTaskMetadata([{ id: 'website_visit', url: '  https://example.com/page?id=123#section  ' }]);
    expect(meta.website_visit?.url).toBe('https://example.com/page?id=123#section');
    expect(getTaskUrl('website_visit', meta)).toBe('https://example.com/page?id=123#section');
  });

  it('buildTaskMetadata omits tasks with empty/invalid URLs', () => {
    expect(buildTaskMetadata([{ id: 'website_visit', url: '' }])).toEqual({});
    expect(buildTaskMetadata([{ id: 'website_visit', url: 'nope' }])).toEqual({});
    expect(buildTaskMetadata([])).toEqual({});
  });

  it('getTaskHostname is safe and never throws', () => {
    expect(getTaskHostname('https://example.com/page?id=1')).toBe('example.com');
    expect(getTaskHostname('https://www.youtube.com/watch?v=ABC123')).toBe('www.youtube.com');
    expect(getTaskHostname('')).toBe('');
    expect(getTaskHostname('javascript:alert(1)')).toBe('');
  });
});

describe('Task names', () => {
  it('custom tasks use their stored title', () => {
    const meta = buildTaskMetadata([{ id: 'custom', title: 'Join our Telegram', url: 'https://t.me/x' }]);
    expect(getTaskName('custom', meta)).toBe('Join our Telegram');
    expect(getTaskName('custom', {})).toBe('Complete custom task');
    expect(getTaskName('youtube_subscribe', meta)).toBe('Subscribe to YouTube channel');
  });
});

describe('View-check categories (API -> unlock page)', () => {
  it('maps server outcomes to coarse client-safe categories', () => {
    expect(mapViewCheck(true, false, null)).toBe('valid');
    expect(mapViewCheck(false, true, null)).toBe('duplicate');
    expect(mapViewCheck(false, false, 'duplicate_device')).toBe('traffic');
    expect(mapViewCheck(false, false, 'vpn')).toBe('traffic');
    expect(mapViewCheck(false, false, 'self_view')).toBe('traffic');
    expect(mapViewCheck(false, false, 'bot')).toBe('traffic');
    expect(mapViewCheck(false, false, 'campaign_expired')).toBe('campaign');
    expect(mapViewCheck(false, false, 'campaign_inactive')).toBe('campaign');
    expect(mapViewCheck(false, false, undefined)).toBe('error');
    expect(mapViewCheck(false, false, 'internal')).toBe('error');
  });
});
