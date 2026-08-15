/**
 * Behavioural tests for the server-issued task session.
 *
 * The session is what stops a script POSTing task ids straight to
 * /api/views/record without ever loading the campaign page. It proves TASK
 * INTERACTION with CreatorBoost — never that an external follow/subscribe
 * actually happened, which the platform cannot verify.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTaskSession,
  verifyTaskSession,
  taskConfigFingerprint,
  TASK_SESSION_TTL_MS,
} from '@/lib/task-session';

const CAMPAIGN_A = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_B = '22222222-2222-4222-8222-222222222222';
const TASKS = ['website_visit', 'youtube_subscribe'];
const META = {
  website_visit: { url: 'https://example.com' },
  youtube_subscribe: { url: 'https://youtube.com/@demo' },
};

function withSecret() {
  vi.stubEnv('TASK_SESSION_SECRET', 'test-only-task-session-secret');
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('task session issuance and verification', () => {
  it('accepts a session it just issued for the same campaign and config', () => {
    withSecret();
    const now = 1_800_000_000_000;
    const token = createTaskSession(CAMPAIGN_A, TASKS, META, now);
    expect(token).toBeTruthy();
    expect(verifyTaskSession(token, CAMPAIGN_A, TASKS, META, now + 60_000).ok).toBe(true);
  });

  it('rejects a session issued for a DIFFERENT campaign', () => {
    withSecret();
    const token = createTaskSession(CAMPAIGN_A, TASKS, META);
    const result = verifyTaskSession(token, CAMPAIGN_B, TASKS, META);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'campaign_mismatch' });
  });

  it('rejects a tampered token', () => {
    withSecret();
    const token = createTaskSession(CAMPAIGN_A, TASKS, META)!;
    const [payload, signature] = token.split('.');
    // Same payload, attacker-chosen signature.
    expect(verifyTaskSession(`${payload}.${signature}x`, CAMPAIGN_A, TASKS, META).ok).toBe(false);
    // Re-encoded payload claiming another campaign, original signature.
    const forged = Buffer.from(JSON.stringify({ c: CAMPAIGN_B, t: 'x', i: Date.now(), e: Date.now() + 1e6 }))
      .toString('base64url');
    expect(verifyTaskSession(`${forged}.${signature}`, CAMPAIGN_B, TASKS, META).ok).toBe(false);
  });

  it('expires', () => {
    withSecret();
    const now = 1_800_000_000_000;
    const token = createTaskSession(CAMPAIGN_A, TASKS, META, now);
    expect(verifyTaskSession(token, CAMPAIGN_A, TASKS, META, now + TASK_SESSION_TTL_MS - 1_000).ok).toBe(true);
    expect(verifyTaskSession(token, CAMPAIGN_A, TASKS, META, now + TASK_SESSION_TTL_MS + 1_000).ok).toBe(false);
  });

  it('rejects a session issued before the creator changed a task URL', () => {
    withSecret();
    const token = createTaskSession(CAMPAIGN_A, TASKS, META);
    const changed = { ...META, website_visit: { url: 'https://somewhere-else.example' } };
    const result = verifyTaskSession(token, CAMPAIGN_A, TASKS, changed);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'config_changed' });
  });

  it('rejects a session issued before the creator changed the task LIST', () => {
    withSecret();
    const token = createTaskSession(CAMPAIGN_A, TASKS, META);
    expect(verifyTaskSession(token, CAMPAIGN_A, ['website_visit'], META).ok).toBe(false);
  });

  it('refuses to mint a session without a server secret', () => {
    vi.stubEnv('TASK_SESSION_SECRET', '');
    vi.stubEnv('UNLOCK_TOKEN_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(createTaskSession(CAMPAIGN_A, TASKS, META)).toBeNull();
    expect(verifyTaskSession('anything', CAMPAIGN_A, TASKS, META)).toMatchObject({ reason: 'not_configured' });
  });

  it('rejects malformed input without throwing', () => {
    withSecret();
    for (const bad of [null, undefined, '', 'no-dot', 'a.b.c', 'x'.repeat(5_000)]) {
      expect(() => verifyTaskSession(bad as never, CAMPAIGN_A, TASKS, META)).not.toThrow();
      expect(verifyTaskSession(bad as never, CAMPAIGN_A, TASKS, META).ok).toBe(false);
    }
  });
});

describe('task configuration fingerprint', () => {
  it('is order-independent for the same configuration', () => {
    expect(taskConfigFingerprint(['a', 'b'], { a: { url: 'x' }, b: { url: 'y' } }))
      .toBe(taskConfigFingerprint(['b', 'a'], { a: { url: 'x' }, b: { url: 'y' } }));
  });

  it('changes when a URL changes', () => {
    expect(taskConfigFingerprint(['a'], { a: { url: 'x' } }))
      .not.toBe(taskConfigFingerprint(['a'], { a: { url: 'z' } }));
  });

  it('changes when a task is added or removed', () => {
    expect(taskConfigFingerprint(['a'], { a: { url: 'x' } }))
      .not.toBe(taskConfigFingerprint(['a', 'b'], { a: { url: 'x' }, b: { url: 'y' } }));
  });
});
