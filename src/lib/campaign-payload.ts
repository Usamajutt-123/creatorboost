import { z } from 'zod';
import { TASK_TYPES, isValidHttpUrl } from '@/lib/tasks';
import { FLOW_TYPES, FLOW_PAGE_COUNT, FLOW_LABEL, type FlowType } from '@/lib/flow';

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

const flowPageSchema = z.object({
  position: z.number().int().min(1).max(5),
  title: z.string().trim().max(150).optional().default(''),
  description: z.string().trim().max(2_000).nullable().optional(),
  imageUrl: z.string().trim().max(2_000).nullable().optional(),
  buttonText: z.string().trim().max(60).nullable().optional(),
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
  // Custom-page flow. Optional so existing callers keep working; server
  // never accepts a multiplier field from the client.
  flowType: z.enum(FLOW_TYPES).optional().default('normal'),
  flowPages: z.array(flowPageSchema).max(5).optional().default([]),
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

  const flowType: FlowType = parsed.flowType;
  const expectedPages = FLOW_PAGE_COUNT[flowType];
  const flowPages = parsed.flowPages ?? [];

  if (flowType === 'normal') {
    if (flowPages.length !== 0) {
      throw new Error('Normal flow must not include custom pages');
    }
  } else {
    if (flowPages.length !== expectedPages) {
      throw new Error(`${FLOW_LABEL[flowType]} requires exactly ${expectedPages} pages`);
    }
    const seen = new Set<number>();
    for (const page of flowPages) {
      if (seen.has(page.position)) throw new Error('Duplicate page position');
      seen.add(page.position);
      if (page.position < 1 || page.position > expectedPages) {
        throw new Error(`Page positions must be between 1 and ${expectedPages}`);
      }
      const isAutoPage = page.position >= 4;
      if (!isAutoPage && (!page.title || !page.title.trim())) {
        throw new Error(`Page ${page.position} needs a title`);
      }
      if (!isAutoPage && page.imageUrl && page.imageUrl.trim() && !isValidHttpUrl(page.imageUrl)) {
        throw new Error(`Page ${page.position} image URL must be a valid http(s) URL`);
      }
    }
  }

  const normalizedPages = flowPages
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((page, index) => {
      const position = index + 1;
      const isAutoPage = (flowType !== 'normal' && position >= 4);
      return {
        position,
        title: isAutoPage ? parsed.name.trim() : (page.title || '').trim(),
        description: isAutoPage ? null : (page.description?.trim() ? page.description.trim() : null),
        image_url: isAutoPage ? null : (page.imageUrl?.trim() ? page.imageUrl.trim() : null),
        button_text: isAutoPage ? null : (page.buttonText?.trim() ? page.buttonText.trim() : null),
      };
    });

  const payload = {
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
    flow_type: flowType,
  };

  // Non-enumerable so JSON.stringify / snapshot-style tests that walk own
  // enumerable properties see only the DB columns; server code that
  // explicitly reads `__flowPages` gets the sanitized page list.
  Object.defineProperty(payload, '__flowPages', {
    value: normalizedPages,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(payload, '__flowType', {
    value: flowType,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return payload as typeof payload & { __flowPages: typeof normalizedPages; __flowType: FlowType };
}

/** Extract the normalized custom-page rows attached by buildCampaignWritePayload. */
export function extractFlowPages(payload: unknown): Array<{
  position: number;
  title: string;
  description: string | null;
  image_url: string | null;
  button_text: string | null;
}> {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as { __flowPages?: unknown };
  return Array.isArray(record.__flowPages) ? record.__flowPages as Array<{
    position: number; title: string; description: string | null; image_url: string | null; button_text: string | null;
  }> : [];
}
