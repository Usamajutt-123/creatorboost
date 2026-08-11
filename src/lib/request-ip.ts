/**
 * Trustworthy client-IP extraction for server-side code.
 *
 * Headers like `x-forwarded-for` can be spoofed by clients, so the left-most
 * entry is NEVER trusted. We use, in order of trust:
 *
 *   1. `request.ip`            — computed by the platform (Vercel/Next).
 *   2. `x-real-ip`             — set by a trusted reverse proxy (nginx/Caddy/CF).
 *   3. `x-forwarded-for`       — the RIGHT-MOST entry, which is appended by the
 *                                proxy closest to the origin and is therefore
 *                                the one the trusted proxy saw. The left-most
 *                                entries may be client-controlled.
 *
 * Any value that does not parse as a public IP is discarded. Returns `null`
 * when no trustworthy public IP is available (callers must handle that —
 * the earnings engine treats a missing IP as an unknown country).
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

/** For Next.js route handlers / middleware. */
export function getClientIp(request: NextRequest): string | null {
  // 1. Platform-computed IP (Vercel sets this; reliable when deployed there).
  const platform = request.ip as string | undefined;
  if (platform) {
    const parsed = parseIp(platform);
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }

  // 2. x-real-ip from a trusted proxy.
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const parsed = parseIp(realIp);
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }

  // 3. Right-most x-forwarded-for entry (appended by the closest trusted proxy).
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean).reverse();
    const parsed = firstPublicIp(parts);
    if (parsed) return parsed;
  }

  return null;
}

/** For server actions / server components that only have a Headers object. */
export function getClientIpFromHeaders(headers: Headers): string | null {
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    const parsed = parseIp(realIp);
    if (parsed && !isPrivateIp(parsed)) return parsed;
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean).reverse();
    const parsed = firstPublicIp(parts);
    if (parsed) return parsed;
  }
  return null;
}
