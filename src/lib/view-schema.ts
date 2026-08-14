import { z } from 'zod';

/**
 * Strict schema for POST /api/views/record.
 *
 * `.strict()` rejects any unknown key, so a client that tries to smuggle
 * creatorId, countryCode, cpm, earning, fraudScore, multiplier, ipHash,
 * cpmCountry or a valid/paid status is rejected outright.
 *
 * NOTHING accepted here is authoritative for money or security:
 *
 *   campaignId        -> re-validated against the database server-side
 *   deviceFingerprint -> a weak correlation hint only; the server never
 *                        trusts it for eligibility
 *   userAgent         -> accepted for backwards compatibility and telemetry,
 *                        but the route uses `request.headers.get('user-agent')`
 *                        for every fraud decision
 *   tasksCompleted    -> re-checked against the campaign's configured tasks
 *   idempotencyKey    -> replay protection, backed by a DB unique index
 *   startedAt         -> a timing hint that can only LOWER trust; the server
 *                        clock is authoritative and implausible values are
 *                        discarded
 */
export const recordViewSchema = z
  .object({
    campaignId: z.string().uuid(),
    deviceFingerprint: z.string().trim().max(200).optional().or(z.literal('')),
    userAgent: z.string().trim().max(500).optional().or(z.literal('')),
    tasksCompleted: z.array(z.string().max(64)).max(50).optional(),
    idempotencyKey: z.string().trim().max(100).optional().or(z.literal('')),
    // Epoch milliseconds when the visitor opened the campaign page. Used only
    // as a risk signal (impossible completion speed) — never to grant credit.
    startedAt: z.number().int().finite().nonnegative().optional(),
  })
  .strict();

export type RecordViewBody = z.infer<typeof recordViewSchema>;
