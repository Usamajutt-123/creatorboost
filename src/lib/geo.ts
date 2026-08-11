/**
 * Server-side IP -> country resolution.
 *
 * SECURITY RULE
 * The client (browser) NEVER supplies the country that determines payment.
 * Country is resolved here from the visitor IP, which is extracted from the
 * request in `src/lib/request-ip.ts` using only headers that are trustworthy
 * in the deployment architecture (platform-provided IP first, then x-real-ip,
 * then the right-most entry of x-forwarded-for — never the client-supplied
 * left-most entry).
 *
 * PROVIDER ABSTRACTION
 * Providers are replaceable and selected by environment variables:
 *
 *   IP_GEO_PROVIDER=ipwhois   -> keyless ipwho.is (privacy-conscious, no key)
 *   IP_GEO_PROVIDER=ipapi     -> ipapi.co (optional token)
 *   IP_GEO_PROVIDER=http      -> any HTTP service implementing
 *                                GET {IP_GEO_SERVICE_URL}?ip=<ip>
 *                                returning JSON { countryCode: "US" } (or {country})
 *   IP_GEO_MOCK_COUNTRY=US    -> dev/test only: force a country
 *
 * On ANY failure or unknown/private IP the resolver returns `null`, and the
 * earnings engine maps that to a conservative floor CPM — never the highest.
 */

export interface GeoProvider {
  resolve(ip: string): Promise<string | null>;
}

// ------------------------------------------------------------------
// IP parsing / classification (no external deps, unit-tested)
// ------------------------------------------------------------------

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE =
  /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;

/** Validate and normalize an IP string. Supports IPv4 and IPv6. */
export function parseIp(raw: string | null | undefined): string | null {
  const ip = (raw || '').trim();
  if (!ip || ip.length > 45 || ip === 'unknown' || ip === '0.0.0.0') return null;
  if (IPV4_RE.test(ip)) return ip;
  if (ip.includes(':')) {
    // Strip a bracketed port if present (e.g. [::1]:1234)
    const unbracketed = ip.startsWith('[') ? ip.slice(1).split(']')[0] : ip;
    const noPort = unbracketed.includes(']:') ? unbracketed.split(']:')[0] : unbracketed.split(':').slice(0, -1).join(':');
    const candidate = ip.startsWith('[') ? unbracketed : (noPort.includes(':') && IPV6_RE.test(noPort) ? noPort : unbracketed);
    if (IPV6_RE.test(candidate)) return candidate.toLowerCase();
  }
  return null;
}

/** True for loopback, private, link-local, unspecified, multicast and other non-routable space. */
export function isPrivateIp(ip: string | null | undefined): boolean {
  const parsed = parseIp(ip);
  if (!parsed) return true; // unparseable == untrustworthy
  if (parsed.includes(':')) {
    const lower = parsed.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('fe8') || lower.startsWith('fe9')
      || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('fc')
      || lower.startsWith('fd') || lower.startsWith('ff')) return true;
    // IPv4-mapped ::ffff:a.b.c.d
    const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  const parts = parsed.split('.').map(Number);
  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
  if (parts[0] === 169 && parts[1] === 254) return true; // link-local
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true; // benchmark
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
  if (parts[0] >= 224) return true; // multicast + reserved
  return false;
}

/** Is this IP safe to send to an external geo provider? */
export function isPublicIp(ip: string | null | undefined): boolean {
  return Boolean(parseIp(ip)) && !isPrivateIp(ip);
}

// ------------------------------------------------------------------
// Providers
// ------------------------------------------------------------------

/** Dev/test helper: IP_GEO_MOCK_COUNTRY. */
class EnvProvider implements GeoProvider {
  async resolve(_ip: string): Promise<string | null> {
    const mock = process.env.IP_GEO_MOCK_COUNTRY?.trim().toUpperCase();
    return mock && /^[A-Z]{2}$/.test(mock) ? mock : null;
  }
}

