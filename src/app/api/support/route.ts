import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/support
 * Stores a support ticket. Optionally forwards to an email/webhook provider
 * when `SUPPORT_EMAIL_WEBHOOK_URL` is configured. It never claims an email
 * was sent unless one actually was.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // Await the limiter! (Previously this was not awaited -> the check was dead.)
    const allowed = await rateLimit(`support:${ip}`, 5, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { first, last, email, subject, message, to } = (body || {}) as {
      first?: string; last?: string; email?: string; subject?: string; message?: string; to?: string;
    };

    if (!first || !last || !email || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (String(message).length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: ticket, error: tErr } = await supabase.from('support_tickets').insert({
      user_id: user?.id ?? null,
      subject: `[${subject || 'General'}] ${first} ${last}`,
      category: subject || 'general',
      status: 'open',
      priority: 'medium',
    }).select().single();

    if (tErr) {
      console.error('[support] ticket insert error:', tErr);
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }

    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      user_id: user?.id ?? null,
      message: `From: ${first} ${last} <${email}>\n\n${message}`,
      is_admin: false,
    });

    // Optional email/webhook forwarding — only reported as "sent" if configured & successful.
    let emailSent = false;
    const webhookUrl = process.env.SUPPORT_EMAIL_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to || process.env.SUPPORT_EMAIL || 'support@creatorboost.io', subject, message, from: email }),
        });
        emailSent = res.ok;
      } catch (e) {
        console.error('[support] webhook forwarding failed', e);
      }
    }

    return NextResponse.json({
      success: true,
      ticketId: ticket.id,
      emailSent,
      message: emailSent
        ? 'Support request received and notified. We will respond within 24 hours.'
        : 'Support ticket created. We will respond within 24 hours.',
    });
  } catch (e) {
    console.error('[support] error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
