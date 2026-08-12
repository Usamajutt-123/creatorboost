/**
 * Shared task catalogue and helpers.
 *
 * Task URLs are creator-owned campaign data. This module deliberately keeps
 * only labels/icons – it never supplies a fallback destination. A task can be
 * opened only when its persisted URL is present and valid.
 */

export const TASK_TYPES = [
  'youtube_subscribe',
  'youtube_like',
  'youtube_comment',
  'watch_video',
  'telegram_join',
  'discord_join',
  'instagram_follow',
  'tiktok_follow',
  'facebook_follow',
  'twitter_follow',
  'website_visit',
  'file_download',
  'custom',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type TaskMetadata = Record<string, { title?: string; url?: string }>;

export const TASK_DETAILS: Record<TaskType, { label: string; icon: string }> = {
  youtube_subscribe: { label: 'Subscribe to YouTube channel', icon: '▶️' },
  youtube_like: { label: 'Like the YouTube video', icon: '👍' },
  youtube_comment: { label: 'Comment on the YouTube video', icon: '💬' },
  watch_video: { label: 'Watch the video', icon: '🎬' },
  telegram_join: { label: 'Join Telegram channel', icon: '✈️' },
  discord_join: { label: 'Join Discord server', icon: '🎮' },
  instagram_follow: { label: 'Follow on Instagram', icon: '📷' },
  tiktok_follow: { label: 'Follow on TikTok', icon: '🎵' },
  facebook_follow: { label: 'Follow on Facebook', icon: '📘' },
  twitter_follow: { label: 'Follow on X (Twitter)', icon: '🐦' },
  website_visit: { label: 'Visit the website', icon: '🌐' },
  file_download: { label: 'Download the file', icon: '📥' },
  custom: { label: 'Complete custom task', icon: '⚙️' },
};

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

/** Accept only destinations that browsers can safely navigate to. */
export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Returns the creator-configured URL exactly as stored (apart from whitespace
 * trimming). There is intentionally no generic YouTube/Google fallback.
 */
export function configuredTaskUrl(metadata: TaskMetadata | null | undefined, taskId: string): string | null {
  const url = metadata?.[taskId]?.url?.trim();
  return url && isValidHttpUrl(url) ? url : null;
}

export function taskDisplayName(metadata: TaskMetadata | null | undefined, taskId: string): string {
  if (taskId === 'custom') {
    const title = metadata?.custom?.title?.trim();
    if (title) return title;
  }
  return isTaskType(taskId) ? TASK_DETAILS[taskId].label : 'Campaign task';
}

/** A campaign can only be submitted as complete when every configured task is represented once. */
export function hasCompleteTaskSet(tasks: readonly string[] | null | undefined, completed: readonly string[] | null | undefined): boolean {
  const required = tasks || [];
  const reported = completed || [];
  if (required.length === 0 || required.length !== new Set(required).size) return false;
  if (reported.length !== required.length || reported.length !== new Set(reported).size) return false;
  const completedSet = new Set(reported);
  return required.every(task => completedSet.has(task));
}
