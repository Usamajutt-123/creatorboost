import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived destination unlock token.
 *
 * The token is an HMAC over a compact payload and is carried in an HttpOnly,
 * SameSite=Lax cookie. It gates /destination/[campaign] only — it grants no
 * account access, no financial capability and no data access.
 *
 * HARDENING (vs. the previous campaign-only, 15-minute token):
 *
 *   1. TTL reduced 15m -> 5m. The token exists to survive one client-side
 *      redirect, which takes ~1.5s; five minutes is already generous and
 *      shrinks the replay window by two thirds.
 *   2. Binding to a caller-supplied subject (`sub`) — the route binds it to a
 *      hash of the trusted client IP and the User-Agent. A token copied out
 *      of one browser stops working in another, and stops working from
 *      another network.
 *
 *      Binding is DELIBERATELY forgiving where it would hurt real users:
 *      a token minted WITHOUT a subject verifies from anywhere (so an
 *      in-flight unlock across a deploy is not broken), and the subject uses
 *      the /24 (IPv4) or /48 (IPv6) prefix rather than the exact address, so
 *      a mobile visitor whose carrier rotates the last octet mid-redirect is
 *      not sent back to the task page.
 *   3. A random `jti` is included so two tokens minted in the same
 *      millisecond for the same campaign are not byte-identical. This makes
 *      the token unguessable and gives a future server-side revocation list
 *      something to key on.
 *
 * NOT SOLVED HERE: full single-use replay prevention needs server state
 * (a used-jti table). That cost is not justified for a token whose only
 * capability is viewing a public destination URL the visitor already earned,
 * and it would add a database write to the hottest public path. The residual
 * risk is: whoever holds the cookie can re-open the destination page from the
 * same browser and network for up to five minutes. Sensitive operations
 * (earnings, withdrawals, admin) do not accept this token at all.
 */

const TOKEN_TTL_MS = 5 * 60_000;

type UnlockPayload = {
  campaignId: string;
  exp: number;
  /** Optional binding subject (IP-prefix + UA hash). */
  sub?: string;
  /** Random token id — makes tokens unique and unguessable. */
  jti?: string;
};

function secret(): string | null {
  // A dedicated secret is preferred. The service-role key is already a
  // server-only high-entropy secret and provides a secure fallback for
  // deployments that have not added UNLOCK_TOKEN_SECRET yet.
  return process.env.UNLOCK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(encodedPayload: string, key: string): string {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

/**
 * Coarse network prefix: IPv4 /24, IPv6 /48. Coarse on purpose — it stops a
 * token being replayed from an unrelated network without punishing a visitor
 * whose address rotates within their own carrier/ISP block.
 */
function networkPrefix(ip: string | null | undefined): string {
  const value = (ip || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes(':')) return value.split(':').slice(0, 3).join(':');
  const parts = value.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : value;
}

/**
 * Build the binding subject for a request. Returns null when there is nothing
 * trustworthy to bind to, in which case the token is minted unbound rather
 * than bound to an empty string (which would be forgeable).
 */
export function unlockSubject(ip: string | null | undefined, userAgent: string | null | undefined): string | null {
  const prefix = networkPrefix(ip);
  const ua = (userAgent || '').trim();
  if (!prefix && !ua) return null;
  return createHash('sha256').update(`${prefix}|${ua}`).digest('base64url').slice(0, 22);
}

/** Creates a short-lived, campaign-scoped token used only for reward access. */
export function createUnlockToken(campaignId: string, now = Date.now(), subject?: string | null): string | null {
  const key = secret();
  if (!key) return null;
  const payload: UnlockPayload = {
    campaignId,
    exp: now + TOKEN_TTL_MS,
    jti: randomBytes(9).toString('base64url'),
  };
  if (subject) payload.sub = subject;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

/**
 * Verifies a token without exposing its payload on invalid signatures.
 *
 * `subject` is the binding computed for the CURRENT request. A bound token
 * requires it to match; an unbound token (older format, or a request with no
 * trustworthy IP/UA at mint time) is accepted as before.
 */
export function verifyUnlockToken(
  token: string | undefined | null,
  campaignId: string,
  now = Date.now(),
  subject?: string | null,
): boolean {
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
    if (payload.campaignId !== campaignId) return false;
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return false;
    // Reject a token whose expiry is further out than this build can mint —
    // a forged/stale-format long-lived token cannot outlive the TTL.
    if (payload.exp > now + TOKEN_TTL_MS + 5_000) return false;
    // Bound tokens must be presented by the same coarse network + browser.
    if (payload.sub && payload.sub !== subject) return false;
    return true;
  } catch {
    return false;
  }
}

export const UNLOCK_COOKIE = 'creatorboost_unlock';
export const UNLOCK_TOKEN_MAX_AGE_SECONDS = Math.floor(TOKEN_TTL_MS / 1000);
