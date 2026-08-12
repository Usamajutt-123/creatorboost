/**
 * Pure financial helpers — no server-only imports.
 * Safe to import from client components. Unit-tested in tests/.
 */

/**
 * Pure per-view earning formula, used by the engine and unit-tested.
 * earning = min((cpm * levelMultiplier) / 1000, maxEarningsPerView)
 */
export function computePerViewEarning(cpm: number, levelMultiplier: number, maxEarningsPerView: number): number {
  const raw = (Number(cpm) * Number(levelMultiplier)) / 1000;
  const parsedCap = Number(maxEarningsPerView);
  // Zero is a legitimate operator setting: it pauses view payouts. Do not
  // turn it into the old implicit $1 fallback.
  const cap = Number.isFinite(parsedCap) ? Math.max(0, parsedCap) : 1;
  return Math.min(Number.isFinite(raw) && raw > 0 ? raw : 0, cap);
}

/**
 * Pure referral commission calculation, unit-tested.
 * commission = round(earning * pct, 2), capped at the earning itself and
 * at a hard maximum, and never negative.
 */
export function computeReferralCommission(earning: number, percentage: number, maxCommission = 100): number {
  const e = Number(earning);
  const pct = Number(percentage);
  if (!Number.isFinite(e) || !Number.isFinite(pct) || e <= 0 || pct <= 0) return 0;
  const raw = (e * pct) / 100;
  return Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, e, Number(maxCommission) || 100));
}

/** Pure withdrawal fee calculation (unit-tested): round(amount * feePct / 100, 2). */
export function computeWithdrawalFee(amount: number, feePercentage: number): number {
  const a = Number(amount);
  const f = Number(feePercentage);
  if (!Number.isFinite(a) || !Number.isFinite(f) || a <= 0 || f <= 0) return 0;
  return Math.round(a * (f / 100) * 100) / 100;
}
