import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseIp, isPrivateIp, isPublicIp, sanitizeCountryCode, getCountryFromIP, resetGeoProviders, clearGeoCache } from '../src/lib/geo';

describe('parseIp', () => {
  it('accepts valid IPv4', () => {
    expect(parseIp('8.8.8.8')).toBe('8.8.8.8');
    expect(parseIp('192.0.2.1')).toBe('192.0.2.1');
    expect(parseIp(' 1.2.3.4 ')).toBe('1.2.3.4');
  });

  it('accepts valid IPv6', () => {
    expect(parseIp('2001:4860:4860::8888')).toBe('2001:4860:4860::8888');
    expect(parseIp('2606:4700:4700::1111')).toBe('2606:4700:4700::1111');
    expect(parseIp('::1')).toBe('::1');
  });

  it('rejects garbage, ports, and pseudo values', () => {
    expect(parseIp('unknown')).toBeNull();
    expect(parseIp('0.0.0.0')).toBeNull();
    expect(parseIp('999.1.1.1')).toBeNull();
    expect(parseIp('1.2.3')).toBeNull();
    expect(parseIp('example.com')).toBeNull();
    expect(parseIp('')).toBeNull();
    expect(parseIp(null)).toBeNull();
    expect(parseIp('1.2.3.4.5')).toBeNull();
  });
});

describe('isPrivateIp', () => {
  it('flags private/loopback/link-local ranges', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('0.0.0.0')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('127.0.0.1')).toBe(false);
  });
});

describe('sanitizeCountryCode', () => {
  it('normalizes valid codes and rejects everything else', () => {
    expect(sanitizeCountryCode('us')).toBe('US');
    expect(sanitizeCountryCode('  gb ')).toBe('GB');
    expect(sanitizeCountryCode('USA')).toBeNull();
    expect(sanitizeCountryCode('1')).toBeNull();
    expect(sanitizeCountryCode('')).toBeNull();
    expect(sanitizeCountryCode(null)).toBeNull();
    expect(sanitizeCountryCode('US; DROP TABLE')).toBeNull();
  });
});

describe('getCountryFromIP — safe fallback', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.stubEnv('IP_GEO_PROVIDER', '');
    vi.stubEnv('IP_GEO_SERVICE_URL', '');
    vi.stubEnv('IP_GEO_SERVICE_TOKEN', '');
    vi.stubEnv('IP_GEO_MOCK_COUNTRY', '');
    resetGeoProviders();
    clearGeoCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetGeoProviders();
    clearGeoCache();
  });

  it('returns null for private/loopback IPs without calling any provider', async () => {
    await expect(getCountryFromIP('127.0.0.1')).resolves.toBeNull();
    await expect(getCountryFromIP('10.1.2.3')).resolves.toBeNull();
    await expect(getCountryFromIP('::1')).resolves.toBeNull();
    await expect(getCountryFromIP('unknown')).resolves.toBeNull();
    await expect(getCountryFromIP(null)).resolves.toBeNull();
  });

  it('returns null (safe) when no provider is configured', async () => {
    await expect(getCountryFromIP('8.8.8.8')).resolves.toBeNull();
  });

  it('uses the mock provider when configured (dev only)', async () => {
    vi.stubEnv('IP_GEO_MOCK_COUNTRY', 'us');
    resetGeoProviders();
    clearGeoCache();
    await expect(getCountryFromIP('8.8.8.8')).resolves.toBe('US');
  });

  it('never returns the mock for private IPs even when configured', async () => {
    vi.stubEnv('IP_GEO_MOCK_COUNTRY', 'US');
    resetGeoProviders();
    clearGeoCache();
    await expect(getCountryFromIP('127.0.0.1')).resolves.toBeNull();
  });
});
