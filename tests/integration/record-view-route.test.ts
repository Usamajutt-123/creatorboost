/**
 * Endpoint-level security tests for POST /api/views/record.
 *
 * These drive the real route handler with real `NextRequest` objects and
 * assert the request-level protections that sit in front of the earnings
 * engine: method/content-type/size validation, distributed rate limiting,
 * strict schema validation, server-authoritative user agent, and the
 * disclosure rule that a creator/visitor is never told WHY traffic was not
 * payout-eligible.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.UNLOCK_TOKEN_SECRET = 'test-unlock-secret-value-for-hmac-signing';

// --- mocks -----------------------------------------------------------
const state: {
  campaign: Record<string, unknown> | null;
  rateLimitCalls: Array<{ key: string; limit: number; windowMs: number }>;
  rateLimitAllow: (key: string) => boolean;
  recordViewCalls: any[];
  recordViewResult: any;
  user: { id: string } | null;
} = {
  campaign: null,
  rateLimitCalls: [],
  rateLimitAllow: () => true,
  recordViewCalls: [],
  recordViewResult: null,
  user: null,
};

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async (key: string, limit: number, windowMs: number) => {
    state.rateLimitCalls.push({ key, limit, windowMs });
    return state.rateLimitAllow(key);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.campaign, error: null }),
        }),
      }),
    }),
  }),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
}));

vi.mock('@/lib/earnings', () => ({
  recordView: vi.fn(async (input: any) => {
    state.recordViewCalls.push(input);
    return state.recordViewResult;
  }),
}));

import { POST, GET, PUT, PATCH, DELETE } from '@/app/api/views/record/route';

// --- fixtures ---------------------------------------------------------
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '22222222-2222-4222-8222-222222222222';
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function activeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    creator_id: CREATOR_ID,
    status: 'active',
    slug: 'demo',
    deleted_at: null,
    expires_at: null,
    tasks: ['website_visit'],
    task_metadata: { website_visit: { url: 'https://example.com' } },
    ...overrides,
  };
}

function paidResult(overrides: Record<string, unknown> = {}) {
  return {
    valid: true, reason: undefined, cpm: 5, levelMultiplier: 1.25, earning: 0.00625,
    countryCode: 'US', fraudScore: 0, duplicate: false, category: 'paid', ...overrides,
  };
}

function makeRequest(
  body: unknown,
  {
    method = 'POST',
    contentType = 'application/json',
    headers = {},
    rawBody,
  }: { method?: string; contentType?: string | null; headers?: Record<string, string>; rawBody?: string } = {},
) {
  const h = new Headers({
    'user-agent': REAL_UA,
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'x-forwarded-for': '8.8.8.8',
    ...headers,
  });
  if (contentType) h.set('content-type', contentType);
  const payload = rawBody ?? JSON.stringify(body);
  return new NextRequest('https://creatorboost.test/api/views/record', {
    method,
    headers: h,
    body: method === 'GET' || method === 'HEAD' ? undefined : payload,
  });
}

const validBody = { campaignId: CAMPAIGN_ID, tasksCompleted: ['website_visit'], deviceFingerprint: 'fp-1' };

beforeEach(() => {
  state.campaign = activeCampaign();
  state.rateLimitCalls = [];
  state.rateLimitAllow = () => true;
  state.recordViewCalls = [];
  state.recordViewResult = paidResult();
  state.user = null;
});

// =====================================================================
describe('happy path', () => {
  it('unlocks and reports the earning without any fraud detail', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ unlocked: true, payoutEligible: true, earning: 0.00625 });
    // No leaked internals.
    expect(Object.keys(json)).toEqual(['unlocked', 'payoutEligible', 'earning']);
  });

  it('sets an HttpOnly unlock cookie', async () => {
    const res = await POST(makeRequest(validBody));
    const cookie = res.cookies.get('creatorboost_unlock');
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
  });
});

// =====================================================================
describe('the client user agent is never authoritative', () => {
  it('passes the request header UA, ignoring a spoofed body userAgent', async () => {
    const res = await POST(makeRequest({ ...validBody, userAgent: 'TotallyRealBrowser/1.0' }));
    expect(res.status).toBe(200);
    expect(state.recordViewCalls[0].userAgent).toBe(REAL_UA);
    expect(state.recordViewCalls[0].userAgent).not.toContain('TotallyRealBrowser');
  });

  it('does not adopt the body userAgent when the header is missing', async () => {
    const res = await POST(makeRequest(
      { ...validBody, userAgent: REAL_UA },
      { headers: { 'user-agent': '' } },
    ));
    expect(res.status).toBe(200);
    // Empty header -> empty UA -> the bot analyser treats it as suspicious.
    expect(state.recordViewCalls[0].userAgent).toBe('');
    expect(state.recordViewCalls[0].headerSignals.isBot).toBe(true);
  });

  it('derives bot signals from the real headers of an automation client', async () => {
    await POST(makeRequest(validBody, { headers: { 'user-agent': 'python-requests/2.31.0' } }));
    const signals = state.recordViewCalls[0].headerSignals;
    expect(signals.isBot).toBe(true);
    expect(signals.score).toBeGreaterThanOrEqual(70);
  });

  it('a bot-flagged visit still unlocks but is not payout-eligible', async () => {
    state.recordViewResult = paidResult({ valid: false, reason: 'bot', earning: 0, category: 'bot_or_automation' });
    const res = await POST(makeRequest(validBody, { headers: { 'user-agent': 'curl/8.4.0' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payoutEligible).toBe(false);
    expect(json.earning).toBe(0);
    // The reason and category never reach the client.
    expect(JSON.stringify(json)).not.toContain('bot');
    expect(JSON.stringify(json)).not.toContain('category');
  });
});

// =====================================================================
describe('the client cannot submit financial or security values', () => {
  it.each([
    ['earning', { earning: 100 }],
    ['cpm', { cpm: 999 }],
    ['levelMultiplier', { levelMultiplier: 50 }],
    ['multiplier', { multiplier: 50 }],
    ['cpmCountry', { cpmCountry: 'US' }],
    ['cpm_country_code', { cpm_country_code: 'US' }],
    ['countryCode', { countryCode: 'US' }],
    ['country', { country: 'US' }],
    ['creatorId', { creatorId: CREATOR_ID }],
    ['fraudScore', { fraudScore: 0 }],
    ['valid', { valid: true }],
    ['status', { status: 'valid' }],
    ['ipHash', { ipHash: 'deadbeef' }],
    ['ip', { ip: '1.2.3.4' }],
    ['earnings', { earnings: 5 }],
    ['payoutEligible', { payoutEligible: true }],
  ])('rejects a smuggled %s field with 400', async (_field, extra) => {
    const res = await POST(makeRequest({ ...validBody, ...extra }));
    expect(res.status).toBe(400);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('never forwards a client value into the earnings engine', async () => {
    await POST(makeRequest(validBody));
    const input = state.recordViewCalls[0];
    expect(input).not.toHaveProperty('cpm');
    expect(input).not.toHaveProperty('earning');
    expect(input).not.toHaveProperty('levelMultiplier');
    expect(input).not.toHaveProperty('countryCode');
    expect(input).not.toHaveProperty('fraudScore');
    // The campaign (and therefore the creator) comes from the database.
    expect(input.campaign.creator_id).toBe(CREATOR_ID);
  });

  it('reports only the server-computed earning, not a client-claimed one', async () => {
    state.recordViewResult = paidResult({ earning: 0.00625 });
    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(json.earning).toBe(0.00625);
  });
});

// =====================================================================
describe('malformed and hostile payloads', () => {
  it('rejects invalid JSON with 400', async () => {
    const res = await POST(makeRequest(null, { rawBody: '{not json' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('rejects an empty body with 400', async () => {
    const res = await POST(makeRequest(null, { rawBody: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects a JSON array body with 400', async () => {
    const res = await POST(makeRequest([1, 2, 3]));
    expect(res.status).toBe(400);
  });

  it('rejects a missing campaignId with 400', async () => {
    const res = await POST(makeRequest({ tasksCompleted: ['website_visit'] }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-uuid campaignId with 400', async () => {
    const res = await POST(makeRequest({ ...validBody, campaignId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized payload with 413 even when Content-Length lies', async () => {
    const res = await POST(makeRequest(null, {
      rawBody: JSON.stringify({ ...validBody, deviceFingerprint: 'x'.repeat(20_000) }),
      headers: { 'content-length': '50' },
    }));
    expect(res.status).toBe(413);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('rejects an oversized declared Content-Length with 413 before reading the body', async () => {
    const res = await POST(makeRequest(validBody, { headers: { 'content-length': '999999' } }));
    expect(res.status).toBe(413);
  });

  it('rejects a non-JSON content type with 415', async () => {
    const res = await POST(makeRequest(validBody, { contentType: 'text/plain' }));
    expect(res.status).toBe(415);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('refuses %s with 405', async (_name, handler) => {
    const res = await handler();
    expect(res.status).toBe(405);
  });
});

// =====================================================================
describe('rate limiting', () => {
  it('applies a distributed per-IP limit and a per-campaign limit', async () => {
    await POST(makeRequest(validBody));
    const keys = state.rateLimitCalls.map(c => c.key);
    expect(keys.some(k => k.startsWith('view:8.8.8.8'))).toBe(true);
    expect(keys.some(k => k.startsWith(`view:${CAMPAIGN_ID}:`))).toBe(true);
    // The per-campaign key uses the HASHED ip, never the raw address.
    const campaignKey = keys.find(k => k.startsWith(`view:${CAMPAIGN_ID}:`))!;
    expect(campaignKey).not.toContain('8.8.8.8');
  });

  it('rejects abuse from one IP with 429 and records nothing', async () => {
    state.rateLimitAllow = key => !key.startsWith('view:8.8.8.8');
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('rejects hammering a single campaign with 429', async () => {
    state.rateLimitAllow = key => !key.startsWith(`view:${CAMPAIGN_ID}:`);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('does not leak the limit or the window in the 429 body', async () => {
    state.rateLimitAllow = () => false;
    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(json.error).toBe('Too many requests. Please slow down.');
    expect(JSON.stringify(json)).not.toMatch(/\d{2,}/);
  });

  it('uses the shared rate-limit module, not a local counter', async () => {
    const mod = await import('@/lib/rate-limit');
    await POST(makeRequest(validBody));
    expect(vi.mocked(mod.rateLimit)).toHaveBeenCalled();
  });
});

// =====================================================================
describe('server-side campaign and task verification', () => {
  it('404s an unknown campaign', async () => {
    state.campaign = null;
    expect((await POST(makeRequest(validBody))).status).toBe(404);
  });

  it('404s a paused campaign', async () => {
    state.campaign = activeCampaign({ status: 'paused' });
    expect((await POST(makeRequest(validBody))).status).toBe(404);
  });

  it('404s a deleted campaign', async () => {
    state.campaign = activeCampaign({ deleted_at: new Date().toISOString() });
    expect((await POST(makeRequest(validBody))).status).toBe(404);
  });

  it('410s an expired campaign', async () => {
    state.campaign = activeCampaign({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await POST(makeRequest(validBody))).status).toBe(410);
  });

  it('409s a campaign with an incomplete task configuration', async () => {
    state.campaign = activeCampaign({ task_metadata: {} });
    expect((await POST(makeRequest(validBody))).status).toBe(409);
  });

  it('400s when a configured task was not completed', async () => {
    const res = await POST(makeRequest({ ...validBody, tasksCompleted: [] }));
    expect(res.status).toBe(400);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('rejects a padded task list the campaign never configured', async () => {
    // The completed set must match the configured set exactly, so a client
    // cannot claim extra work to look more legitimate.
    const res = await POST(makeRequest({ ...validBody, tasksCompleted: ['website_visit', 'youtube_subscribe'] }));
    expect(res.status).toBe(400);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('derives requiredTasks from the campaign, not from the client array', async () => {
    state.campaign = activeCampaign({
      tasks: ['website_visit', 'youtube_subscribe'],
      task_metadata: {
        website_visit: { url: 'https://example.com' },
        youtube_subscribe: { url: 'https://youtube.com/@demo' },
      },
    });
    const res = await POST(makeRequest({
      ...validBody,
      tasksCompleted: ['website_visit', 'youtube_subscribe'],
    }));
    expect(res.status).toBe(200);
    expect(state.recordViewCalls[0].requiredTasks).toBe(2);
  });
});

// =====================================================================
describe('session timing is a risk signal, never a credit', () => {
  it('forwards a plausible elapsed time in seconds', async () => {
    const startedAt = Date.now() - 30_000;
    await POST(makeRequest({ ...validBody, startedAt }));
    expect(state.recordViewCalls[0].sessionSeconds).toBeGreaterThan(25);
    expect(state.recordViewCalls[0].sessionSeconds).toBeLessThan(40);
  });

  it('discards a future-dated startedAt', async () => {
    await POST(makeRequest({ ...validBody, startedAt: Date.now() + 600_000 }));
    expect(state.recordViewCalls[0].sessionSeconds).toBeNull();
  });

  it('discards a startedAt older than 24 hours', async () => {
    await POST(makeRequest({ ...validBody, startedAt: Date.now() - 90_000_000 }));
    expect(state.recordViewCalls[0].sessionSeconds).toBeNull();
  });

  it('passes null when startedAt is absent', async () => {
    await POST(makeRequest(validBody));
    expect(state.recordViewCalls[0].sessionSeconds).toBeNull();
  });

  it('rejects a non-numeric startedAt at the schema level', async () => {
    expect((await POST(makeRequest({ ...validBody, startedAt: 'now' }))).status).toBe(400);
  });
});

// =====================================================================
describe('disclosure rule — the visitor learns nothing about anti-fraud', () => {
  it.each([
    ['duplicate_ip_24h', 'duplicate_24h'],
    ['bot', 'bot_or_automation'],
    ['vpn', 'vpn_or_proxy'],
    ['abnormal_traffic', 'suspicious_traffic'],
    ['device_limit', 'earning_cap'],
  ])('returns an identical body for a %s outcome', async (reason, category) => {
    state.recordViewResult = paidResult({ valid: false, reason, earning: 0, category, fraudScore: 88 });
    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(json).toEqual({ unlocked: true, payoutEligible: false, earning: 0 });
    const serialised = JSON.stringify(json);
    expect(serialised).not.toContain(reason);
    expect(serialised).not.toContain(category);
    expect(serialised).not.toContain('88');
    expect(serialised).not.toContain('fraud');
    expect(serialised).not.toContain('duplicate');
    expect(serialised).not.toContain('ip');
  });

  it('never returns the visitor IP or its hash', async () => {
    const res = await POST(makeRequest(validBody));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('8.8.8.8');
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it('a duplicate still unlocks the destination for the visitor', async () => {
    state.recordViewResult = paidResult({
      valid: false, reason: 'duplicate_ip_24h', earning: 0, category: 'duplicate_24h',
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).unlocked).toBe(true);
    expect(res.cookies.get('creatorboost_unlock')?.value).toBeTruthy();
  });
});

// =====================================================================
describe('self-view protection uses the server session', () => {
  it('forwards the authenticated user id from the server session', async () => {
    state.user = { id: CREATOR_ID };
    await POST(makeRequest(validBody));
    expect(state.recordViewCalls[0].sessionUserId).toBe(CREATOR_ID);
  });

  it('passes null for an anonymous visitor', async () => {
    await POST(makeRequest(validBody));
    expect(state.recordViewCalls[0].sessionUserId).toBeNull();
  });
});
