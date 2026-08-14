/**
 * Server-side fraud detection.
 *
 * The browser is NEVER trusted for fraud signals. Everything here is
 * derived server-side from the request IP, user agent, device fingerprint
 * and campaign/creator context. `fraudScore` is always produced by this
 * module (or the optional external provider it calls), never the client.
 *
 * Layers:
 *   1. Local heuristics (always run, no external dependency):
 *        - bot/crawler/headless/automation user agents
 *        - suspiciously short or empty user agents
 *        - emulator strings
 *        - request-header consistency (missing/impossible browser headers),
 *          supplied by `@/lib/bot-detection` from the REAL request headers
 *        - abnormal request frequency from one IP (DB-backed)
 *        - behavioural signals: rapid campaign switching, reload patterns,
 *          impossible completion speed (DB/server derived)
 *        - datacenter/hosting IP ranges (static, no external dependency)
 *   2. Optional external provider (Supabase Edge Function `fraud-check`,
 *      which can use IPQualityScore) — only when explicitly enabled. It adds
 *      VPN/proxy/Tor reputation on top of the local layer.
 *
 * If the external provider is unavailable the system degrades safely:
 * a conservative local heuristic score is used; it never crashes the
 * request and never grants premium earnings on provider failure.
 *
 * FAIRNESS RULE
 * Shared IPs (family, campus, office, carrier NAT, public Wi-Fi) must keep
 * earning. Nothing here blocks an IP across the whole site; per-campaign
 * eligibility is handled by the atomic 24-hour rule in the earnings engine.
 */

import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/server';
import { scoreBehavior, type HeaderSignals } from './bot-detection';

export interface FraudAssessment {
  isBot: boolean;
  isVpn: boolean;
  isProxy: boolean;
  isEmulator: boolean;
  isTor: boolean;
  isRepeat: boolean;
  fraudScore: number; // 0-100, higher = more suspicious
  reasons: string[];
}

export type FraudSignalInput = {
  ip?: string | null;
  /** MUST be the server-observed `user-agent` header, never `body.userAgent`. */
  userAgent?: string | null;
  fingerprint?: string | null;
  campaignId: string;
  creatorId: string;
  /** Header-derived signals produced by `deriveRequestSignals(request.headers)`. */
  headerSignals?: HeaderSignals | null;
  /** Server-measured seconds between campaign page load and unlock submit. */
  sessionSeconds?: number | null;
  /** Number of tasks the campaign requires (server-read from the campaign). */
  requiredTasks?: number;
};

const BOT_RE =
  /bot|crawler|spider|headless|phantom|selenium|puppeteer|playwright|wget|curl|python-requests|scrapy|httpclient|monitor|preview|wordpress|java\/|okhttp|axios|node-fetch|go-http-client/i;

/** Obfuscate an IP before storing it (privacy + prevents raw-IP leakage). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === '0.0.0.0' || ip === 'unknown') return null;
  return createHash('sha256').update(ip.trim()).digest('hex');
}

/**
 * Pure UA-based heuristic score (unit-tested). Returns {score, isBot, isEmulator}.
 * A short UA is treated as suspicious; obvious bot/headless agents score high.
 */
export function scoreUserAgent(ua: string | null | undefined): { score: number; isBot: boolean; isEmulator: boolean } {
  const lower = (ua || '').toLowerCase();
  const isBotUA = BOT_RE.test(lower);
  const isEmulator = /headless|phantom|selenium|puppeteer|playwright/i.test(lower);
  const shortUa = !ua || ua.trim().length < 20;
  let score = 0;
  if (isBotUA) score = Math.max(score, 95);
  if (isEmulator) score = Math.max(score, 85);
  if (shortUa) score = Math.max(score, 60);
  return { score, isBot: isBotUA || shortUa, isEmulator };
}

/** Combine fraud signals into a single assessment (pure, unit-tested). */
export function combineSignals(parts: Array<Partial<FraudAssessment>>): FraudAssessment {
  const out: FraudAssessment = {
    isBot: false, isVpn: false, isProxy: false, isEmulator: false, isTor: false, isRepeat: false,
    fraudScore: 0, reasons: [],
  };
  for (const p of parts) {
    out.isBot = out.isBot || !!p.isBot;
    out.isVpn = out.isVpn || !!p.isVpn;
    out.isProxy = out.isProxy || !!p.isProxy;
    out.isEmulator = out.isEmulator || !!p.isEmulator;
    out.isTor = out.isTor || !!p.isTor;
    out.isRepeat = out.isRepeat || !!p.isRepeat;
    out.fraudScore = Math.max(out.fraudScore, Number(p.fraudScore) || 0);
    if (Array.isArray(p.reasons)) out.reasons.push(...p.reasons.map(String));
  }
  out.fraudScore = Math.max(0, Math.min(100, out.fraudScore));
  return out;
}

