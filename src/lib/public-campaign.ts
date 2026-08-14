import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isPublicCampaignSlug } from '@/lib/route-params';
import type { TaskMetadata } from '@/lib/tasks';

export const PUBLIC_CAMPAIGN_COLUMNS =
  'id, slug, name, description, banner_url, thumbnail_url, tasks, task_metadata, updated_at' as const;

export type PublicCampaignRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  banner_url: string | null;
  thumbnail_url: string | null;
  tasks: string[] | null;
  task_metadata: TaskMetadata | null;
  updated_at?: string | null;
};

export class PublicCampaignLookupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PublicCampaignLookupError';
  }
}

function sanitize(row: PublicCampaignRecord): PublicCampaignRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    banner_url: row.banner_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    tasks: Array.isArray(row.tasks) ? row.tasks : [],
    task_metadata: row.task_metadata || {},
    updated_at: row.updated_at ?? null,
  };
}

/**
 * Loads the visitor-safe projection of an active, non-deleted, non-expired
 * campaign. Destination URL is never selected.
 *
 * Database errors are not converted into "not found".
 */
export async function loadPublicCampaign(slug: string): Promise<PublicCampaignRecord | null> {
  if (!isPublicCampaignSlug(slug)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('public_campaigns')
    .select(PUBLIC_CAMPAIGN_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (!error && data) return sanitize(data as PublicCampaignRecord);

  if (error) {
    console.error('[public-campaign] public_campaigns query failed', { slug, message: error.message, code: error.code });
  }

  // Service-role fallback uses the same filters and the same safe columns.
  // It exists so a missing/misgranted view cannot 404 a live campaign.
  const admin = createAdminClient();
  const { data: campaign, error: adminError } = await admin
    .from('campaigns')
    .select(`${PUBLIC_CAMPAIGN_COLUMNS}, status, deleted_at, expires_at`)
    .eq('slug', slug)
    .maybeSingle();

  if (adminError) {
    console.error('[public-campaign] campaigns fallback query failed', { slug, message: adminError.message, code: adminError.code });
    throw new PublicCampaignLookupError('Campaign lookup failed', adminError);
  }
  if (!campaign) return null;
  if (campaign.status !== 'active' || campaign.deleted_at) return null;
  if (campaign.expires_at && new Date(campaign.expires_at).getTime() <= Date.now()) return null;
  return sanitize(campaign as PublicCampaignRecord);
}
