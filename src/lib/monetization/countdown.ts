/**
 * Server-side countdown enforcement helpers.
 *
 * The client renders the countdown for UX, but the server is the authority:
 * an advance request is only accepted once the session's step start time is
 * at least `seconds` old (minus a small grace for clock/rounding jitter).
 * Waiting is never skippable by editing the page or the request payload.
 */

/** Grace allowed for network/rounding jitter when comparing server clocks. */
export const COUNTDOWN_GRACE_MS = 750;

export function clampCountdownSeconds(value: number | null | undefined, fallback = 10): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 120) : fallback;
}

export type CountdownCheck =
  | { ok: true; remainingMs: number }
  | { ok: false; remainingMs: number };

/**
 * True when the elapsed time since the step started satisfies the required
 * countdown. Pure and deterministic for unit testing.
 */
export function hasCountdownElapsed(
  stepStartedAt: string | number | Date | null,
  seconds: number,
  now: number | Date = Date.now(),
): CountdownCheck {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const required = clampCountdownSeconds(seconds) * 1_000;

  if (!stepStartedAt) {
    return { ok: false, remainingMs: required };
  }

  const startedMs = new Date(stepStartedAt).getTime();
  if (!Number.isFinite(startedMs)) {
    return { ok: false, remainingMs: required };
  }

  const elapsed = nowMs - startedMs;
  const remainingMs = Math.max(0, required - COUNTDOWN_GRACE_MS - elapsed);
  return { ok: remainingMs <= 0, remainingMs };
}
