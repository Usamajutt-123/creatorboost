/**
 * Custom-page flow helpers (Open Page + Custom Pages feature).
 *
 * Pure helpers only — safe to import from client components.
 *
 * There are ONLY three allowed flow types and three server-controlled
 * earning multipliers. The multiplier is NEVER accepted from the client.
 */

export const FLOW_TYPES = ['normal', '4_pages', '5_pages'] as const;
export type FlowType = (typeof FLOW_TYPES)[number];

/** Number of custom pages required by a flow. Normal has none. */
export const FLOW_PAGE_COUNT: Record<FlowType, number> = {
  normal: 0,
  '4_pages': 4,
  '5_pages': 5,
};

/**
 * Server-controlled earning multipliers.
 *
 * The set is closed. No admin/creator config can create a new value here,
 * and neither `1_page`, `2_pages`, `3_pages`, `6_pages`, `7_pages`, nor any
 * other page count ever grants a multiplier — only the three flow types
 * that exist below can.
 */
export const FLOW_MULTIPLIER: Record<FlowType, number> = {
  normal: 1.0,
  '4_pages': 1.25,
  '5_pages': 1.4,
};

export const FLOW_LABEL: Record<FlowType, string> = {
  normal: 'Normal',
  '4_pages': '4 Pages',
  '5_pages': '5 Pages',
};

/** Narrow an unknown string coming from the DB or request into a FlowType. */
export function isFlowType(value: unknown): value is FlowType {
  return typeof value === 'string' && (FLOW_TYPES as readonly string[]).includes(value);
}

/**
 * Normalize any stored/loaded value into a valid FlowType. Anything unknown
 * (legacy rows, forged input, empty) falls back to 'normal' so existing
 * campaigns behave exactly as before.
 */
export function coerceFlowType(value: unknown): FlowType {
  return isFlowType(value) ? value : 'normal';
}

/**
 * Server-side multiplier resolver. Callers must ONLY use this — never a
 * value read from a request body, header, cookie or URL parameter.
 */
export function flowMultiplierFor(flowType: unknown): number {
  return FLOW_MULTIPLIER[coerceFlowType(flowType)];
}

export function flowRequiredPageCount(flowType: unknown): number {
  return FLOW_PAGE_COUNT[coerceFlowType(flowType)];
}

export type FlowPageInput = {
  position: number;      // 1-based
  // Title/description are no longer collected per-page: every page inherits
  // the campaign's main name/description, which the server populates.
  title?: string;
  description?: string | null;
  imageUrl?: string | null;
  buttonText?: string | null;
};

/**
 * Validate a page array against the required flow shape.
 *
 * Normal must have zero pages. 4_pages must have exactly 4. 5_pages must
 * have exactly 5. Titles/descriptions are no longer required here because
 * every page inherits the campaign's main name/description (populated
 * server-side by `buildCampaignWritePayload`). This runs on the server (as
 * part of the server action) AND is enforced again by DB checks.
 */
export function validateFlowPages(flowType: FlowType, pages: FlowPageInput[]): string | null {
  const expected = FLOW_PAGE_COUNT[flowType];
  const list = Array.isArray(pages) ? pages : [];

  if (flowType === 'normal') {
    if (list.length !== 0) return 'Normal flow must not include custom pages';
    return null;
  }

  if (list.length !== expected) {
    return `${FLOW_LABEL[flowType]} requires exactly ${expected} pages`;
  }

  // Sort by position for deterministic validation.
  const sorted = [...list].sort((a, b) => a.position - b.position);
  for (let index = 0; index < sorted.length; index++) {
    const page = sorted[index];
    const wantedPosition = index + 1;
    if (page.position !== wantedPosition) {
      return `Page positions must be 1..${expected} without gaps`;
    }
    if (page.description && page.description.length > 2000) return `Page ${wantedPosition} description is too long`;
    if (page.buttonText && page.buttonText.length > 60) return `Page ${wantedPosition} button text is too long`;
    if (page.imageUrl && page.imageUrl.length > 2000) return `Page ${wantedPosition} image URL is too long`;
  }
  return null;
}
