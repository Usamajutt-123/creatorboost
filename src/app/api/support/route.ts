import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

const SUPPORT_EMAIL = 'royalsenpai0@gmail.com';

export async function POST(req: NextRequest) {
  try {
    // Rate limit (5 per minute per IP)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (!rateLimit(`support:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const body = await req.json();
    const { first, last, email, subject, message, to } = body;

    if (!first || !last || !email || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Store the support request in DB
    const { data: ticket, error: tErr } = await supabase.from('support_tickets').insert({
      user_id: user?.id,
      subject: `[${subject || 'General'}] ${first} ${last} <${email}>`,
      category: subject || 'general',
      status: 'open',
      priority: 'medium',
    }).select().single();

    if (tErr) {
      console.error('Ticket insert error:', tErr);
    } else if (ticket) {
      // Insert initial message
      await supabase.from('ticket_messages').insert({
        ticket_id: ticket.id,
        user_id: user?.id,
        message: `From: ${first} ${last} <${email}>\n\n${message}`,
        is_admin: false,
      });
    }

    // Optionally send to a webhook (Slack/Discord/email service)
    // For now, just return success
    return NextResponse.json({
      success: true,
      ticketId: ticket?.id,
      to: SUPPORT_EMAIL,
      message: 'Support request received. We will respond within 24 hours.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 });
  }
}