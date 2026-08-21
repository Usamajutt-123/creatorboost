/**
 * Admin flow preview tokens.
 *
 * An admin can walk the public flow without polluting analytics or
 * generating earnings: the preview link carries a short-lived HMAC token,
 * issued by an authorized server action, that allows ONE preview session to
 * be created. The session row itself is marked preview_mode; every public
 * page and endpoint then skips event recording and payout accounting while
 * rendering a visible "Preview mode" banner.
 *
 * The token is campaign-bound, expires quickly, and can only be produced by
 * an authenticated admin — visitors cannot mint one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;

type PreviewPayload = {
  /** Campaign id the preview is bound to. */
  c: string;
  /** Issued-at, epoch ms. */
  i: number;
  /** Expires-at, epoch ms. */
  e: number;
};

function secret(): string | null {
  return process.env.UNLOCK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(encoded: string, key: string): string {
  return createHmac('sha256', key).update(encoded).digest('base64url');
}

export function createFlowPreviewToken(campaignId: string, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const payload: PreviewPayload = { c: campaignId, i: now, e: now + PREVIEW_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

export type PreviewVerification =
  | { ok: true; campaignId: string }
  | { ok: false };

export function verifyFlowPreviewToken(token: string | null | undefined, campaignId: string, now = Date.now()): PreviewVerification {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 1_000) return { ok: false };

  const [encoded, supplied, ...rest] = token.split('.');
  if (!encoded || !supplied || rest.length > 0) return { ok: false };

  const expected = Buffer.from(sign(encoded, key));
  const given = Buffer.from(supplied);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false };

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PreviewPayload;
    if (payload.c !== campaignId) return { ok: false };
    if (!Number.isFinite(payload.i) || !Number.isFinite(payload.e)) return { ok: false };
    if (payload.e <= now || payload.e > payload.i + PREVIEW_TTL_MS + MAX_CLOCK_SKEW_MS) return { ok: false };
    if (payload.i > now + MAX_CLOCK_SKEW_MS) return { ok: false };
    return { ok: true, campaignId: payload.c };
  } catch {
    return { ok: false };
  }
}
