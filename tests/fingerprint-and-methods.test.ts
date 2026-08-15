/**
 * Unit tests for two small but security-relevant helpers:
 *
 *  * `normalizeDeviceFingerprint` — the fingerprint is client-controlled and
 *    is NOT treated as identity. It is bounded and sanitized so it cannot
 *    carry a malicious payload, and a low-entropy value is discarded rather
 *    than becoming a token every visitor shares.
 *
 *  * `isSupportedWithdrawalMethod` — a method must be representable by the
 *    `withdraw_method` PostgreSQL enum or the withdrawal RPC cannot process
 *    it, no matter what an admin configured.
 */
import { describe, it, expect } from 'vitest';
import { normalizeDeviceFingerprint } from '@/lib/earnings';
import {
  isSupportedWithdrawalMethod,
  SUPPORTED_WITHDRAWAL_METHODS,
} from '@/lib/withdrawal-methods';

describe('device fingerprint handling', () => {
  it('accepts a normal browser fingerprint', () => {
    const fp = 'Mozilla/5.0 (Windows NT 10.0)-en-US-1920x1080';
    expect(normalizeDeviceFingerprint(fp)).toBe(fp);
  });

  it('bounds the length so an oversized payload cannot reach the database', () => {
    const normalized = normalizeDeviceFingerprint('x'.repeat(10_000));
    expect(normalized).not.toBeNull();
    expect(normalized!.length).toBe(200);
  });

  it('strips control characters (no log or storage injection)', () => {
    const normalized = normalizeDeviceFingerprint('abc\u0000def\u001Fghi\u007Fjkl');
    expect(normalized).toBe('abcdefghijkl');
  });

  it('collapses whitespace so trivial variants normalize together', () => {
    expect(normalizeDeviceFingerprint('chrome   windows    1920')).toBe('chrome windows 1920');
    expect(normalizeDeviceFingerprint('  chrome windows 1920  ')).toBe('chrome windows 1920');
  });

  it('discards a low-entropy value instead of making it a shared token', () => {
    // If '1' normalized to '1', every attacker sending '1' would collide with
    // each other and with any real visitor, poisoning duplicate detection.
    for (const weak of ['', ' ', '1', 'ab', 'abcdefg']) {
      expect(normalizeDeviceFingerprint(weak)).toBeNull();
    }
    expect(normalizeDeviceFingerprint('abcdefgh')).toBe('abcdefgh');
  });

  it('rejects non-string input without throwing', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(normalizeDeviceFingerprint(bad as never)).toBeNull();
    }
  });

  it('is not treated as cryptographic identity (documented)', () => {
    // The absence of a fingerprint must never be an error or a grant; it
    // simply yields null and the IP+campaign rule still applies.
    expect(normalizeDeviceFingerprint(undefined)).toBeNull();
  });
});

describe('supported withdrawal methods', () => {
  it('accepts exactly the six methods the enum defines', () => {
    expect([...SUPPORTED_WITHDRAWAL_METHODS].sort()).toEqual(
      ['bank', 'binance', 'easypaisa', 'jazzcash', 'paypal', 'usdt'],
    );
    for (const method of SUPPORTED_WITHDRAWAL_METHODS) {
      expect(isSupportedWithdrawalMethod(method)).toBe(true);
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(isSupportedWithdrawalMethod('  PayPal ')).toBe(true);
    expect(isSupportedWithdrawalMethod('USDT')).toBe(true);
  });

  it('rejects a method the database enum cannot represent', () => {
    for (const bad of ['skrill', 'wise', 'crypto', 'payoneer', 'cashapp', 'bank_transfer']) {
      expect(isSupportedWithdrawalMethod(bad)).toBe(false);
    }
  });

  it('rejects malformed input', () => {
    for (const bad of [null, undefined, '', 42, {}, []]) {
      expect(isSupportedWithdrawalMethod(bad)).toBe(false);
    }
  });
});
