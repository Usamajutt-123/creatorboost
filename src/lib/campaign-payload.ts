import { z } from 'zod';
import { TASK_TYPES, isValidHttpUrl } from '@/lib/tasks';

const categories = [
  'youtube_growth',
  'instagram_growth',
  'tiktok_growth',
  'telegram_growth',
  'discord_growth',
  'website_traffic',
  'app_install',
  'other',
] as const;

const statuses = ['draft', 'active', 'paused'] as const;

const taskSchema = z.object({
  id: z.enum(TASK_TYPES),
  title: z.string().trim().max(120).optional().default(''),
  url: z.string().trim().max(2_000),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(150),
  description: z.string().trim().max(2_000).optional().default(''),
  category: z.enum(categories),
  destinationUrl: z.string().trim().max(2_000).optional().default(''),
  status: z.enum(statuses),
  expiresAt: z.string().trim().max(32).optional().default(''),
  thumbnailUrl: z.string().trim().max(2_000).nullable().optional(),
  bannerUrl: z.string().trim().max(2_000).nullable().optional(),
  tasks: z.array(taskSchema).min(1, 'Choose at least one task').max(TASK_TYPES.length),
});

export type CampaignMutationInput = z.input<typeof campaignSchema>;

function toEndOfDay(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expiry date is invalid');
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error('Expiry date must be in the future');
  }
  return date.toISOString();
}

function safeMediaUrl(value: string | null | undefined, field: string): string | null {
  if (!value) return null;
  if (!isValidHttpUrl(value)) throw new Error(`${field} must be a valid http(s) URL`);
  return value.trim();
}

export function buildCampaignWritePayload(input: CampaignMutationInput) {
  const parsed = campaignSchema.parse(input);
  const ids = parsed.tasks.map(task => task.id);
  if (new Set(ids).size !== ids.length) throw new Error('Each task type can only be added once');

  for (const task of parsed.tasks) {
    if (!isValidHttpUrl(task.url)) {
      throw new Error(`Add a valid http(s) URL for ${task.id.replace(/_/g, ' ')}`);
    }
    if (task.id === 'custom' && !task.title.trim()) {
      throw new Error('Custom tasks need a title');
    }
  }

  if (parsed.status === 'active' && !isValidHttpUrl(parsed.destinationUrl)) {
    throw new Error('An active campaign needs a valid http(s) destination URL');
  }
  if (parsed.destinationUrl && !isValidHttpUrl(parsed.destinationUrl)) {
    throw new Error('Destination URL must be a valid http(s) URL');
  }

  const taskMetadata: Record<string, { title?: string; url: string }> = {};
  for (const task of parsed.tasks) {
    taskMetadata[task.id] = {
      ...(task.id === 'custom' ? { title: task.title.trim() } : {}),
      url: task.url.trim(),
    };
  }

  return {
    name: parsed.name,
    description: parsed.description || null,
    category: parsed.category,
    destination_url: parsed.destinationUrl.trim(),
    status: parsed.status,
    expires_at: toEndOfDay(parsed.expiresAt),
    thumbnail_url: safeMediaUrl(parsed.thumbnailUrl, 'Thumbnail URL'),
    banner_url: safeMediaUrl(parsed.bannerUrl, 'Banner URL'),
    tasks: ids,
    task_metadata: taskMetadata,
  };
}
