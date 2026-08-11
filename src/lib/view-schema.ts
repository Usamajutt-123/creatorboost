import { z } from 'zod';

/**
 * Strict schema for POST /api/views/record.
 *
 * `.strict()` rejects any unknown key, so a client that tries to smuggle
 * creatorId, countryCode, cpm, earning, fraudScore or a valid/invalid
 * status is rejected outright.
 */
export const recordViewSchema = z
  .object({
    campaignId: z.string().uuid(),
    deviceFingerprint: z.string().trim().max(200).optional().or(z.literal('')),
    userAgent: z.string().trim().max(500).optional().or(z.literal('')),
    tasksCompleted: z.array(z.string()).max(50).optional(),
    idempotencyKey: z.string().trim().max(100).optional().or(z.literal('')),
  })
  .strict();

export type RecordViewBody = z.infer<typeof recordViewSchema>;
