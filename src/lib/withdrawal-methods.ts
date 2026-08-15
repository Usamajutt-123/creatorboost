/**
 * Supported withdrawal methods.
 *
 * `withdrawals.method` is the `withdraw_method` PostgreSQL enum, and
 * `request_withdrawal` casts the chosen method with
 * `lower(p_method)::withdraw_method`. An admin could previously add ANY key to
 * `withdrawal_method_config` — the validator only required
 * `^[a-z][a-z0-9_]*$` — and the method then appeared, enabled, in the
 * creator's withdraw form while every request against it failed at the enum
 * cast with an opaque database error.
 *
 * This list is the single source of truth in application code. The same six
 * labels are enforced as a CHECK constraint on `withdrawal_method_config` in
 * migration 0021, so an unsupported method cannot be configured from either
 * direction, and a test asserts the two lists agree with the enum definition
 * in migration 0001.
 *
 * Adding a seventh method is a deliberate, two-part change:
 *   1. `ALTER TYPE withdraw_method ADD VALUE '<new>'` in a new migration,
 *      and widen the CHECK constraint,
 *   2. add the label here.
 *
 * Pure module (no server-only imports) so it can be shared and unit-tested.
 */

export const SUPPORTED_WITHDRAWAL_METHODS = [
  'jazzcash',
  'easypaisa',
  'paypal',
  'binance',
  'usdt',
  'bank',
] as const;

export type SupportedWithdrawalMethod = (typeof SUPPORTED_WITHDRAWAL_METHODS)[number];

/** True when the database can actually process this method key. */
export function isSupportedWithdrawalMethod(method: unknown): method is SupportedWithdrawalMethod {
  return typeof method === 'string'
    && (SUPPORTED_WITHDRAWAL_METHODS as readonly string[]).includes(method.trim().toLowerCase());
}
