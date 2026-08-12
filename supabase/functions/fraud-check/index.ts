// Supabase Edge Function: optional internal fraud enrichment.
// Deploy with verify_jwt enabled and set FRAUD_FUNCTION_SECRET. The Next.js
// server is the only caller and sends that secret; this function must never
// become a public IPQualityScore proxy or a service-role-backed query oracle.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const IPQS_KEY = Deno.env.get('IPQUALITYSCORE_KEY') || '';
const INTERNAL_SECRET = Deno.env.get('FRAUD_FUNCTION_SECRET') || '';

interface FraudRequest { ip?: string; userAgent?: string; fingerprint?: string; campaignId?: string }
interface FraudResult { isBot: boolean; isVpn: boolean; isProxy: boolean; isEmulator: boolean; isTor: boolean; isRepeat: boolean; fraudScore: number; reasons: string[] }

function isSafeIp(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f:]{2,45}$/i.test(value);
}

async function checkIPQS(ip: string, ua: string): Promise<Partial<FraudResult>> {
  if (!IPQS_KEY || !isSafeIp(ip)) return {};
  try {
    const response = await fetch(`https://ipqualityscore.com/api/json/ip/${IPQS_KEY}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true&fast=true&mobile=true`);
    if (!response.ok) return {};
    const data = await response.json();
    return {
      isVpn: data.vpn === true,
      isProxy: data.proxy === true,
      isTor: data.tor === true,
      fraudScore: Number(data.fraud_score) || 0,
      reasons: [data.recent_abuse ? 'recent_abuse' : '', data.bot_status ? 'bot' : ''].filter(Boolean),
    };
  } catch { return {}; }
}

function detectBotUA(ua: string): { isBot: boolean; score: number } {
  const patterns = /bot|crawler|spider|headless|phantom|selenium|puppeteer|playwright|wget|curl|python-requests|scrapy|httpclient/i;
  if (patterns.test(ua)) return { isBot: true, score: 95 };
  if (ua.length < 20) return { isBot: true, score: 80 };
  return { isBot: false, score: 0 };
}

async function checkRepeat(fingerprint: string, ip: string, supabase: ReturnType<typeof createClient>) {
  if (!fingerprint || !isSafeIp(ip)) return { repeat: false, score: 0 };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  // Inputs were length/character validated before this filter is built.
  const { count } = await supabase.from('views').select('id', { count: 'exact', head: true })
    .or(`device_fingerprint.eq.${fingerprint},visitor_ip.eq.${ip}`).gte('created_at', since);
  const visits = count || 0;
  if (visits > 50) return { repeat: true, score: 100 };
  if (visits > 20) return { repeat: true, score: 80 };
  if (visits > 5) return { repeat: true, score: 50 };
  return { repeat: visits > 0, score: visits > 0 ? 25 : 0 };
}

serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!INTERNAL_SECRET || request.headers.get('x-fraud-secret') !== INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json() as FraudRequest;
    const ip = String(body.ip || '').trim();
    const userAgent = String(body.userAgent || '').trim().slice(0, 500);
    const fingerprint = String(body.fingerprint || '').trim();
    if (!isSafeIp(ip) || !userAgent || fingerprint.length > 200 || /[,()]/.test(fingerprint)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const [ipqs, bot, repeat] = await Promise.all([checkIPQS(ip, userAgent), Promise.resolve(detectBotUA(userAgent)), checkRepeat(fingerprint, ip, supabase)]);
    const isEmulator = /headless|phantom/i.test(userAgent);
    const score = Math.max(Number(ipqs.fraudScore) || 0, bot.score, repeat.score);
    const reasons = [...(ipqs.reasons || []), ...(repeat.repeat && repeat.score >= 50 ? ['repeat_visitor'] : []), ...(isEmulator ? ['emulator_detected'] : [])];
    const result: FraudResult = {
      isBot: bot.isBot || (Number(ipqs.fraudScore) || 0) >= 85,
      isVpn: ipqs.isVpn === true,
      isProxy: ipqs.isProxy === true,
      isTor: ipqs.isTor === true,
      isEmulator,
      isRepeat: repeat.repeat,
      fraudScore: Math.min(100, Math.max(0, score)),
      reasons,
    };
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[fraud-check] failed', error);
    return new Response(JSON.stringify({ error: 'Fraud check unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
