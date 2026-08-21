/**
 * Unit tests for the monetized flow primitives: server-side countdown
 * enforcement, ad slot resolution, session binding and preview tokens.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { hasCountdownElapsed, clampCountdownSeconds, COUNTDOWN_GRACE_MS } from '@/lib/monetization/countdown';
import {
  resolvePageAdSlots,
  deviceCategoryFromUA,
  type MonetizationAdSlot,
} from '@/lib/monetization/settings';
import { flowSubject, flowSessionMatchesRequest } from '@/lib/monetization/flow-session';
import { createFlowPreviewToken, verifyFlowPreviewToken } from '@/lib/monetization/preview';

// ---------------------------------------------------------------------------
// Countdown (server-side authority)
// ---------------------------------------------------------------------------
describe('server-side countdown enforcement', () => {
  const now = 1_700_000_000_000;

  it('accepts an elapsed step', () => {
    const started = new Date(now - 11_000).toISOString();
    expect(hasCountdownElapsed(started, 10, now).ok).toBe(true);
  });

  it('rejects a step that has not waited long enough', () => {
    const started = new Date(now - 4_000).toISOString();
    const check = hasCountdownElapsed(started, 10, now);
    expect(check.ok).toBe(false);
    expect(check.remainingMs).toBeGreaterThan(0);
  });

  it('allows only the configured grace window', () => {
    // elapsed = 10s - grace + 1ms -> just inside the grace -> accepted
    const withinGrace = new Date(now - (10_000 - COUNTDOWN_GRACE_MS + 1)).toISOString();
    expect(hasCountdownElapsed(withinGrace, 10, now).ok).toBe(true);
    // elapsed = 10s - grace - 500ms -> still short of the grace -> rejected
    const tooEarly = new Date(now - (10_000 - COUNTDOWN_GRACE_MS - 500)).toISOString();
    expect(hasCountdownElapsed(tooEarly, 10, now).ok).toBe(false);
  });

  it('treats a missing start time as not elapsed', () => {
    const check = hasCountdownElapsed(null, 10, now);
    expect(check.ok).toBe(false);
    expect(check.remainingMs).toBe(10_000);
  });

  it('clamps nonsensical countdown values', () => {
    expect(clampCountdownSeconds(0)).toBe(1);
    expect(clampCountdownSeconds(999)).toBe(120);
    expect(clampCountdownSeconds(NaN, 10)).toBe(10);
    expect(clampCountdownSeconds(undefined, 7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Ad slot resolution
// ---------------------------------------------------------------------------
describe('ad slot resolution', () => {
  const baseSlot: MonetizationAdSlot = {
    id: 1,
    page_key: 'step_1',
    slot_number: 1,
    enabled: true,
    network: 'adsterra',
    format: 'native_banner',
    zone_id: null,
    code: '<script>window.ad = 1;</script>',
    url: null,
    placement: 'middle',
    device_target: 'all',
    priority: 0,
    frequency: 'every_view',
  };

  it('renders only enabled slots for the page', () => {
    const slots = [baseSlot, { ...baseSlot, id: 2, page_key: 'step_2' }, { ...baseSlot, id: 3, enabled: false }];
    const resolved = resolvePageAdSlots(slots, 'step_1', 'mobile', { enabled: true, testMode: false });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].key).toBe('step_1:1');
  });

  it('is disabled by the page-level switch', () => {
    expect(resolvePageAdSlots([baseSlot], 'step_1', 'desktop', { enabled: false, testMode: false })).toHaveLength(0);
  });

  it('honors device targeting', () => {
    const desktopOnly = { ...baseSlot, device_target: 'desktop' as const };
    const mobileOnly = { ...baseSlot, id: 4, device_target: 'mobile' as const };
    const slots = [desktopOnly, mobileOnly];
    expect(resolvePageAdSlots(slots, 'step_1', 'desktop', { enabled: true, testMode: false })).toHaveLength(1);
    expect(resolvePageAdSlots(slots, 'step_1', 'mobile', { enabled: true, testMode: false })).toHaveLength(1);
  });

  it('substitutes labeled placeholders in test mode', () => {
    const noCode = { ...baseSlot, code: null };
    const resolved = resolvePageAdSlots([noCode], 'step_1', 'desktop', { enabled: true, testMode: true });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].placeholder).toBe(true);
  });

  it('never renders an empty public ad box outside test mode', () => {
    const noCode = { ...baseSlot, code: null };
    expect(resolvePageAdSlots([noCode], 'step_1', 'desktop', { enabled: true, testMode: false })).toHaveLength(0);
  });

  it('rejects malformed code and urls', () => {
    const badCode = { ...baseSlot, code: '   ' };
    const badUrl = { ...baseSlot, code: null, url: 'javascript:alert(1)' };
    const resolved = resolvePageAdSlots([badCode, badUrl], 'step_1', 'desktop', { enabled: true, testMode: false });
    expect(resolved).toHaveLength(0);
  });
});

describe('deviceCategoryFromUA', () => {
  it('classifies coarse device buckets from the trusted header', () => {
    expect(deviceCategoryFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('mobile');
    expect(deviceCategoryFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('mobile');
    expect(deviceCategoryFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('desktop');
    expect(deviceCategoryFromUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
  });
});

// ---------------------------------------------------------------------------
// Session binding
// ---------------------------------------------------------------------------
describe('flow session binding', () => {
  it('binds to the coarse network prefix + UA and tolerates last-octet rotation', () => {
    const subject = flowSubject('203.0.113.42', 'Browser/1');
    expect(subject).toBeTruthy();
    expect(flowSubject('203.0.113.99', 'Browser/1')).toBe(subject);
    expect(flowSubject('203.0.114.1', 'Browser/1')).not.toBe(subject);
    expect(flowSubject('203.0.113.42', 'OtherBrowser/2')).not.toBe(subject);
  });

  it('matches sessions only for the same browser + coarse network', () => {
    const subject = flowSubject('203.0.113.42', 'Browser/1')!;
    expect(flowSessionMatchesRequest({ subject_hash: subject }, '203.0.113.77', 'Browser/1')).toBe(true);
    expect(flowSessionMatchesRequest({ subject_hash: subject }, '198.51.100.5', 'Browser/1')).toBe(false);
    expect(flowSessionMatchesRequest({ subject_hash: subject }, '203.0.113.77', 'Other/9')).toBe(false);
    // Unbound sessions (minted with nothing trustworthy) stay usable.
    expect(flowSessionMatchesRequest({ subject_hash: null }, '198.51.100.5', 'Other/9')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preview tokens
// ---------------------------------------------------------------------------
describe('admin flow preview tokens', () => {
  const CAMPAIGN = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    process.env.UNLOCK_TOKEN_SECRET = 'preview-test-secret';
  });

  it('round-trips a valid token', () => {
    const token = createFlowPreviewToken(CAMPAIGN)!;
    expect(token).toBeTruthy();
    const result = verifyFlowPreviewToken(token, CAMPAIGN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.campaignId).toBe(CAMPAIGN);
  });

  it('rejects tokens for another campaign', () => {
    const token = createFlowPreviewToken(CAMPAIGN)!;
    expect(verifyFlowPreviewToken(token, '44444444-4444-4444-8444-444444444444').ok).toBe(false);
  });

  it('rejects tampered, expired and garbage tokens', () => {
    const token = createFlowPreviewToken(CAMPAIGN)!;
    expect(verifyFlowPreviewToken(`${token}x`, CAMPAIGN).ok).toBe(false);
    const past = createFlowPreviewToken(CAMPAIGN, Date.now() - 20 * 60_000)!;
    expect(verifyFlowPreviewToken(past, CAMPAIGN, Date.now()).ok).toBe(false);
    expect(verifyFlowPreviewToken('garbage', CAMPAIGN).ok).toBe(false);
    expect(verifyFlowPreviewToken(null, CAMPAIGN).ok).toBe(false);
  });

  it('cannot mint a token without a secret', () => {
    delete process.env.UNLOCK_TOKEN_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createFlowPreviewToken(CAMPAIGN)).toBeNull();
  });
});
