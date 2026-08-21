/**
 * Endpoint-level tests for POST /api/flow/advance — the only way a
 * monetized flow step transitions.
 *
 * Covers the security contract:
 *   - the session row (not the client) decides progression,
 *   - the countdown is enforced server-side,
 *   - the final step claims completion exactly once and records the
 *     qualified view + earning through the earnings engine,
 *   - preview/test sessions never generate earnings,
 *   - the destination is validated and returned only at the end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state: {
  session: Record<string, unknown> | null;
  campaign: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  steps: unknown[];
  recordViewCalls: any[];
  recordViewResult: any;
  completedAt: string | null;
  advanceCalls: number;
  events: any[];
} = {
  session: null,
  campaign: null,
  settings: {
    flow_enabled: true,
    test_mode: false,
    default_countdown_seconds: 10,
    steps_count: 4,
  },
  steps: [],
  recordViewCalls: [],
  recordViewResult: null,
  completedAt: null,
  advanceCalls: 0,
  events: [],
};

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => true),
}));

vi.mock('@/lib/monetization/settings', () => ({
  loadMonetizationSettings: vi.fn(async () => state.settings),
  loadActiveSteps: vi.fn(async () => state.steps),
  loadPayoutSettings: vi.fn(async () => ({
    creator_share_percent: 100,
    min_payout_per_view: 0.0005,
    max_payout_per_view: 0.05,
    fraud_adjustment_percent: 0,
    fraud_adjustment_threshold: 40,
  })),
  deviceCategoryFromUA: () => 'desktop',
}));

vi.mock('@/lib/monetization/flow-session', () => ({
  FLOW_COOKIE: 'creatorboost_flow',
  loadFlowSession: vi.fn(async () => state.session),
  flowSessionMatchesRequest: vi.fn(() => true),
  claimFlowCompletion: vi.fn(async () => {
    if (state.completedAt) return false;
    state.completedAt = new Date().toISOString();
    return true;
  }),
  recordFlowEvent: vi.fn(async (input: any) => {
    state.events.push(input);
  }),
}));

vi.mock('@/lib/earnings', () => ({
  recordView: vi.fn(async (input: any) => {
    state.recordViewCalls.push(input);
    return state.recordViewResult ?? { valid: true, reason: undefined, cpm: 5, levelMultiplier: 1, earning: 0.005, countryCode: 'US', fraudScore: 0, duplicate: false, category: 'paid' };
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => (table === 'campaigns' ? { data: state.campaign, error: null } : { data: null, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            is: () => {
              state.advanceCalls++;
              if (table === 'flow_sessions' && patch.completed_at) {
                // completion handled by claimFlowCompletion mock
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { POST } from '@/app/api/flow/advance/route';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    campaign_id: CAMPAIGN_ID,
    creator_id: CREATOR_ID,
    current_step: 1,
    total_steps: 4,
    current_step_started_at: new Date(Date.now() - 11_000).toISOString(),
    tasks_completed: ['website_visit'],
    started_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    completed_at: null,
    subject_hash: null,
    preview_mode: false,
    test_mode: false,
    status: 'active',
    ...overrides,
  };
}

const campaign = {
  id: CAMPAIGN_ID,
  creator_id: CREATOR_ID,
  slug: 'demo',
  status: 'active',
  deleted_at: null,
  expires_at: null,
  destination_url: 'https://creator.example.com/file',
};

function makeRequest(body: unknown) {
  return new NextRequest('https://creatorboost.test/api/flow/advance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
      'x-forwarded-for': '8.8.8.8',
    },
    body: JSON.stringify(body),
  });
}

const steps = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1,
  position: i + 1,
  title: `Step ${i + 1}`,
  countdown_seconds: 10,
  status: 'enabled',
}));

beforeEach(() => {
  state.session = makeSession();
  state.campaign = { ...campaign };
  state.settings = { flow_enabled: true, test_mode: false, default_countdown_seconds: 10, steps_count: 4 };
  state.steps = steps;
  state.recordViewCalls = [];
  state.recordViewResult = null;
  state.completedAt = null;
  state.advanceCalls = 0;
  state.events = [];
});

describe('progression', () => {
  it('rejects a step that is not the session current step', async () => {
    const res = await POST(makeRequest({ step: 3 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.currentStep).toBe(1);
    expect(state.advanceCalls).toBe(0);
  });

  it('advances to the next step and records step_complete', async () => {
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, next: '/go/demo/2' });
    expect(state.events.some((e: any) => e.eventType === 'step_complete' && e.step === 1)).toBe(true);
  });
});

describe('server-side countdown', () => {
  it('refuses to advance before the countdown elapsed', async () => {
    state.session = makeSession({ current_step_started_at: new Date(Date.now() - 3_000).toISOString() });
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.remainingMs).toBeGreaterThan(0);
    expect(state.advanceCalls).toBe(0);
  });

  it('accepts once the server-side elapsed time passes', async () => {
    state.session = makeSession({ current_step_started_at: new Date(Date.now() - 11_000).toISOString() });
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(200);
  });
});

describe('final step', () => {
  const finalSession = (overrides: Record<string, unknown> = {}) => makeSession({ current_step: 4, ...overrides });

  it('records the qualified view exactly once and returns the destination', async () => {
    state.session = finalSession();
    const res = await POST(makeRequest({ step: 4 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, done: true, destination: 'https://creator.example.com/file' });

    // The earning goes through the existing engine with flow attribution.
    expect(state.recordViewCalls).toHaveLength(1);
    const input = state.recordViewCalls[0];
    expect(input.idempotencyKey).toBe(`flow:${SESSION_ID}`);
    expect(input.flowSessionId).toBe(SESSION_ID);
    expect(input.campaign.id).toBe(CAMPAIGN_ID);

    // The destination_visit event is qualified.
    const visit = state.events.find((e: any) => e.eventType === 'destination_visit');
    expect(visit.qualified).toBe(true);
  });

  it('never re-records a replayed completion', async () => {
    state.session = finalSession();
    await POST(makeRequest({ step: 4 }));
    const res = await POST(makeRequest({ step: 4 }));
    expect(res.status).toBe(200);
    expect((await res.json()).destination).toBe('https://creator.example.com/file');
    expect(state.recordViewCalls).toHaveLength(1);
  });

  it('returns a neutral error for an unsafe destination', async () => {
    state.session = finalSession();
    state.campaign = { ...campaign, destination_url: 'javascript:alert(1)' };
    const res = await POST(makeRequest({ step: 4 }));
    expect(res.status).toBe(502);
    expect(state.recordViewCalls).toHaveLength(0);
  });

  it('generates no earnings in test mode', async () => {
    state.settings.test_mode = true;
    state.session = finalSession({ test_mode: true });
    const res = await POST(makeRequest({ step: 4 }));
    expect(res.status).toBe(200);
    expect((await res.json()).destination).toBe('https://creator.example.com/file');
    expect(state.recordViewCalls).toHaveLength(0);
    const visit = state.events.find((e: any) => e.eventType === 'destination_visit');
    expect(visit.qualified).toBe(false);
  });

  it('generates no earnings for preview sessions', async () => {
    state.session = finalSession({ preview_mode: true });
    const res = await POST(makeRequest({ step: 4 }));
    expect(res.status).toBe(200);
    expect(state.recordViewCalls).toHaveLength(0);
  });
});

describe('session failures', () => {
  it('rejects a missing session without explanation', async () => {
    state.session = null;
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.reload).toBe(true);
    // Neutral visitor-facing copy: no ids, no internal reason.
    expect(json.error).toContain('start again');
    expect(JSON.stringify(json)).not.toContain(SESSION_ID);
  });

  it('rejects an expired session', async () => {
    state.session = makeSession({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(409);
  });

  it('rejects a request when the flow is disabled', async () => {
    state.settings.flow_enabled = false;
    const res = await POST(makeRequest({ step: 1 }));
    expect(res.status).toBe(409);
  });
});
