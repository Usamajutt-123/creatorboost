// Supabase Edge Function: AI Fraud Detection
// Deploy: supabase functions deploy fraud-check
// Trigger: HTTP POST from /api/views/record

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const IPQS_KEY = Deno.env.get('IPQUALITYSCORE_KEY')!; // Optional: IPQualityScore for IP reputation

interface FraudRequest {
  ip: string;
  userAgent: string;
  fingerprint: string;
  countryCode?: string;
}

interface FraudResult {
  isBot: boolean;
  isVpn: boolean;
  isProxy: boolean;
  isEmulator: boolean;
  isTor: boolean;
  fraudScore: number; // 0-100, higher = more suspicious
  reasons: string[];
}

async function checkIPQS(ip: string, ua: string): Promise<Partial<FraudResult>> {
  if (!IPQS_KEY) return {};
  try {
    const res = await fetch(
      `https://ipqualityscore.com/api/json/ip/${IPQS_KEY}/${ip}?strictness=1&allow_public_access_points=true&fast=true&mobile=true`
    );
    const data = await res.json();
    return {
      isVpn: data.vpn === true,
      isProxy: data.proxy === true,
      isTor: data.tor === true,
      fraudScore: data.fraud_score || 0,
      reasons: [
        data.mobile ? '' : '',
        data.recent_abuse ? 'recent_abuse' : '',
        data.bot_status ? 'bot' : '',
      ].filter(Boolean) as string[],
    };
  } catch {
    return {};
  }
}

function detectBotUA(ua: string): { isBot: boolean; score: number } {
  const botPatterns = /bot|crawler|spider|headless|phantom|selenium|puppeteer|playwright|wget|curl|python-requests|scrapy|httpclient/i;
  if (botPatterns.test(ua)) return { isBot: true, score: 95 };
  if (!ua || ua.length < 20) return { isBot: true, score: 80 };
  return { isBot: false, score: 0 };
}

async function checkRepeat(fingerprint: string, ip: string, supabase: any): Promise<{ repeat: boolean; score: number }> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase
    .from('views')
    .select('id', { count: 'exact', head: true })
    .or(`device_fingerprint.eq.${fingerprint},visitor_ip.eq.${ip}`)
    .gte('created_at', since);

  if (!count) return { repeat: false, score: 0 };
  if (count > 50) return { repeat: true, score: 100 };
  if (count > 20) return { repeat: true, score: 80 };
  if (count > 5) return { repeat: true, score: 50 };
  return { repeat: true, score: 25 };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const data: FraudRequest = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const [ipqs, botCheck, repeatCheck] = await Promise.all([
      checkIPQS(data.ip, data.userAgent),
      Promise.resolve(detectBotUA(data.userAgent)),
      checkRepeat(data.fingerprint, data.ip, supabase),
    ]);

    // Combine signals
    const reasons: string[] = [...(ipqs.reasons || [])];
    let score = Math.max(
      ipqs.fraudScore || 0,
      botCheck.score,
      repeatCheck.score,
    );

    const isBot = botCheck.isBot || (ipqs.fraudScore || 0) >= 85;
    const isVpn = ipqs.isVpn || false;
    const isProxy = ipqs.isProxy || false;
    const isTor = ipqs.isTor || false;
    const isEmulator = /headless|phantom/i.test(data.userAgent);

    if (repeatCheck.repeat && repeatCheck.score >= 50) reasons.push('repeat_visitor');
    if (isTor) reasons.push('tor_network');
    if (isEmulator) reasons.push('emulator_detected');

    const result: FraudResult = {
      isBot, isVpn, isProxy, isTor, isEmulator,
      fraudScore: Math.min(100, score),
      reasons,
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
