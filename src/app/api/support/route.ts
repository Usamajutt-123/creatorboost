import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendTemplateEmail } from '@/lib/email';

/**
 * Public contact endpoint. It validates all user input, derives an optional
 * signed-in user from the session, and uses the server-only client to create
 * the ticket/message pair without exposing staff-only columns to browsers.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req) || 'unknown';
    if (!await rateLimit(`support:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    // Accept both contact-page field names while normalizing them once.
    const first = String(body.first ?? body.firstName ?? '').trim();
    const last = String(body.last ?? body.lastName ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const subject = String(body.subject ?? 'General').trim();
    const message = String(body.message ?? '').trim();
    if (!first || !last || !email || !message) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    if (first.length > 100 || last.length > 100 || subject.length > 200 || message.length > 5_000) {
      return NextResponse.json({ error: 'One or more fields are too long' }, { status: 400 });
    }

    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    const admin = createAdminClient();
    const category = subject.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'general';
    const { data: ticket, error: ticketError } = await admin
      .from('support_tickets')
      .insert({ user_id: user?.id ?? null, subject: `[${subject}] ${first} ${last}`.slice(0, 300), category })
      .select('id')
      .single();
    if (ticketError || !ticket) {
      console.error('[support] ticket insert failed', ticketError);
      return NextResponse.json({ error: 'Could not create your support request' }, { status: 500 });
    }

    const { error: messageError } = await admin
      .from('ticket_messages')
      .insert({ ticket_id: ticket.id, user_id: user?.id ?? null, message: `From: ${first} ${last} <${email}>\n\n${message}`.slice(0, 6_000), is_admin: false });
    if (messageError) {
      await admin.from('support_tickets').delete().eq('id', ticket.id);
      console.error('[support] ticket message insert failed', messageError);
      return NextResponse.json({ error: 'Could not save your support message' }, { status: 500 });
    }

    // Optional forwarding is best-effort and does not change ticket success.
    let emailSent = false;
    const webhookUrl = process.env.SUPPORT_EMAIL_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const forwarded = await fetch(webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: process.env.SUPPORT_EMAIL || 'support@creatorboost.io', subject, message, from: email }),
        });
        emailSent = forwarded.ok;
      } catch (error) {
        console.error('[support] webhook forwarding failed', error);
      }
    }
    const confirmation = await sendTemplateEmail('support_confirmation', email, {
      name: `${first} ${last}`, ticketId: ticket.id.slice(0, 8), subject, message: message.slice(0, 500),
    });
    emailSent ||= confirmation.sent;

    return NextResponse.json({ success: true, ticketId: ticket.id, emailSent, message: 'Support request received. We will respond through your contact details or ticket.' });
  } catch (error) {
    console.error('[support] unexpected error', error);
    return NextResponse.json({ error: 'Could not submit your support request' }, { status: 500 });
  }
}
