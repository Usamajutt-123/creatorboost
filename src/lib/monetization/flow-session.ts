/**
 * Server-side flow session management.
 *
 * A flow session is created only by the unlock endpoint AFTER the visitor
 * completed every required task (verified server-side). The session id is a
 * random UUID stored in an HttpOnly cookie; the database row is the
 * authority for progression. A visitor can therefore never advance by
 * editing a URL or a parameter: every step page and every advance request is
 * validated against the row.
 *
 * Binding: like the existing unlock token, the session is bound to a coarse
 * network prefix + user-agent hash so a copied session id cannot be replayed
 * from another browser or network, while remaining tolerant of mobile
 * carrier IP rotation within a /24 or /48.
 *
 * Privacy: no raw IP or full user agent is stored. Only hashes.
 */

import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';

export const FLOW_COOKIE = 'creatorboost_flow';

/** Sessions are short-lived by design; TTL comes from admin settings. */
export const DEFAULT_FLOW_TTL_MINUTES = 30;
export const MAX_FLOW_TTL_MINUTES = 240;

export type FlowEventType =
  | 'task_start' | 'task_complete' | 'unlock' | 'flow_start'
  | 'step_start' | 'step_complete' | 'destination_visit';

export type FlowSessionRow = {
  id: string;
  campaign_id: string;
  creator_id: string;
  current_step: number;
  total_steps: number;
  current_step_started_at: string | null;
  tasks_completed: string[];
  started_at: string;
  expires_at: string;
  completed_at: string | null;
  subject_hash: string | null;
  preview_mode: boolean;
  test_mode: boolean;
  status: string;
};

function networkPrefix(ip: string | null | undefined): string {
  const value = (ip || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes(':')) return value.split(':').slice(0, 3).join(':');
  const parts = value.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : value;
}

/**
 * Coarse binding subject: network prefix + user agent, hashed. Null only
 * when there is nothing trustworthy to bind to.
 */
export function flowSubject(ip: string | null | undefined, userAgent: string | null | undefined): string | null {
  const prefix = networkPrefix(ip);
  const ua = (userAgent || '').trim();
  if (!prefix && !ua) return null;
  return createHash('sha256').update(`${prefix}|${ua}`).digest('base64url').slice(0, 22);
}

/** True when the session was minted for this browser + coarse network. */
export function flowSessionMatchesRequest(
  session: Pick<FlowSessionRow, 'subject_hash'>,
  ip: string | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  // Unbound sessions (nothing trustworthy at mint time) stay usable.
  if (!session.subject_hash) return true;
  return session.subject_hash === flowSubject(ip, userAgent);
}

export type CreateFlowSessionInput = {
  campaignId: string;
  creatorId: string;
  totalSteps: number;
  ttlMinutes: number;
  tasksCompleted: string[];
  ip: string | null;
  userAgent: string | null;
  previewMode?: boolean;
  testMode?: boolean;
};

/** Inserts a new session and returns its id. Throws on database failure. */
export async function createFlowSession(input: CreateFlowSessionInput): Promise<string> {
  const supabase = createAdminClient();
  const ttlMinutes = Math.min(
    Math.max(Math.trunc(input.ttlMinutes) || DEFAULT_FLOW_TTL_MINUTES, 5),
    MAX_FLOW_TTL_MINUTES,
  );
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from('flow_sessions')
    .insert({
      campaign_id: input.campaignId,
      creator_id: input.creatorId,
      total_steps: input.totalSteps,
      current_step: 0,
      tasks_completed: input.tasksCompleted.slice(0, 20),
      expires_at: expiresAt,
      subject_hash: flowSubject(input.ip, input.userAgent),
      preview_mode: input.previewMode === true,
      test_mode: input.testMode === true,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[flow-session] create failed', error?.message);
    throw new Error('Flow session could not be created');
  }
  return data.id;
}

export async function loadFlowSession(id: string | null | undefined): Promise<FlowSessionRow | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('flow_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as FlowSessionRow | null) ?? null;
}

/**
 * Marks a step as started when the visitor is advancing to it.
 *
 * The WHERE current_step < step guard makes this race-safe: concurrent
 * renders of the same step only "start" it once, and a refresh of an
 * already-reached step never resets the countdown clock.
 */
export async function startStep(sessionId: string, step: number, now = new Date()): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('flow_sessions')
    .update({ current_step: step, current_step_started_at: now.toISOString() })
    .eq('id', sessionId)
    .lt('current_step', step)
    .is('completed_at', null);
  return !error;
}

/**
 * Claims the completion of the whole flow exactly once.
 *
 * Returns true only for the request whose UPDATE actually transitioned the
 * row, so a refresh or a replayed completion can never double-record the
 * qualified view (the database additionally enforces this through the
 * idempotency key and the unique (creator_id, flow_session_id) index).
 */
export async function claimFlowCompletion(sessionId: string, now = new Date()): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('flow_sessions')
    .update({ completed_at: now.toISOString(), status: 'completed' })
    .eq('id', sessionId)
    .is('completed_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[flow-session] completion claim failed', error.message);
    return false;
  }
  return Boolean(data);
}

export type RecordEventInput = {
  flowSessionId: string | null;
  campaignId: string;
  creatorId: string;
  eventType: FlowEventType;
  step?: number | null;
  qualified?: boolean;
  testMode?: boolean;
  previewMode?: boolean;
  countryCode?: string | null;
  deviceCategory?: 'mobile' | 'desktop' | 'tablet' | null;
};

/**
 * Appends one funnel event. Failures are logged and never break the visitor
 * flow; the unique index on (session, step_start/step_complete) makes the
 * lifecycle events idempotent under refresh/replay.
 */
export async function recordFlowEvent(input: RecordEventInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('flow_events').insert({
      flow_session_id: input.flowSessionId,
      campaign_id: input.campaignId,
      creator_id: input.creatorId,
      event_type: input.eventType,
      step: input.step ?? null,
      qualified: input.qualified === true,
      test_mode: input.testMode === true,
      preview_mode: input.previewMode === true,
      country_code: input.countryCode || null,
      device_category: input.deviceCategory || null,
    });
    if (error && error.code !== '23505') {
      console.error('[flow-session] event insert failed', error.message);
    }
  } catch (error) {
    console.error('[flow-session] event insert threw', error);
  }
}
