import { describe, it, expect } from 'vitest';
import { getClientIpFromHeaders } from '../src/lib/request-ip';

function headers(init: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(init)) h.set(k, v);
  return h;
}

describe('getClientIpFromHeaders (trustworthy IP extraction)', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const h = headers({ 'x-real-ip': '93.184.216.34', 'x-forwarded-for': '1.2.3.4, 93.184.216.34' });
    expect(getClientIpFromHeaders(h)).toBe('93.184.216.34');
  });

  it('uses the RIGHT-MOST x-forwarded-for entry, not the client-supplied left', () => {
    // Attacker spoofs the leftmost value; the trusted proxy appends the real IP.
    const h = headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 93.184.216.34' });
    expect(getClientIpFromHeaders(h)).toBe('93.184.216.34');
  });

  it('skips private entries when scanning x-forwarded-for', () => {
    const h = headers({ 'x-forwarded-for': '6.6.6.6, 192.168.1.1, 172.16.0.1' });
    expect(getClientIpFromHeaders(h)).toBe('6.6.6.6');
  });

  it('returns null when only private/spoofed values are present', () => {
    const h = headers({ 'x-forwarded-for': '127.0.0.1, 10.0.0.2' });
    expect(getClientIpFromHeaders(h)).toBeNull();
    expect(getClientIpFromHeaders(headers({}))).toBeNull();
  });

  it('accepts IPv6 in x-real-ip', () => {
    const h = headers({ 'x-real-ip': '2001:db8::1' });
    expect(getClientIpFromHeaders(h)).toBe('2001:db8::1');
  });
});
