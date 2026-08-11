/**
 * Adsterra integration adapter.
 *
 * STATUS: NOT IMPLEMENTED against a live API.
 *
 * Adsterra publishes a publisher API, but this repository does not ship a
 * client for it because the exact endpoint/authentication contract has not
 * been verified against Adsterra's current documentation and no credentials
 * are available in this environment.
 *
 * To wire it up in production, set:
 *   ADSTERRA_API_URL=<the real endpoint you verified from Adsterra's docs>
 *   ADSTERRA_API_TOKEN=<publisher API token>
 *
 * The adapter then speaks the generic HTTP contract documented in
 * provider.ts (GET ?from=&to= returning the JSON record array). Until a
 * real endpoint is configured, `configured()` is false and the platform
 * shows "Revenue integration not configured" — no revenue is ever faked.
 */

import { HttpRevenueProvider, registerProvider } from './provider';

const provider = new HttpRevenueProvider(
  'adsterra',
  'Adsterra',
  process.env.ADSTERRA_API_URL || undefined,
  process.env.ADSTERRA_API_TOKEN,
);

registerProvider(provider);

export default provider;
