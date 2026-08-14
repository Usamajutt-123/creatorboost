import { beforeEach, describe, expect, it, vi } from 'vitest';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const state: {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tableCalls: string[];
  rpcError: null | { code: string; message: string; details?: string; hint?: string };
} = { rpcCalls: [], tableCalls: [], rpcError: null };

function makeClient() {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'creator-1' } }, error: null })) },
    from: vi.fn((table: string) => {
      state.tableCalls.push(table);
      const query: any = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({ data: { id: 'creator-1', status: 'active' }, error: null });
      return query;
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: CAMPAIGN_ID, error: null };
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => makeClient(),
  createAdminClient: () => makeClient(),
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn(async () => ({ id: null })),
}));

import { createCampaignAction, updateCampaignAction, type CampaignMutationInput } from '@/lib/campaign-actions';

const base: CampaignMutationInput = {
  name: 'Atomic campaign',
  description: 'One campaign description',
  category: 'website_traffic',
  destinationUrl: 'https://example.com/destination',
  status: 'active',
  expiresAt: '',
  tasks: [{ id: 'website_visit', title: '', url: 'https://example.com/task' }],
};

function inputWithPages(count: 0 | 4 | 5): CampaignMutationInput {
  return {
    ...base,
    flowType: count === 0 ? 'normal' : count === 4 ? '4_pages' : '5_pages',
    flowPages: Array.from({ length: count }, (_, index) => ({ position: index + 1 })),
  };
}

beforeEach(() => {
  state.rpcCalls = [];
  state.tableCalls = [];
  state.rpcError = null;
});

describe('atomic campaign actions', () => {
  for (const count of [0, 4, 5] as const) {
    it(`creates the ${count === 0 ? 'normal' : `${count}-page`} flow in one RPC`, async () => {
      const result = await createCampaignAction(inputWithPages(count));
      expect(result).toEqual({ success: true, id: CAMPAIGN_ID });
      expect(state.rpcCalls).toHaveLength(1);
      expect(state.rpcCalls[0].name).toBe('save_campaign_with_pages');
      expect((state.rpcCalls[0].args.p_campaign as { flow_type: string }).flow_type)
        .toBe(count === 0 ? 'normal' : `${count}_pages`);
      expect(state.rpcCalls[0].args.p_pages).toHaveLength(count);
      expect(state.rpcCalls[0].args.p_campaign_id).toBeNull();
      expect(state.tableCalls).toEqual(['profiles']);
    });
  }

  it('edits campaign data and pages through the same atomic RPC', async () => {
    const result = await updateCampaignAction(CAMPAIGN_ID, inputWithPages(5));
    expect(result).toEqual({ success: true, id: CAMPAIGN_ID });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe('save_campaign_with_pages');
    expect(state.rpcCalls[0].args.p_campaign_id).toBe(CAMPAIGN_ID);
    expect(state.rpcCalls[0].args.p_pages).toHaveLength(5);
    expect(state.tableCalls).toEqual(['profiles']);
  });

  it('returns the real Postgres error in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    state.rpcError = {
      code: '23514',
      message: 'Campaign flow 4_pages requires exactly 4 pages, found 0',
      details: 'deferred constraint trigger',
    };
    const result = await createCampaignAction(inputWithPages(4));
    expect(result).toEqual({
      success: false,
      error: 'Campaign flow 4_pages requires exactly 4 pages, found 0',
    });
    vi.unstubAllEnvs();
  });
});
