import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isPublicCampaignSlug } from '@/lib/route-params';
import type { TaskMetadata } from '@/lib/tasks';
import { coerceFlowType, type FlowType } from '@/lib/flow';

export const PUBLIC_CAMPAIGN_COLUMNS =
  'id, slug, name, description, banner_url, thumbnail_url, tasks, task_metadata, flow_type, updated_at' as const;

export type PublicCampaignPage = {
  position: number;
  title: string;
  description: string | null;
  image_url: string | null;
  button_text: string | null;
};

export type PublicCampaignRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  banner_url: string | null;
  thumbnail_url: string | null;
  tasks: string[] | null;
  task_metadata: TaskMetadata | null;
  flow_type: FlowType;
  pages: PublicCampaignPage[];
  updated_at?: string | null;
};

export class PublicCampaignLookupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PublicCampaignLookupError';
  }
}

function sanitize(row: Partial<PublicCampaignRecord> & { flow_type?: unknown }, pages: PublicCampaignPage[] = []): PublicCampaignRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name ?? ''),
    description: row.description ?? null,
    banner_url: row.banner_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    tasks: Array.isArray(row.tasks) ? row.tasks : [],
    task_metadata: row.task_metadata || {},
    flow_type: coerceFlowType(row.flow_type),
    pages,
    updated_at: row.updated_at ?? null,
  };
}

async function loadPagesFor(campaignId: string): Promise<PublicCampaignPage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaign_pages')
    .select('position, title, description, image_url, button_text')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true });
  if (error) {
    console.error('[public-campaign] pages fetch failed', { campaignId, message: error.message, code: error.code });
    return [];
  }
  return (data || []).map(page => ({
    position: Number(page.position),
    title: String(page.title || ''),
    description: page.description ?? null,
    image_url: page.image_url ?? null,
    button_text: page.button_text ?? null,
  }));
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

  if (!error && data) {
    const flow = coerceFlowType((data as { flow_type?: unknown }).flow_type);
    const pages = flow === 'normal' ? [] : await loadPagesFor(String((data as { id: string }).id));
    return sanitize(data as Partial<PublicCampaignRecord>, pages);
  }

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
  const flow = coerceFlowType((campaign as { flow_type?: unknown }).flow_type);
  const pages = flow === 'normal' ? [] : await loadPagesFor(String((campaign as { id: string }).id));
  return sanitize(campaign as Partial<PublicCampaignRecord>, pages);
}
