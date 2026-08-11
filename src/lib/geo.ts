/**
 * Server-side IP -> country resolution.
 *
 * The client is NEVER trusted to supply the country code that determines
 * payment. Country is resolved here from the visitor IP through a
 * replaceable provider abstraction.
 *
 * Provider selection order:
 *   1. If `IP_GEO_MOCK_COUNTRY` is set (dev/tests), return it verbatim.
 *   2. If `IP_GEO_SERVICE_URL` is set, call the external HTTP provider.
 *   3. Otherwise attempt a DB-backed `ip_locations` lookup (optional table).
 *
 * On ANY failure or unknown IP we return `null`, which the earnings engine
 * maps to a conservative Tier-3 default — never the highest CPM.
 */

export interface GeoProvider {
  resolve(ip: string): Promise<string | null>;
}

/** HTTP provider behind a simple GET `?ip=` contract (JSON { countryCode }). */
class HttpGeoProvider implements GeoProvider {
  constructor(
    private url: string,
    private token?: string,
    private timeoutMs = 2000,
  ) {}

  async resolve(ip: string): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const res = await fetch(`${this.url}?ip=${encodeURIComponent(ip)}`, {
        headers,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = (await res.json()) as { countryCode?: string; country?: string };
      const code = (data.countryCode || data.country || '').trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }
}

/** Development/test helper. */
class EnvProvider implements GeoProvider {
  async resolve(_ip: string): Promise<string | null> {
    const mock = process.env.IP_GEO_MOCK_COUNTRY?.trim().toUpperCase();
    return mock && /^[A-Z]{2}$/.test(mock) ? mock : null;
  }
}

/** Optional DB-backed lookup (table `ip_locations` if present). */
class DbIpProvider implements GeoProvider {
  async resolve(_ip: string): Promise<string | null> {
    // Reserved for a future MaxMind/geo dataset imported into the DB.
    // Returns null (safe fallback) when not configured.
    return null;
  }
}

let _providers: GeoProvider[] | null = null;

function buildProviders(): GeoProvider[] {
  const list: GeoProvider[] = [];
  if (process.env.IP_GEO_MOCK_COUNTRY) list.push(new EnvProvider());
  if (process.env.IP_GEO_SERVICE_URL) {
    list.push(new HttpGeoProvider(process.env.IP_GEO_SERVICE_URL, process.env.IP_GEO_SERVICE_TOKEN));
  }
  list.push(new DbIpProvider());
  return list;
}

function getProviders(): GeoProvider[] {
  if (!_providers) _providers = buildProviders();
  return _providers;
}

/**
 * Resolve a visitor IP to an ISO country code (upper-case), or `null` when
 * unknown/unresolvable. Never throws.
 */
export async function getCountryFromIP(ip: string | null | undefined): Promise<string | null> {
  const cleanIp = (ip || '').trim();
  if (!cleanIp || cleanIp === '0.0.0.0' || cleanIp === 'unknown') return null;

  // Prefer a small in-process LRU-ish cache keyed by IP to reduce provider load.
  for (const provider of getProviders()) {
    try {
      const code = await provider.resolve(cleanIp);
      if (code) return code;
    } catch {
      // provider failed -> try the next one
    }
  }
  return null;
}
