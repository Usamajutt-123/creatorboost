import { describe, expect, it } from 'vitest';
import { buildCampaignWritePayload } from '@/lib/campaign-payload';
import { isCampaignUuid, isPublicCampaignSlug, resolveParams } from '@/lib/route-params';
import { configuredTaskUrl } from '@/lib/tasks';
import { createUnlockToken, verifyUnlockToken } from '@/lib/unlock-token';

const CAMPAIGN_A = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_B = '22222222-2222-4222-8222-222222222222';

describe('Next.js 16 params handling', () => {
  it('awaits promised dynamic params used by /c/[slug] and campaign routes', async () => {
    const promised = Promise.resolve({ slug: 'ye-rhi-aik-or-campaign-mso6o9dm', id: CAMPAIGN_A, campaign: 'demo-campaign' });
    await expect(resolveParams(promised)).resolves.toEqual({
      slug: 'ye-rhi-aik-or-campaign-mso6o9dm',
      id: CAMPAIGN_A,
      campaign: 'demo-campaign',
    });
  });

  it('accepts already-resolved params objects without throwing', async () => {
    await expect(resolveParams({ slug: 'valid-slug' })).resolves.toEqual({ slug: 'valid-slug' });
  });

  it('validates public slugs and campaign UUIDs separately', () => {
    expect(isPublicCampaignSlug('ye-rhi-aik-or-campaign-mso6o9dm')).toBe(true);
    expect(isPublicCampaignSlug('../secret')).toBe(false);
    expect(isCampaignUuid(CAMPAIGN_A)).toBe(true);
    expect(isCampaignUuid('ye-rhi-aik-or-campaign-mso6o9dm')).toBe(false);
  });
});

describe('campaign create/edit payload', () => {
  const input = {
    name: 'Test Campaign',
    description: 'Unlock after two tasks',
    category: 'website_traffic' as const,
    destinationUrl: 'https://example.com/final-destination',
    status: 'active' as const,
    expiresAt: '',
    tasks: [
      { id: 'website_visit' as const, title: '', url: 'https://example.com/task-one' },
      { id: 'custom' as const, title: 'Visit the second page', url: 'https://example.com/task-two' },
    ],
  };

  it('persists the exact creator-provided task and destination URLs', () => {
    const payload = buildCampaignWritePayload(input);
    expect(payload.destination_url).toBe('https://example.com/final-destination');
    expect(payload.tasks).toEqual(['website_visit', 'custom']);
    expect(payload.task_metadata.website_visit.url).toBe('https://example.com/task-one');
    expect(payload.task_metadata.custom.url).toBe('https://example.com/task-two');
    expect(configuredTaskUrl(payload.task_metadata, 'website_visit')).toBe('https://example.com/task-one');
    expect(configuredTaskUrl(payload.task_metadata, 'custom')).toBe('https://example.com/task-two');
    expect(JSON.stringify(payload)).not.toContain('youtube.com');
    expect(JSON.stringify(payload)).not.toContain('google.com');
  });

  it('never includes financial or ownership columns in the write payload', () => {
    const payload = buildCampaignWritePayload(input);
    expect(payload).not.toHaveProperty('total_views');
    expect(payload).not.toHaveProperty('valid_views');
    expect(payload).not.toHaveProperty('invalid_views');
    expect(payload).not.toHaveProperty('total_earnings');
    expect(payload).not.toHaveProperty('creator_id');
    expect(payload).not.toHaveProperty('slug');
  });

  it('rejects missing and invalid task URLs', () => {
    expect(() => buildCampaignWritePayload({
      ...input,
      tasks: [{ id: 'website_visit', title: '', url: '' }],
    })).toThrow(/valid http\(s\) URL/i);
    expect(() => buildCampaignWritePayload({
      ...input,
      tasks: [{ id: 'website_visit', title: '', url: 'javascript:alert(1)' }],
    })).toThrow(/valid http\(s\) URL/i);
  });
});

describe('unlock token gate', () => {
  it('accepts a valid campaign-scoped token and rejects expired or foreign tokens', () => {
    process.env.UNLOCK_TOKEN_SECRET = 'campaign-lifecycle-secret';
    const now = 1_700_000_000_000;
    const token = createUnlockToken(CAMPAIGN_A, now);
    expect(verifyUnlockToken(token, CAMPAIGN_A, now + 1_000)).toBe(true);
    expect(verifyUnlockToken(token, CAMPAIGN_B, now + 1_000)).toBe(false);
    expect(verifyUnlockToken(token, CAMPAIGN_A, now + 16 * 60_000)).toBe(false);
    expect(verifyUnlockToken('not-a-token', CAMPAIGN_A, now)).toBe(false);
  });
});
