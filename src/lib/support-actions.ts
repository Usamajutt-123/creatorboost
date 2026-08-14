'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { sendTemplateEmail } from '@/lib/email';

export type SupportTicketInput = { subject: string; category: string; message: string };

function cleanTicketInput(input: SupportTicketInput) {
  const subject = String(input.subject || '').trim();
  const category = String(input.category || 'general').trim().toLowerCase();
  const message = String(input.message || '').trim();
  if (!subject || subject.length > 200) throw new Error('Subject must be between 1 and 200 characters');
  if (!/^[a-z_ -]{1,50}$/i.test(category)) throw new Error('Invalid support category');
  if (!message || message.length > 5_000) throw new Error('Message must be between 1 and 5000 characters');
  return { subject, category, message };
}

/** Creates an authenticated creator ticket without trusting a client user_id. */
export async function loadOwnTicketMessagesAction(ticketId: string): Promise<{ success: true; messages: Array<{ id: string; message: string; is_admin: boolean; created_at: string }> } | { success: false; error: string }> {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { success: false, error: 'You must be signed in' };
    const admin = createAdminClient();
    const { data: ticket } = await admin.from('support_tickets').select('id').eq('id', ticketId).eq('user_id', user.id).maybeSingle();
    if (!ticket) return { success: false, error: 'Ticket not found' };
    const { data: messages } = await admin.from('ticket_messages').select('id, message, is_admin, created_at').eq('ticket_id', ticket.id).order('created_at');
    return { success: true, messages: messages || [] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not load ticket messages' };
  }
}

export async function replyToOwnTicketAction(ticketId: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const clean = String(message || '').trim();
    if (!clean || clean.length > 5_000) return { success: false, error: 'Message must be between 1 and 5000 characters' };
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { success: false, error: 'You must be signed in' };
    const admin = createAdminClient();
    const { data: ticket } = await admin.from('support_tickets').select('id, status').eq('id', ticketId).eq('user_id', user.id).maybeSingle();
    if (!ticket) return { success: false, error: 'Ticket not found' };
    if (ticket.status === 'closed') return { success: false, error: 'This ticket is closed' };
    const { error } = await admin.from('ticket_messages').insert({ ticket_id: ticket.id, user_id: user.id, message: clean, is_admin: false });
    if (error) throw new Error('Could not send your reply');
    await admin.from('support_tickets').update({ status: 'open' }).eq('id', ticket.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not send your reply' };
  }
}

export async function createSupportTicketAction(input: SupportTicketInput): Promise<{ success: boolean; error?: string }> {
  try {
    const clean = cleanTicketInput(input);
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { success: false, error: 'You must be signed in' };
    const { data: profile } = await session
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return { success: false, error: 'Your profile is unavailable' };

    const admin = createAdminClient();
    const { data: ticket, error } = await admin
      .from('support_tickets')
      .insert({ user_id: user.id, subject: clean.subject, category: clean.category })
      .select('id')
      .single();
    if (error || !ticket) throw new Error('Could not create your ticket');

    const { error: messageError } = await admin
      .from('ticket_messages')
      .insert({ ticket_id: ticket.id, user_id: user.id, message: clean.message, is_admin: false });
    if (messageError) {
      await admin.from('support_tickets').delete().eq('id', ticket.id);
      throw new Error('Could not save your message');
    }

    // The email provider is optional; support submission never depends on it.
    if (profile.email) {
      await sendTemplateEmail('support_confirmation', profile.email, {
        name: profile.full_name || 'creator', ticketId: ticket.id.slice(0, 8), subject: clean.subject, message: clean.message.slice(0, 500),
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create your ticket' };
  }
}
