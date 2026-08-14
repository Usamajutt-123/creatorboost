/**
 * CPM source of truth helpers.
 * Global CPM comes from cpm_settings. An active country_tiers rate for the
 * server-controlled CPM country can override it. Never trust a browser-supplied
 * CPM or creator-editable display country.
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

function numericInput(value: unknown): number {
  if (value === null || value === undefined || typeof value === 'boolean') return Number.NaN;
  if (typeof value === 'string' && value.trim() === '') return Number.NaN;
  return Number(value);
}

/** Existing credited earnings are never rewritten when CPM changes. */
export function existingEarningsRecalculatedOnCpmChange(): boolean {
  return false;
}

export function validateCpmUpdate(input: {
  cpm: unknown;
  minCpm: unknown;
  maxCpm: unknown;
}): CpmValidation {
  const cpm = numericInput(input.cpm);
  const minCpm = numericInput(input.minCpm);
  const maxCpm = numericInput(input.maxCpm);
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

export const COUNTRY_TIERS = ['tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
export type CountryTierName = typeof COUNTRY_TIERS[number];

/** country_tiers.cpm_* are NUMERIC(6,2), so 9,999.99 is the largest storable value. */
export const MAX_COUNTRY_CPM = 9_999.99;

export type CountryTierValidation =
  | {
      ok: true;
      countryCode: string;
      countryName: string;
      tier: CountryTierName;
      cpmMin: number;
      cpmMax: number;
      cpmDefault: number;
      payoutPercentage: number;
      active: boolean;
    }
  | { ok: false; error: string };

/**
 * Validate a complete country_tiers row after merging an admin patch with the
 * stored row. Validating the merged row is important: PostgreSQL enforces the
 * min/default/max check constraint on every UPDATE, so validating only the
 * fields the browser changed makes an otherwise valid multi-field edit fail
 * depending on which input was changed first.
 */
export function validateCountryTier(input: {
  countryCode: unknown;
  countryName: unknown;
  tier: unknown;
  cpmMin: unknown;
  cpmMax: unknown;
  cpmDefault: unknown;
  payoutPercentage: unknown;
  active: unknown;
}): CountryTierValidation {
  const countryCode = String(input.countryCode ?? '').trim().toUpperCase();
  const countryName = String(input.countryName ?? '').trim();
  const tier = String(input.tier ?? '') as CountryTierName;
  const cpmMin = numericInput(input.cpmMin);
  const cpmMax = numericInput(input.cpmMax);
  const cpmDefault = numericInput(input.cpmDefault);
  const payoutPercentage = numericInput(input.payoutPercentage);

  if (!/^[A-Z]{2}$/.test(countryCode)) return { ok: false, error: 'Country code must have two letters' };
  if (!countryName || countryName.length > 100) return { ok: false, error: 'Country name is invalid' };
  if (!COUNTRY_TIERS.includes(tier)) return { ok: false, error: 'Country tier is invalid' };
  if (![cpmMin, cpmMax, cpmDefault, payoutPercentage].every(Number.isFinite)) {
    return { ok: false, error: 'Country CPM values must be numeric' };
  }
  if ([cpmMin, cpmMax, cpmDefault].some(value => value < 0 || value > MAX_COUNTRY_CPM)) {
    return { ok: false, error: 'Country CPM is outside the allowed range' };
  }
  if (cpmMax < cpmMin) return { ok: false, error: 'Maximum CPM must be greater than or equal to minimum CPM' };
  if (cpmDefault < cpmMin || cpmDefault > cpmMax) {
    return { ok: false, error: 'Default CPM must be within the configured min/max limits' };
  }
  if (payoutPercentage < 0 || payoutPercentage > 100) {
    return { ok: false, error: 'Payout percentage must be between 0 and 100' };
  }
  if (typeof input.active !== 'boolean') return { ok: false, error: 'Country active flag is invalid' };

  return {
    ok: true,
    countryCode,
    countryName,
    tier,
    cpmMin,
    cpmMax,
    cpmDefault,
    payoutPercentage,
    active: input.active,
  };
}

export type CountryCpmOverride = {
  cpm_default?: unknown;
  active?: unknown;
};

export type ResolvedCreatorCpm = {
  cpm: number;
  source: 'country' | 'global';
};

/**
 * Country-specific CPM overrides Global CPM when an active, valid
 * country_tiers rate exists. Missing, disabled, or invalid country
 * rates leave Global CPM unchanged.
 */
export function resolveCreatorCpm(
  globalCpm: number,
  countryRate: CountryCpmOverride | null | undefined,
): ResolvedCreatorCpm {
  const fallback = Number.isFinite(globalCpm) && globalCpm >= 0 ? globalCpm : 0;
  if (!countryRate || countryRate.active === false) {
    return { cpm: fallback, source: 'global' };
  }
  const countryCpm = Number(countryRate.cpm_default);
  if (!Number.isFinite(countryCpm) || countryCpm < 0) {
    return { cpm: fallback, source: 'global' };
  }
  return { cpm: countryCpm, source: 'country' };
}