/** Generic HTTP provider behind a simple `GET ?ip=` contract (JSON { countryCode }). */
class HttpGeoProvider implements GeoProvider {
  constructor(
    private url: string,
    private token?: string,
    private timeoutMs = 2500,
  ) {}

  async resolve(ip: string): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const res = await fetch(`${this.url}?ip=${encodeURIComponent(ip)}`, { headers, signal: ctrl.signal });
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

/** ipwho.is — keyless, privacy-conscious (logs no IPs). https://ipwho.is */
class IpwhoisProvider implements GeoProvider {
  async resolve(ip: string): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; country_code?: string };
      if (data.success === false) return null;
      const code = (data.country_code || '').trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }
}

/** ipapi.co — keyless for low volume, token optional. https://ipapi.co */
class IpapiProvider implements GeoProvider {
  constructor(private token?: string) {}

  async resolve(ip: string): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const headers: Record<string, string> = { Accept: 'application/json' };
      const url = new URL(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      if (this.token) url.searchParams.set('key', this.token);
      const res = await fetch(url.toString(), { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = (await res.json()) as { country_code?: string; error?: boolean };
      if (data.error) return null;
      const code = (data.country_code || '').trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
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

// ------------------------------------------------------------------
// Provider registry + selection
// ------------------------------------------------------------------

let _providers: GeoProvider[] | null = null;

function buildProviders(): GeoProvider[] {
  const list: GeoProvider[] = [];
  const mode = (process.env.IP_GEO_PROVIDER || '').toLowerCase().trim();

  if (process.env.IP_GEO_MOCK_COUNTRY) list.push(new EnvProvider());

  if (mode === 'ipwhois') list.push(new IpwhoisProvider());
  else if (mode === 'ipapi') list.push(new IpapiProvider(process.env.IP_GEO_SERVICE_TOKEN));
  else if (mode === 'http' && process.env.IP_GEO_SERVICE_URL) {
    list.push(new HttpGeoProvider(process.env.IP_GEO_SERVICE_URL, process.env.IP_GEO_SERVICE_TOKEN));
  } else if (process.env.IP_GEO_SERVICE_URL) {
    // Backwards compatible: a URL alone enables the generic HTTP provider.
    list.push(new HttpGeoProvider(process.env.IP_GEO_SERVICE_URL, process.env.IP_GEO_SERVICE_TOKEN));
  }

  list.push(new DbIpProvider());
  return list;
}

function getProviders(): GeoProvider[] {
  if (!_providers) _providers = buildProviders();
  return _providers;
}

/** Test hook: reset the cached provider list. */
export function resetGeoProviders(): void {
  _providers = null;
}

// ------------------------------------------------------------------
// Small TTL cache to keep provider load low (and protect providers)
// ------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { code: string | null; at: number }>();

export function clearGeoCache(): void {
  cache.clear();
}

/**
 * Resolve a visitor IP to an ISO 3166-1 alpha-2 country code (upper case),
 * or `null` when unknown / private / unresolvable. Never throws.
 *
 * Only public IPs are sent to external providers; loopback/private/weird
 * inputs short-circuit to `null` (the safe, lowest-CPM fallback).
 */
export async function getCountryFromIP(ip: string | null | undefined): Promise<string | null> {
  const parsed = parseIp(ip);
  if (!parsed || isPrivateIp(parsed)) return null;

  const hit = cache.get(parsed);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.code;
  if (cache.size >= CACHE_MAX) cache.clear();

  for (const provider of getProviders()) {
    try {
      const code = await provider.resolve(parsed);
      if (code && /^[A-Z]{2}$/.test(code)) {
        cache.set(parsed, { code, at: Date.now() });
        return code;
      }
    } catch {
      // provider failed -> try the next one
    }
  }

  cache.set(parsed, { code: null, at: Date.now() });
  return null;
}

/**
 * Country code sanitizer used by the earnings engine.
 * Returns null for anything that is not a clean 2-letter code, so an
 * invalid/unknown country can never reach a premium CPM tier.
 */
export function sanitizeCountryCode(code: string | null | undefined): string | null {
  const c = (code || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}
