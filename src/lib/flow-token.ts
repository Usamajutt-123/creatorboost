/**
 * Server-signed tokens that gate the custom-page flow multiplier.
 *
 * The visitor cannot skip pages, forge a page number, or replay a completion
 * request to multiply earnings. Progress is a chain of HMAC-signed tokens:
 *
 *   step 1  → server returns token(campaignId, step=1, session, exp)
 *   step 2  → visitor sends step-1 token; server verifies and issues step-2
 *   ...
 *   final   → server issues a completion token that /api/views/record
 *             verifies alongside the existing view-token cookie.
 *
 * The session id is created server-side on step 1 and is embedded in every
 * subsequent token. A replay of the same session is rejected because
 * completion is bound to the final step's HMAC AND to the view-recording
 * idempotency key (existing view idempotency + `flow_session_id` unique
 * index on `views`).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { coerceFlowType, flowRequiredPageCount, type FlowType } from './flow';

const STEP_TTL_MS = 10 * 60_000;         // 10 min per step
const COMPLETION_TTL_MS = 15 * 60_000;   // 15 min completion window

export const FLOW_COMPLETION_COOKIE = 'creatorboost_flow';

type StepPayload = {
  c: string;          // campaignId
  f: FlowType;        // flow type
  s: string;          // session id
  n: number;          // current step (1-based); 0 = not started
  total: number;      // total steps required
  exp: number;
  kind: 'step' | 'complete';
};

function secret(): string | null {
  return (
    process.env.FLOW_TOKEN_SECRET ||
    process.env.UNLOCK_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null
  );
}

function sign(encoded: string, key: string): string {
  return createHmac('sha256', key).update(encoded).digest('base64url');
}

function encode(payload: StepPayload): string | null {
  const key = secret();
  if (!key) return null;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

function decode(token: string | null | undefined): StepPayload | null {
  const key = secret();
  if (!token || !key) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, suppliedSignature] = parts;
  if (!encoded || !suppliedSignature) return null;
  const expected = sign(encoded, key);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuf = Buffer.from(expected);
  if (supplied.length !== expectedBuf.length || !timingSafeEqual(supplied, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StepPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (payload.kind !== 'step' && payload.kind !== 'complete') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Create the very first step token. Assigns a fresh session id. */
export function createInitialStepToken(campaignId: string, flowType: FlowType): { token: string; session: string; total: number } | null {
  const total = flowRequiredPageCount(flowType);
  if (total === 0) return null;
  const session = randomBytes(16).toString('base64url');
  const payload: StepPayload = {
    c: campaignId,
    f: coerceFlowType(flowType),
    s: session,
    n: 0,
    total,
    exp: Date.now() + STEP_TTL_MS,
    kind: 'step',
  };
  const token = encode(payload);
  if (!token) return null;
  return { token, session, total };
}

export type StepAdvanceResult =
  | { ok: false; error: string }
  | {
      ok: true;
      done: false;
      token: string;
      session: string;
      step: number;
      total: number;
    }
  | {
      ok: true;
      done: true;
      completionToken: string;
      session: string;
      total: number;
    };

/**
 * Advance the flow by exactly one page. `nextStep` MUST equal current + 1.
 * Anything else — skipping ahead, going backwards, resubmitting the same
 * step to bump the count — is rejected.
 */
export function advanceStepToken(input: {
  token: string | null | undefined;
  campaignId: string;
  flowType: FlowType;
  nextStep: number;
}): StepAdvanceResult {
  const flowType = coerceFlowType(input.flowType);
  const total = flowRequiredPageCount(flowType);
  if (total === 0) return { ok: false, error: 'This campaign does not use a custom flow' };
  const payload = decode(input.token);
  if (!payload) return { ok: false, error: 'Flow session is invalid or expired' };
  if (payload.c !== input.campaignId) return { ok: false, error: 'Flow session is invalid or expired' };
  if (payload.f !== flowType) return { ok: false, error: 'Flow configuration changed; restart' };
  if (payload.total !== total) return { ok: false, error: 'Flow configuration changed; restart' };
  if (payload.kind !== 'step') return { ok: false, error: 'Flow already completed' };
  if (!Number.isInteger(input.nextStep) || input.nextStep <= 0 || input.nextStep > total) {
    return { ok: false, error: 'Invalid step number' };
  }
  if (input.nextStep !== payload.n + 1) {
    return { ok: false, error: 'You must complete pages in order' };
  }

  if (input.nextStep === total) {
    const completionToken = encode({
      c: input.campaignId,
      f: flowType,
      s: payload.s,
      n: total,
      total,
      exp: Date.now() + COMPLETION_TTL_MS,
      kind: 'complete',
    });
    if (!completionToken) return { ok: false, error: 'Flow service is not configured' };
    return { ok: true, done: true, completionToken, session: payload.s, total };
  }

  const nextToken = encode({
    c: input.campaignId,
    f: flowType,
    s: payload.s,
    n: input.nextStep,
    total,
    exp: Date.now() + STEP_TTL_MS,
    kind: 'step',
  });
  if (!nextToken) return { ok: false, error: 'Flow service is not configured' };
  return { ok: true, done: false, token: nextToken, session: payload.s, step: input.nextStep, total };
}

/**
 * Verify a completion token during view-recording. Returns the session id
 * so the DB uniqueness on `views.flow_session_id` can prevent replay.
 */
export function verifyFlowCompletion(
  token: string | null | undefined,
  campaignId: string,
  flowType: FlowType,
): { ok: true; session: string } | { ok: false } {
  const payload = decode(token);
  if (!payload) return { ok: false };
  if (payload.kind !== 'complete') return { ok: false };
  if (payload.c !== campaignId) return { ok: false };
  if (payload.f !== coerceFlowType(flowType)) return { ok: false };
  if (payload.total !== flowRequiredPageCount(flowType)) return { ok: false };
  if (payload.n !== payload.total) return { ok: false };
  return { ok: true, session: payload.s };
}

export const FLOW_COMPLETION_MAX_AGE_SECONDS = Math.floor(COMPLETION_TTL_MS / 1000);
