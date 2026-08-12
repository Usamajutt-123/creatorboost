'use client';
import { useState, useEffect } from 'react';
import { LifeBuoy, BookOpen, Mail, MessageCircle, Send } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { createSupportTicketAction, loadOwnTicketMessagesAction, replyToOwnTicketAction } from '@/lib/support-actions';
import { toast } from 'sonner';

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setTickets(data || []);
    };
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !message) { toast.error('Please fill all fields'); return; }
    setLoading(true);
    const result = await createSupportTicketAction({ subject, category, message });
    setLoading(false);
    if (!result.success) { toast.error(result.error || 'Ticket could not be submitted'); return; }
    toast.success('Ticket submitted. We will reply through your support ticket.');
    setSubject(''); setMessage('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setTickets(data || []);
  };

  const openTicket = async (ticket: any) => {
    setSelectedTicket(ticket);
    setTicketMessages([]);
    const result = await loadOwnTicketMessagesAction(ticket.id);
    if (!result.success) { toast.error(result.error); return; }
    setTicketMessages(result.messages);
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTicket) return;
    setReplying(true);
    const result = await replyToOwnTicketAction(selectedTicket.id, reply);
    setReplying(false);
    if (!result.success) { toast.error(result.error || 'Reply could not be sent'); return; }
    setReply('');
    const messages = await loadOwnTicketMessagesAction(selectedTicket.id);
    if (messages.success) setTicketMessages(messages.messages);
    toast.success('Reply sent');
  };

  return (
    <>
      <DashboardTopbar title="Support" />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-strong rounded-2xl p-6">
            <h3 className="font-semibold mb-4">Create a Ticket</h3>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} required className="input-field" placeholder="Brief description" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
                  <option value="general">General Inquiry</option>
                  <option value="payment">Payment Issue</option>
                  <option value="campaign">Campaign Problem</option>
                  <option value="account">Account Issue</option>
                  <option value="bug">Bug Report</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Message</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} required rows={6} className="input-field" placeholder="Describe your issue..." />
              </div>
              <button type="submit" disabled={loading} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2">
                <Send className="w-4 h-4" /> {loading ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </form>
          </div>
          <div className="space-y-4">
            {[
              { icon: BookOpen, title: 'Knowledge Base', desc: 'Tutorials & guides' },
              { icon: MessageCircle, title: 'Ticket updates', desc: 'Replies appear in your ticket history' },
              { icon: Mail, title: 'Email Support', desc: 'support@creatorboost.io' },
            ].map((s, i) => (
              <div key={i} className="glass rounded-2xl p-5 card-glow">
                <s.icon className="w-5 h-5 text-purple-400 mb-2" />
                <h4 className="font-semibold text-sm">{s.title}</h4>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            ))}
            <div className="glass rounded-2xl p-5"><p className="text-sm text-gray-300">Support replies are delivered in your ticket history.</p><p className="text-xs text-gray-500 mt-1">Open a ticket below to read or send a reply.</p></div>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Your Tickets</h3>
          <div className="space-y-2">
            {tickets.map(t => (
              <button key={t.id} onClick={() => openTicket(t)} className="w-full p-3 glass rounded-xl flex items-center justify-between text-left hover:bg-white/5 transition">
                <div><div className="font-medium text-sm">{t.subject}</div><div className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</div></div>
                <span className={`badge status-${t.status === 'resolved' || t.status === 'closed' ? 'paid' : t.status === 'in_progress' ? 'approved' : 'pending'}`}>{t.status}</span>
              </button>
            ))}
            {!tickets.length && <p className="text-sm text-gray-500 text-center py-4">No tickets yet</p>}
          </div>
        </div>

        {selectedTicket && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button aria-label="Close ticket" onClick={() => setSelectedTicket(null)} className="absolute inset-0 bg-black/70" /><section className="relative w-full max-w-2xl max-h-[85vh] flex flex-col glass-strong rounded-2xl p-5"><div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3"><div><h3 className="font-semibold">{selectedTicket.subject}</h3><p className="text-xs text-gray-500 capitalize">{selectedTicket.status.replace(/_/g, ' ')}</p></div><button onClick={() => setSelectedTicket(null)} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Close</button></div><div className="flex-1 overflow-y-auto space-y-3 py-4">{ticketMessages.length === 0 ? <p className="text-sm text-gray-500 text-center py-8">Loading ticket messages…</p> : ticketMessages.map(item => <div key={item.id} className={`rounded-xl p-3 text-sm ${item.is_admin ? 'bg-purple-500/15 border border-purple-500/30 mr-8' : 'glass ml-8'}`}><p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{item.is_admin ? 'Support' : 'You'} · {new Date(item.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap text-gray-200">{item.message}</p></div>)}</div>{selectedTicket.status !== 'closed' && <form onSubmit={sendReply} className="border-t border-white/10 pt-3 flex gap-2"><textarea value={reply} onChange={event => setReply(event.target.value)} className="input-field flex-1 min-h-11" rows={2} placeholder="Write a reply" maxLength={5000} /><button disabled={replying || !reply.trim()} className="btn-primary px-4 rounded-xl text-sm font-semibold text-white">{replying ? 'Sending…' : 'Reply'}</button></form>}</section></div>}
      </div>
    </>
  );
}
