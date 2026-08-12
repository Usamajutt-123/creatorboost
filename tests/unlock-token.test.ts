import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUnlockToken, verifyUnlockToken } from '@/lib/unlock-token';

const campaignA = '11111111-1111-4111-8111-111111111111';
const campaignB = '22222222-2222-4222-8222-222222222222';

afterEach(() => { vi.unstubAllEnvs(); });

describe('unlock destination token', () => {
  it('is campaign-scoped, signed and short-lived', () => {
    vi.stubEnv('UNLOCK_TOKEN_SECRET', 'test-only-secret');
    const now = 1_700_000_000_000;
    const token = createUnlockToken(campaignA, now);
    expect(token).toBeTruthy();
    expect(verifyUnlockToken(token, campaignA, now + 60_000)).toBe(true);
    expect(verifyUnlockToken(token, campaignB, now + 60_000)).toBe(false);
    expect(verifyUnlockToken(token, campaignA, now + 16 * 60_000)).toBe(false);
  });

  it('rejects tampering and refuses to mint a token without a server secret', () => {
    vi.stubEnv('UNLOCK_TOKEN_SECRET', 'test-only-secret');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const token = createUnlockToken(campaignA, Date.now());
    expect(verifyUnlockToken(`${token}x`, campaignA)).toBe(false);
    vi.stubEnv('UNLOCK_TOKEN_SECRET', '');
    expect(createUnlockToken(campaignA)).toBeNull();
  });
});
