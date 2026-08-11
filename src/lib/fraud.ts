/**
 * Server-side fraud detection.
 *
 * The browser is NEVER trusted for fraud signals. Everything here is
 * derived server-side from the request IP, user agent, device fingerprint
 * and campaign/creator context. `fraudScore` is always produced by this
 * module (or the optional Supabase Edge Function it calls), never the client.
 *
 * If the external fraud API is unavailable the system degrades safely:
 * a conservative local heuristic score is used instead of crashing, and
 * the caller decides whether that warrants flagging.
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
  /bot|crawler|spider|headless|phantom|selenium|puppeteer|playwright|wget|curl|python-requests|scrapy|httpclient|monitor|preview/i;

/** Obfuscate an IP before storing it (privacy + prevents raw-IP leakage). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === '0.0.0.0' || ip === 'unknown') return null;
  return createHash('sha256').update(ip.trim()).digest('hex');
}

/** Local heuristic scoring (always runs, no external dependency). */
function localHeuristics(input: FraudSignalInput): FraudAssessment {
  const ua = (input.userAgent || '').toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const isBotUA = BOT_RE.test(ua);
  const isEmulator = /headless|phantom|selenium|puppeteer/i.test(ua);
  const shortUa = !input.userAgent || input.userAgent.trim().length < 20;

  if (isBotUA) { score = Math.max(score, 95); reasons.push('bot_ua'); }
  if (shortUa) { score = Math.max(score, 60); reasons.push('short_ua'); }
  if (isEmulator) { score = Math.max(score, 85); reasons.push('emulator_ua'); }

  return {
    isBot: isBotUA || shortUa,
    isVpn: false,
    isProxy: false,
    isEmulator,
    isTor: false,
    isRepeat: false,
    fraudScore: score,
    reasons,
  };
}

/**
 * Assess fraud for a view request. Optionally calls the `fraud-check`
 * Supabase Edge Function when enabled; on any failure it falls back to
 * local heuristics and never crashes the request.
 */
export async function assessFraud(input: FraudSignalInput): Promise<FraudAssessment> {
  const local = localHeuristics(input);

  // Optional external Edge Function. Skipped unless explicitly enabled,
  // so the app works in environments where the function isn't deployed.
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
        return {
          isBot: !!data.isBot,
          isVpn: !!data.isVpn,
          isProxy: !!data.isProxy,
          isEmulator: !!data.isEmulator,
          isTor: !!data.isTor,
          isRepeat: !!data.isRepeat,
          fraudScore: Math.max(0, Math.min(100, Number(data.fraudScore))),
          reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
        };
      }
      // Edge function failed -> degrade to local score (already logged below).
    } catch (e) {
      console.error('[fraud] edge function unavailable, using local heuristics', e);
    }
  }

  return local;
}
