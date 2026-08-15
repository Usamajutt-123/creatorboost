/**
 * Trustworthy client-IP extraction for server-side code.
 *
 * DEPLOYMENT ASSUMPTION (explicit, because getting this wrong is a security
 * bug): CreatorBoost is expected to run behind ONE trusted reverse proxy —
 * Vercel's edge network in the reference deployment, or an equivalent
 * nginx/Caddy/Cloudflare tier that terminates the connection and rewrites the
 * forwarding headers itself.
 *
 * Under that assumption, headers are trusted in this order:
 *
 *   1. `x-vercel-forwarded-for` — written by Vercel's edge from the real TCP
 *      peer. A client cannot inject it: Vercel overwrites any inbound copy.
 *   2. `x-real-ip`             — written by a trusted reverse proxy, single
 *      value, not a client-appendable list.
 *   3. `x-forwarded-for`       — the RIGHT-MOST entry only. XFF is a list a
 *      client can prepend to; the trusted proxy APPENDS the peer it actually
 *      saw, so the right-most entry is the only one it controls. The
 *      left-most entry — the value most code naively reads — is fully
 *      client-controlled and is NEVER used.
 *
 * If you deploy behind MORE than one proxy hop, the right-most entry becomes
 * the inner proxy rather than the visitor; set `x-real-ip` at the outermost
 * trusted tier in that topology.
 *
 * Any candidate that does not parse as a PUBLIC IP is discarded, so a spoofed
 * `127.0.0.1`/`10.x`/garbage value cannot become the visitor identity.
 *
 * MISSING IP: both functions return `null`. Callers must handle that — the
 * earnings engine treats it as an unknown country (lowest CPM, never a
 * premium one), the fraud layer stores no ip_hash, and the duplicate window
 * simply does not apply. A missing IP never grants eligibility.
 *
 * Both entry points below run the SAME candidate list through the SAME
 * parser, so geolocation, rate limiting, duplicate detection, IP hashing and
 * the unlock-cookie binding all operate on one identical normalized value.
 */

import type { NextRequest } from 'next/server';
import { parseIp, isPrivateIp } from './geo';

function firstPublicIp(candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const parsed = parseIp(c);
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }
  return null;
}

/**
 * Shared resolution over a plain header getter, so a `NextRequest` and a bare
 * `Headers` object can never disagree about who the visitor is.
 */
function resolveClientIp(get: (name: string) => string | null): string | null {
  // 1. Platform-derived header (Vercel). Take the right-most entry.
  const vercelIp = get('x-vercel-forwarded-for');
  if (vercelIp) {
    const parsed = parseIp(vercelIp.split(',').at(-1)?.trim());
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }

  // 2. x-real-ip from a trusted reverse proxy.
  const realIp = get('x-real-ip');
  if (realIp) {
    const parsed = parseIp(realIp);
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }

  // 3. Right-most x-forwarded-for entry (appended by the closest trusted
  //    proxy). Left-most entries may be client-controlled and are ignored.
  const xff = get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean).reverse();
    const parsed = firstPublicIp(parts);
    if (parsed) return parsed;
  }

  return null;
}

/** For Next.js route handlers / middleware. */
export function getClientIp(request: NextRequest): string | null {
  // Next 16 no longer exposes request.ip, so the trusted forwarding headers
  // above are the only source.
  return resolveClientIp(name => request.headers.get(name));
}

/** For server actions / server components that only have a Headers object. */
export function getClientIpFromHeaders(headers: Headers): string | null {
  return resolveClientIp(name => headers.get(name));
}
