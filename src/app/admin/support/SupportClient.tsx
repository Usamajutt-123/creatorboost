'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { adminListSupportTickets, adminReplySupportTicket, adminSetSupportTicketStatus } from '@/lib/admin-server';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

/**
 * The ticket list is server-rendered (see page.tsx); selecting, replying and
 * status updates keep their exact previous behavior.
 */
export default function AdminSupportClient({
  initialTickets,
  initialError,
}: {
  initialTickets: any[];
  initialError: string | null;
}) {
  const [tickets, setTickets] = useState<any[]>(initialTickets);
  const [selected, setSelected] = useState<any | null>(null);
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('in_progress');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialError) return;
    toast.error(initialError);
  }, [initialError]);

  const load = async () => {
    try {
      const rows = await adminListSupportTickets();
      setTickets(rows);
      if (selected) setSelected(rows.find(ticket => ticket.id === selected.id) || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load support tickets');
    } finally {
      setLoading(false);
    }
  };

  const open = (ticket: any) => {
    setSelected(ticket);
    setStatus(ticket.status);
    setReply('');
  };
  const saveStatus = async (next: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      await adminSetSupportTicketStatus(selected.id, next);
      toast.success('Ticket status updated');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update ticket');
    } finally { setSaving(false); }
  };
  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setSaving(true);
    try {
      await adminReplySupportTicket(selected.id, reply, status);
      toast.success('Reply sent');
      setReply('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send reply');
    } finally { setSaving(false); }
  };

  return <div className="p-4 sm:p-6 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">Support Management</h2><p className="text-sm text-gray-500">Review, reply to, and resolve creator and public contact tickets.</p></div><button onClick={() => { setLoading(true); void load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button></div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4"><section className="glass rounded-2xl p-4 max-h-[72vh] overflow-y-auto"><h3 className="font-semibold mb-3">Tickets ({tickets.length})</h3>{loading ? <div className="space-y-2">{[1,2,3].map(item => <div key={item} className="skeleton h-16 rounded-xl" />)}</div> : <div className="space-y-2">{tickets.map(ticket => <button key={ticket.id} onClick={() => open(ticket)} className={`w-full p-3 rounded-xl text-left transition ${selected?.id === ticket.id ? 'bg-purple-500/15 ring-1 ring-purple-500/50' : 'glass hover:bg-white/5'}`}><div className="flex justify-between gap-2"><span className="font-medium text-sm truncate">{ticket.subject}</span><span className={`badge status-${ticket.status === 'resolved' || ticket.status === 'closed' ? 'paid' : ticket.status === 'in_progress' ? 'approved' : 'pending'}`}>{ticket.status}</span></div><p className="text-xs text-gray-500 mt-1 truncate">{ticket.user?.full_name || ticket.user?.username || 'Public contact'} · {new Date(ticket.updated_at).toLocaleString()}</p></button>)}{!tickets.length && <p className="text-sm text-gray-500 text-center py-10">No support tickets.</p>}</div>}</section>
      <section className="glass-strong rounded-2xl p-5 min-h-[420px] flex flex-col">{!selected ? <div className="m-auto text-center text-gray-500"><MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>Select a ticket to view its conversation.</p></div> : <><div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3"><div><h3 className="font-semibold">{selected.subject}</h3><p className="text-xs text-gray-500">{selected.user?.full_name || selected.user?.username || 'Public contact'} · {selected.category}</p></div><select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="input-field text-xs py-2 w-auto">{STATUSES.map(item => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></div><div className="flex-1 overflow-y-auto space-y-3 py-4 max-h-[48vh]">{selected.messages.map((message: any) => <div key={message.id} className={`rounded-xl p-3 text-sm ${message.is_admin ? 'bg-purple-500/15 border border-purple-500/30 ml-8' : 'glass mr-8'}`}><p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{message.is_admin ? 'Staff reply' : 'Requester'} · {new Date(message.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap text-gray-200">{message.message}</p></div>)}{!selected.messages.length && <p className="text-sm text-gray-500 text-center py-6">No messages saved.</p>}</div><form onSubmit={sendReply} className="border-t border-white/10 pt-3"><textarea value={reply} onChange={event => setReply(event.target.value)} className="input-field w-full" rows={3} maxLength={5000} placeholder="Write a staff reply" /><div className="flex justify-between gap-2 mt-2"><button type="button" disabled={saving} onClick={() => saveStatus(status)} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Save status</button><button disabled={saving || !reply.trim()} className="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white flex items-center gap-1"><Send className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Send reply'}</button></div></form></>}</section></div>
  </div>;
}
