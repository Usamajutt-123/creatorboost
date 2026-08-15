/**
 * Server-issued task sessions.
 * ----------------------------------------------------------------
 * WHAT THIS DOES — AND WHAT IT HONESTLY DOES NOT
 *
 * CreatorBoost cannot verify that a visitor actually subscribed to a YouTube
 * channel, joined a Telegram group or followed an Instagram account. There is
 * no third-party verification integration, and this module does not pretend
 * otherwise. What it verifies is TASK INTERACTION:
 *
 *   * the task list was issued BY THE SERVER for this specific campaign,
 *   * the campaign's task configuration has not changed since it was issued,
 *   * the submitted task ids are exactly the issued ones (no invented ids,
 *     no ids borrowed from another campaign),
 *   * the session has not expired,
 *   * the session is bound to the campaign it was issued for.
 *
 * Before this existed, the endpoint accepted any `tasksCompleted` array the
 * browser sent and only checked it against the campaign's CURRENT task list,
 * so a script could POST the task ids directly without ever loading the page.
 * It still can't be stopped from doing so entirely — nothing client-side can
 * — but it now has to obtain a server-signed token first, that token expires,
 * and it stops working the moment the creator edits the campaign.
 *
 * DESIGN: stateless HMAC. No new table, no new infrastructure, no extra
 * round-trip on the hottest public route. The secret is server-only.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Task sessions are short-lived: long enough to complete tasks, no longer. */
export const TASK_SESSION_TTL_MS = 30 * 60_000;

/** A session issued far in the future is a clock/forgery problem, not a visit. */
const MAX_CLOCK_SKEW_MS = 60_000;

export type TaskSessionPayload = {
  /** Campaign the session was issued for. */
  c: string;
  /** Fingerprint of the campaign's task configuration at issue time. */
  t: string;
  /** Issued-at, epoch ms. */
  i: number;
  /** Expires-at, epoch ms. */
  e: number;
};

export type TaskSessionVerification =
  | { ok: true; payload: TaskSessionPayload }
  | { ok: false; reason: 'not_configured' | 'malformed' | 'bad_signature' | 'expired' | 'campaign_mismatch' | 'config_changed' };

function secret(): string | null {
  // A dedicated secret is preferred. The service-role key is already a
  // server-only, high-entropy secret and is a safe fallback for deployments
  // that have not added TASK_SESSION_SECRET yet.
  return process.env.TASK_SESSION_SECRET || process.env.UNLOCK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(encoded: string, key: string): string {
  return createHmac('sha256', key).update(encoded).digest('base64url');
}

/**
 * Stable fingerprint of a campaign's task configuration.
 *
 * Includes the task ids AND their configured URLs, so a creator who swaps a
 * task's destination after a session was issued invalidates that session
 * instead of having the old session unlock the new configuration.
 */
export function taskConfigFingerprint(
  tasks: readonly string[],
  metadata: Record<string, { title?: string; url?: string }> | null | undefined,
): string {
  const canonical = [...tasks]
    .map(String)
    .sort()
    .map(task => `${task}=${(metadata?.[task]?.url || '').trim()}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22);
}

/** Issue a task session for a campaign. Returns null when no secret exists. */
export function createTaskSession(
  campaignId: string,
  tasks: readonly string[],
  metadata: Record<string, { title?: string; url?: string }> | null | undefined,
  now = Date.now(),
): string | null {
  const key = secret();
  if (!key) return null;
  const payload: TaskSessionPayload = {
    c: campaignId,
    t: taskConfigFingerprint(tasks, metadata),
    i: now,
    e: now + TASK_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

/**
 * Verify a task session against the campaign's CURRENT configuration.
 *
 * Every failure mode is distinguished internally (for server logs) but the
 * caller must collapse them into one neutral visitor-facing message — the
 * reason must never tell a prober which check failed.
 */
export function verifyTaskSession(
  token: string | null | undefined,
  campaignId: string,
  tasks: readonly string[],
  metadata: Record<string, { title?: string; url?: string }> | null | undefined,
  now = Date.now(),
): TaskSessionVerification {
  const key = secret();
  if (!key) return { ok: false, reason: 'not_configured' };
  if (typeof token !== 'string' || token.length === 0 || token.length > 2_000) {
    return { ok: false, reason: 'malformed' };
  }

  const [encoded, supplied, ...rest] = token.split('.');
  if (!encoded || !supplied || rest.length > 0) return { ok: false, reason: 'malformed' };

  const expectedSignature = sign(encoded, key);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  let payload: TaskSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TaskSessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof payload?.c !== 'string' || typeof payload?.t !== 'string'
    || !Number.isFinite(payload?.i) || !Number.isFinite(payload?.e)) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.c !== campaignId) return { ok: false, reason: 'campaign_mismatch' };
  // Expiry, plus a sanity bound so a forged far-future `e` cannot create an
  // immortal session even if the secret ever leaked into a signed token.
  if (payload.e <= now || payload.e > payload.i + TASK_SESSION_TTL_MS + MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired' };
  }
  if (payload.i > now + MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'expired' };
  if (payload.t !== taskConfigFingerprint(tasks, metadata)) return { ok: false, reason: 'config_changed' };

  return { ok: true, payload };
}
