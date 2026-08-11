/**
 * CreatorBoost task system — single source of truth.
 * ------------------------------------------------------------------
 * THE RULE: a task's destination URL ALWAYS comes from the database
 * (`campaigns.task_metadata[taskId].url`), exactly as the creator
 * configured it. There are NO hardcoded/default task URLs here and no
 * fallback destinations. If a task has no stored URL it simply has no
 * link — we never substitute YouTube, Google, or any other destination.
 *
 * task_metadata shape (JSONB on `campaigns`):
 *   {
 *     "youtube_subscribe": { "url": "https://example.com/my-channel-link" },
 *     "custom":            { "title": "Visit our site", "url": "https://example.com/page?id=123" }
 *   }
 *
 * NOTE: the examples above use example.com on purpose — the real stored
 * value is whatever the creator entered (any http(s) URL).
 */

export const TASK_DEFINITIONS: Record<string, { name: string; icon: string }> = {
  youtube_subscribe: { name: 'Subscribe to YouTube channel', icon: '▶️' },
  youtube_like: { name: 'Like the YouTube video', icon: '👍' },
  youtube_comment: { name: 'Comment on the YouTube video', icon: '💬' },
  watch_video: { name: 'Watch the full YouTube video', icon: '🎬' },
  instagram_follow: { name: 'Follow on Instagram', icon: '📷' },
  tiktok_follow: { name: 'Follow on TikTok', icon: '🎵' },
  telegram_join: { name: 'Join Telegram channel', icon: '✈️' },
  discord_join: { name: 'Join Discord server', icon: '🎮' },
  facebook_follow: { name: 'Follow on Facebook', icon: '📘' },
  twitter_follow: { name: 'Follow on X (Twitter)', icon: '🐦' },
  website_visit: { name: 'Visit the website', icon: '🌐' },
  file_download: { name: 'Download the app', icon: '📥' },
  custom: { name: 'Complete custom task', icon: '⚙️' },
};

export const TASK_IDS = Object.keys(TASK_DEFINITIONS);

export type TaskMeta = { title?: string; url?: string };
export type TaskMetadata = Record<string, TaskMeta>;

/** True for http(s) URLs only (used to validate task destinations). */
export function isValidTaskUrl(value: string): boolean {
  const raw = (value || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The exact destination URL for a task, straight from the database
 * metadata. Returns '' when the task has no stored/valid URL — it never
 * falls back to a hardcoded or default destination.
 *
 * The stored string is returned as-is (only whitespace-trimmed) so paths,
 * query parameters and fragments are preserved exactly as the creator
 * entered them. Validation is done with `URL` but the input is NOT
 * normalized/re-serialized.
 */
export function getTaskUrl(taskId: string, taskMetadata: TaskMetadata | null | undefined): string {
  const raw = taskMetadata?.[taskId]?.url?.trim() || '';
  return isValidTaskUrl(raw) ? raw : '';
}

/**
 * Build the `task_metadata` object to persist for a set of selected tasks.
 * Every task that has a URL keeps it (trimmed, exact); tasks without a URL
 * are simply omitted. `title` is preserved for tasks that use it (custom).
 * Callers must validate URLs up front — this only stores what is present.
 */
export function buildTaskMetadata(tasks: Array<{ id: string; title?: string; url?: string }>): TaskMetadata {
  const out: TaskMetadata = {};
  for (const t of tasks) {
    const url = (t.url || '').trim();
    if (!url || !isValidTaskUrl(url)) continue;
    const meta: TaskMeta = { url };
    const title = (t.title || '').trim();
    if (title) meta.title = title;
    out[t.id] = meta;
  }
  return out;
}

/** Human-readable task name (custom tasks use their stored title). */
export function getTaskName(taskId: string, taskMetadata: TaskMetadata | null | undefined): string {
  if (taskId === 'custom') {
    const title = taskMetadata?.[taskId]?.title?.trim();
    if (title) return title;
    return 'Complete custom task';
  }
  return TASK_DEFINITIONS[taskId]?.name || taskId;
}

/**
 * Safe display hostname for a task URL (e.g. "youtube.com").
 * Returns '' for anything unparseable. Never throws.
 */
export function getTaskHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Coarse, client-safe classification of a server-side view-check outcome.
 * Detailed internal reasons (which can aid fraudsters) never leave the
 * server; the client only needs to know whether the reward may unlock and
 * what kind of notice (if any) to show.
 */
export type ViewCheckCategory = 'valid' | 'duplicate' | 'traffic' | 'campaign' | 'error';

const TRAFFIC_REASONS = new Set([
  'bot', 'vpn', 'proxy', 'emulator', 'abnormal_traffic', 'self_view',
  'device_limit', 'ip_limit', 'creator_daily_cap', 'campaign_daily_cap',
  'platform_daily_cap', 'duplicate_device', 'duplicate_request', 'account_blocked',
]);

const CAMPAIGN_REASONS = new Set(['campaign_inactive', 'campaign_deleted', 'campaign_expired']);

export function mapViewCheck(
  valid: boolean,
  duplicate: boolean,
  reason?: string | null,
): ViewCheckCategory {
  if (valid) return 'valid';
  if (duplicate || reason === 'duplicate_request') return 'duplicate';
  if (reason && CAMPAIGN_REASONS.has(reason)) return 'campaign';
  if (reason && TRAFFIC_REASONS.has(reason)) return 'traffic';
  return 'error';
}
