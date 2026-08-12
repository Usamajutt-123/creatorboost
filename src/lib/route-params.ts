/**
 * Next.js 16 passes `params` (and `searchParams`) as Promises.
 * These helpers keep every dynamic route on the same contract.
 */

export async function resolveParams<T extends Record<string, string>>(
  params: Promise<T> | T,
): Promise<T> {
  return await Promise.resolve(params);
}

export function isCampaignUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isPublicCampaignSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
}
