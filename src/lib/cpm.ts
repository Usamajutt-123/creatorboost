/**
 * CPM source of truth helpers.
 * The active rate always comes from cpm_settings in the database.
 * Never trust a browser-supplied CPM.
 */

export type CpmSettings = {
  id: number;
  cpm: number;
  min_cpm: number;
  max_cpm: number;
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CpmValidation =
  | { ok: true; cpm: number; minCpm: number; maxCpm: number }
  | { ok: false; error: string };

/** Existing credited earnings are never rewritten when CPM changes. */
export function existingEarningsRecalculatedOnCpmChange(): boolean {
  return false;
}

export function validateCpmUpdate(input: {
  cpm: unknown;
  minCpm: unknown;
  maxCpm: unknown;
}): CpmValidation {
  const cpm = Number(input.cpm);
  const minCpm = Number(input.minCpm);
  const maxCpm = Number(input.maxCpm);
  if (!Number.isFinite(cpm) || !Number.isFinite(minCpm) || !Number.isFinite(maxCpm)) {
    return { ok: false, error: 'CPM values must be numeric' };
  }
  if (cpm < 0 || minCpm < 0 || maxCpm < 0) {
    return { ok: false, error: 'CPM cannot be negative' };
  }
  if (maxCpm < minCpm) {
    return { ok: false, error: 'Maximum CPM must be greater than or equal to minimum CPM' };
  }
  if (cpm < minCpm || cpm > maxCpm) {
    return { ok: false, error: 'CPM must be within the configured min/max limits' };
  }
  if (cpm > 1_000_000 || maxCpm > 1_000_000) {
    return { ok: false, error: 'CPM exceeds the allowed maximum' };
  }
  return { ok: true, cpm, minCpm, maxCpm };
}

export function parseActiveCpm(row: { cpm?: unknown; is_active?: unknown } | null | undefined): number {
  if (!row || row.is_active === false) return 0;
  const cpm = Number(row.cpm);
  return Number.isFinite(cpm) && cpm >= 0 ? cpm : 0;
}
