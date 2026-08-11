import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendTemplateEmail } from '@/lib/email';

/**
 * POST /api/support
 * Stores a support ticket (authenticated or anonymous) and sends a
 * confirmation email when the email provider is configured. It never
 * claims an email was sent unless one actually was.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req) || 'unknown';

    // Await the limiter!
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
    const { first, last, email, subject, message } = (body || {}) as {
      first?: string; last?: string; email?: string; subject?: string; message?: string;
    };

    if (!first || !last || !email || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (String(message).length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }
    if (String(first).length > 100 || String(last).length > 100 || String(subject || '').length > 200) {
      return NextResponse.json({ error: 'Field too long' }, { status: 400 });
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: ticket, error: tErr } = await supabase.from('support_tickets').insert({
      user_id: user?.id ?? null,
      subject: `[${subject || 'General'}] ${first} ${last}`.slice(0, 300),
      category: subject || 'general',
      status: 'open',
      priority: 'medium',
    }).select().single();

    if (tErr) {
      console.error('[support] ticket insert error:', tErr);
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }

    const msgErr = await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      user_id: user?.id ?? null,
      message: `From: ${first} ${last} <${email}>\n\n${message}`.slice(0, 6000),
      is_admin: false,
    });
    if (msgErr.error) {
      console.error('[support] ticket message insert error:', msgErr.error);
    }

    // Optional email/webhook forwarding — only reported as "sent" if
    // configured & successful. Provider failures never surface to users.
    let emailSent = false;
    const webhookUrl = process.env.SUPPORT_EMAIL_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: process.env.SUPPORT_EMAIL || 'support@creatorboost.io',
            subject,
            message,
            from: email,
          }),
        });
        emailSent = res.ok;
      } catch (e) {
        console.error('[support] webhook forwarding failed', e);
      }
    }

    // Confirmation to the requester (graceful when email is not configured).
    const confirm = await sendTemplateEmail('support_confirmation', email, {
      name: `${first} ${last}`,
      ticketId: ticket.id.slice(0, 8),
      subject: subject || 'General inquiry',
      message: String(message).slice(0, 500),
    });
    if (confirm.sent) emailSent = true;

    return NextResponse.json({
      success: true,
      ticketId: ticket.id,
      emailSent,
      message: 'Support request received. We will respond within 24 hours.',
    });
  } catch (e) {
    console.error('[support] error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
