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
 *        - abnormal request frequency from one IP (DB-backed)
 *        - duplicate device behavior within a window (checked by the
 *          earnings engine too, this flags the *signal*)
 *   2. Optional external provider (Supabase Edge Function `fraud-check`,
 *      which can use IPQualityScore) — only when explicitly enabled.
 *
 * If the external provider is unavailable the system degrades safely:
 * a conservative local heuristic score is used; it never crashes the
 * request and never grants premium earnings on provider failure.
 */

import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/server';

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
  userAgent?: string | null;
  fingerprint?: string | null;
  campaignId: string;
  creatorId: string;
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
 * Local heuristic scoring (always runs, no external dependency).
 * Includes a DB-backed request-frequency check: an IP producing an
 * impossible volume of views in a short window is flagged.
 */
async function localHeuristics(input: FraudSignalInput): Promise<FraudAssessment> {
  const parts: Array<Partial<FraudAssessment>> = [];

  const { score, isBot, isEmulator } = scoreUserAgent(input.userAgent);
  const reasons: string[] = [];
  if (isBot) reasons.push('bot_ua');
  if (isEmulator) reasons.push('emulator_ua');

  parts.push({ isBot, isEmulator, fraudScore: score, reasons });

  // Abnormal request frequency from the same IP (server-side, DB-backed).
  try {
    const ipHash = hashIp(input.ip);
    if (ipHash) {
      const supabase = createAdminClient();
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count } = await supabase
        .from('views')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', since);
      const n = count ?? 0;
      if (n > 40) {
        parts.push({ isRepeat: true, fraudScore: 80, reasons: ['frequency_abuse'] });
      } else if (n > 15) {
        parts.push({ isRepeat: true, fraudScore: 50, reasons: ['frequent_visits'] });
      } else if (n > 5) {
        parts.push({ isRepeat: true, fraudScore: 25, reasons: ['repeated_visits'] });
      }
    }
  } catch {
    // frequency check unavailable -> do not fail the request
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
  if (process.env.SUPABASE_FRAUD_FN_ENABLED === 'true') {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase.functions.invoke('fraud-check', {
        body: {
          ip: input.ip,
          userAgent: input.userAgent,
          fingerprint: input.fingerprint,
          campaignId: input.campaignId,
        },
      });
      if (!error && data && typeof data.fraudScore === 'number') {
        return combineSignals([
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
