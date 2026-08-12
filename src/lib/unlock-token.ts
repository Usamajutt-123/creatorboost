import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 15 * 60_000;

type UnlockPayload = { campaignId: string; exp: number };

function secret(): string | null {
  // A dedicated secret is preferred. The service-role key is already a
  // server-only high-entropy secret and provides a secure fallback for
  // deployments that have not added UNLOCK_TOKEN_SECRET yet.
  return process.env.UNLOCK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(encodedPayload: string, key: string): string {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

/** Creates a short-lived, campaign-scoped token used only for reward access. */
export function createUnlockToken(campaignId: string, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const payload: UnlockPayload = { campaignId, exp: now + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

/** Verifies a token without exposing its payload on invalid signatures. */
export function verifyUnlockToken(token: string | undefined | null, campaignId: string, now = Date.now()): boolean {
  const key = secret();
  if (!token || !key) return false;
  const [encoded, suppliedSignature, ...rest] = token.split('.');
  if (!encoded || !suppliedSignature || rest.length > 0) return false;

  const expectedSignature = sign(encoded, key);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as UnlockPayload;
    return payload.campaignId === campaignId && Number.isFinite(payload.exp) && payload.exp > now && payload.exp <= now + TOKEN_TTL_MS + 5_000;
  } catch {
    return false;
  }
}

export const UNLOCK_COOKIE = 'creatorboost_unlock';
export const UNLOCK_TOKEN_MAX_AGE_SECONDS = Math.floor(TOKEN_TTL_MS / 1000);
