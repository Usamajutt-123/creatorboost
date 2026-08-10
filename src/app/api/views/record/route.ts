import { NextResponse, type NextRequest } from 'next/server';
import { recordView } from '@/lib/earnings';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';

const schema = z.object({
  campaignId: z.string().uuid(),
  creatorId: z.string().uuid(),
  countryCode: z.string().length(2).optional(),
  deviceFingerprint: z.string().max(200).optional(),
  userAgent: z.string().max(500).optional(),
  tasksCompleted: z.array(z.any()).max(20).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
    const allowed = await rateLimit(`view:${ip}`, 30, 60_000);
    if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const body = await request.json();
    const parsed = schema.parse(body);

    // In production, use a real fraud detection service:
    // - IPQualityScore, MaxMind, IP2Location for IP/geo
    // - FingerprintJS for device fingerprinting
    // - Custom ML model for behavior analysis
    // For now, we do basic checks server-side
    const ua = parsed.userAgent || request.headers.get('user-agent') || '';
    const isBot = /bot|crawler|spider|headless|phantom|wget|curl/i.test(ua);

    const result = await recordView({
      ...parsed,
      visitorIp: ip,
      userAgent: ua,
      isBot,
      fraudScore: 0, // populated by real detection service
    });

    return NextResponse.json(result);
  } catch (e: any) {
    if (e.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid request', details: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