/**
 * Datacenter / hosting IPv4 ranges (CIDR, first octet + prefix).
 *
 * These are stable, well-known cloud allocations. Traffic originating inside
 * a datacenter is not a human visitor on a home/mobile connection, so it is
 * scored as risky — but it is a SIGNAL, never an automatic site-wide block,
 * because corporate egress and some carrier proxies also appear here.
 */
const DATACENTER_V4_RANGES: Array<[string, number]> = [
  ['3.0.0.0', 8],       // AWS
  ['13.32.0.0', 12],    // AWS CloudFront
  ['15.164.0.0', 14],   // AWS
  ['16.16.0.0', 12],    // AWS
  ['18.32.0.0', 11],    // AWS
  ['34.64.0.0', 10],    // Google Cloud
  ['35.184.0.0', 13],   // Google Cloud
  ['52.0.0.0', 8],      // AWS
  ['54.0.0.0', 8],      // AWS
  ['104.196.0.0', 14],  // Google Cloud
  ['134.209.0.0', 16],  // DigitalOcean
  ['138.68.0.0', 16],   // DigitalOcean
  ['139.59.0.0', 16],   // DigitalOcean
  ['142.93.0.0', 16],   // DigitalOcean
  ['143.110.0.0', 16],  // DigitalOcean
  ['157.245.0.0', 16],  // DigitalOcean
  ['159.65.0.0', 16],   // DigitalOcean
  ['159.89.0.0', 16],   // DigitalOcean
  ['161.35.0.0', 16],   // DigitalOcean
  ['165.22.0.0', 16],   // DigitalOcean
  ['167.71.0.0', 16],   // DigitalOcean
  ['167.99.0.0', 16],   // DigitalOcean
  ['168.62.0.0', 15],   // Azure
  ['170.64.0.0', 16],   // DigitalOcean
  ['178.62.0.0', 16],   // DigitalOcean
  ['188.166.0.0', 16],  // DigitalOcean
  ['192.241.128.0', 17],// DigitalOcean
  ['206.189.0.0', 16],  // DigitalOcean
  ['207.154.192.0', 18],// DigitalOcean
  ['209.97.128.0', 18], // DigitalOcean
  ['45.55.0.0', 16],    // DigitalOcean
  ['64.225.0.0', 16],   // DigitalOcean
  ['68.183.0.0', 16],   // DigitalOcean
  ['95.216.0.0', 15],   // Hetzner
  ['116.202.0.0', 15],  // Hetzner
  ['135.181.0.0', 16],  // Hetzner
  ['142.132.0.0', 16],  // Hetzner
  ['144.126.192.0', 18],// Vultr
  ['149.28.0.0', 16],   // Vultr
  ['155.138.0.0', 16],  // Vultr
  ['45.32.0.0', 16],    // Vultr
  ['45.76.0.0', 16],    // Vultr
  ['66.42.32.0', 19],   // Vultr
  ['51.15.0.0', 16],    // Scaleway/OVH
  ['51.75.0.0', 16],    // OVH
  ['51.79.0.0', 16],    // OVH
  ['51.83.0.0', 16],    // OVH
  ['91.121.0.0', 16],   // OVH
  ['147.135.0.0', 16],  // OVH
  ['172.104.0.0', 15],  // Linode
  ['173.255.192.0', 18],// Linode
  ['45.33.0.0', 16],    // Linode
  ['45.79.0.0', 16],    // Linode
  ['96.126.96.0', 19],  // Linode
  ['139.162.0.0', 16],  // Linode
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * True when the IP falls inside a known datacenter/hosting allocation.
 * Pure and unit-tested; IPv6 and unknown formats return false (never guess).
 */
export function isDatacenterIp(ip: string | null | undefined): boolean {
  const value = (ip || '').trim();
  if (!value || value.includes(':')) return false;
  const target = ipv4ToInt(value);
  if (target === null) return false;
  for (const [base, prefix] of DATACENTER_V4_RANGES) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((target & mask) >>> 0 === (baseInt & mask) >>> 0) return true;
  }
  return false;
}

/**
 * Local heuristic scoring (always runs, no external dependency).
 *
 * Combines:
 *   - the user-agent heuristic,
 *   - the header-consistency signals derived from the REAL request headers,
 *   - datacenter IP detection,
 *   - DB-backed frequency / campaign-switching / reload behaviour,
 *   - server-measured session timing.
 */
