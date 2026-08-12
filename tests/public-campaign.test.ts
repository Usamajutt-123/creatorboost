import { afterEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
const adminFromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}));

function chain(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

describe('loadPublicCampaign', () => {
  afterEach(() => {
    vi.resetModules();
    fromMock.mockReset();
    adminFromMock.mockReset();
  });

  it('returns a valid active campaign from public_campaigns without destination_url', async () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'ye-rhi-aik-or-campaign-mso6o9dm',
      name: 'Test Campaign',
      description: 'Hello',
      banner_url: null,
      thumbnail_url: null,
      tasks: ['website_visit'],
      task_metadata: { website_visit: { url: 'https://example.com/task-one' } },
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    fromMock.mockReturnValue(chain({ data: row, error: null }));
    const { loadPublicCampaign } = await import('@/lib/public-campaign');
    const campaign = await loadPublicCampaign('ye-rhi-aik-or-campaign-mso6o9dm');
    expect(campaign?.name).toBe('Test Campaign');
    expect(campaign).not.toHaveProperty('destination_url');
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it('returns null for an invalid slug without querying the database', async () => {
    const { loadPublicCampaign } = await import('@/lib/public-campaign');
    await expect(loadPublicCampaign('../nope')).resolves.toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('does not convert a database error into a silent empty campaign', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: 'permission denied', code: '42501' } }));
    adminFromMock.mockReturnValue(chain({ data: null, error: { message: 'connection refused', code: '08006' } }));
    const { loadPublicCampaign, PublicCampaignLookupError } = await import('@/lib/public-campaign');
    await expect(loadPublicCampaign('valid-slug')).rejects.toBeInstanceOf(PublicCampaignLookupError);
  });

  it('falls back to the filtered campaigns table when the public view is empty but the campaign is live', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: 'relation does not exist', code: '42P01' } }));
    adminFromMock.mockReturnValue(chain({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'live-campaign',
        name: 'Live',
        description: null,
        banner_url: null,
        thumbnail_url: null,
        tasks: ['website_visit'],
        task_metadata: { website_visit: { url: 'https://example.com/task-one' } },
        status: 'active',
        deleted_at: null,
        expires_at: null,
      },
      error: null,
    }));
    const { loadPublicCampaign } = await import('@/lib/public-campaign');
    const campaign = await loadPublicCampaign('live-campaign');
    expect(campaign?.slug).toBe('live-campaign');
  });
});