async function localHeuristics(input: FraudSignalInput): Promise<FraudAssessment> {
  const parts: Array<Partial<FraudAssessment>> = [];

  const { score, isBot, isEmulator } = scoreUserAgent(input.userAgent);
  const reasons: string[] = [];
  if (isBot) reasons.push('bot_ua');
  if (isEmulator) reasons.push('emulator_ua');

  parts.push({ isBot, isEmulator, fraudScore: score, reasons });

  // Header-derived signals (missing/impossible browser headers, headless
  // client hints). Computed by the route from the real `Headers` object.
  if (input.headerSignals) {
    parts.push({
      isBot: input.headerSignals.isBot,
      isEmulator: input.headerSignals.isEmulator,
      fraudScore: input.headerSignals.score,
      reasons: input.headerSignals.reasons,
    });
  }

  // Datacenter/hosting origin — a strong signal, handled like a proxy so the
  // admin's existing `vpn_block_enabled` switch governs whether it blocks.
  if (isDatacenterIp(input.ip)) {
    parts.push({ isProxy: true, fraudScore: 70, reasons: ['datacenter_ip'] });
  }

  // Behavioural signals from server-side counters over the `views` table.
  try {
    const ipHash = hashIp(input.ip);
    if (ipHash) {
      const supabase = createAdminClient();
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      // One bounded read serves all three counters. `campaign_id` is the only
      // extra column and the window is 15 minutes, so this stays small.
      const { data: recentRows, count } = await supabase
        .from('views')
        .select('campaign_id', { count: 'exact' })
        .eq('ip_hash', ipHash)
        .gte('created_at', since)
        .limit(200);

      const rows = recentRows || [];
      const distinctCampaigns = new Set(rows.map(r => (r as { campaign_id?: string }).campaign_id).filter(Boolean)).size;
      const campaignRepeats = rows.filter(r => (r as { campaign_id?: string }).campaign_id === input.campaignId).length;

      const behavior = scoreBehavior({
        recentViews: count ?? rows.length,
        distinctCampaigns,
        campaignRepeats,
        sessionSeconds: input.sessionSeconds ?? null,
        requiredTasks: input.requiredTasks ?? 0,
      });
      if (behavior.score > 0 || behavior.isRepeat) {
        parts.push({ isRepeat: behavior.isRepeat, fraudScore: behavior.score, reasons: behavior.reasons });
      }
    } else if (typeof input.sessionSeconds === 'number') {
      // No usable IP hash, but the timing signal is still server-derived.
      const behavior = scoreBehavior({
        sessionSeconds: input.sessionSeconds,
        requiredTasks: input.requiredTasks ?? 0,
      });
      if (behavior.score > 0) parts.push({ fraudScore: behavior.score, reasons: behavior.reasons });
    }
  } catch {
    // Behavioural checks unavailable -> do not fail the request. The 24-hour
    // duplicate rule and the database caps remain in force regardless.
  }

  return combineSignals(parts);
}

/**
 * Assess fraud for a view request. Optionally calls the `fraud-check`
 * Supabase Edge Function when enabled; on any failure it falls back to
 * local heuristics and never crashes the request.
 */
export async function assessFraud(input: FraudSignalInput): Promise<FraudAssessment> {
  // Local layer always runs.
  const local = await localHeuristics(input);

  // Optional external provider. Skipped unless explicitly enabled, so the
  // app works in environments where the function isn't deployed.
  const fraudFunctionSecret = process.env.FRAUD_FUNCTION_SECRET;
  if (process.env.SUPABASE_FRAUD_FN_ENABLED === 'true' && fraudFunctionSecret) {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase.functions.invoke('fraud-check', {
        headers: { 'x-fraud-secret': fraudFunctionSecret },
        body: {
          ip: input.ip,
          userAgent: input.userAgent,
          fingerprint: input.fingerprint,
          campaignId: input.campaignId,
        },
      });
      if (!error && data && typeof data.fraudScore === 'number') {
        // The provider ENRICHES the local layer (VPN/proxy/Tor reputation);
        // it never overrides it. `combineSignals` takes the max score and the
        // OR of every boolean, so a provider that scores a headless bot as
        // clean can no longer erase the locally-derived automation evidence.
        return combineSignals([
          local,
          {
            isBot: !!data.isBot,
            isVpn: !!data.isVpn,
            isProxy: !!data.isProxy,
            isEmulator: !!data.isEmulator,
            isTor: !!data.isTor,
            isRepeat: !!data.isRepeat,
            fraudScore: Number(data.fraudScore),
            reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
          },
        ]);
      }
      // Edge function failed -> degrade to local score (conservative).
    } catch (e) {
      console.error('[fraud] edge function unavailable, using local heuristics', e);
    }
  }

  return local;
}
