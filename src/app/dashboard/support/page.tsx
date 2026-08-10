'use client';
import { useState, useEffect } from 'react';
import { LifeBuoy, BookOpen, Mail, MessageCircle, Send } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);

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
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: ticket, error } = await supabase.from('support_tickets').insert({
      user_id: user.id, subject, category, status: 'open', priority: 'medium',
    }).select().single();

    if (error) { toast.error(error.message); setLoading(false); return; }

    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id, user_id: user.id, message, is_admin: false,
    });

    setLoading(false);
    toast.success('Ticket submitted! We\'ll respond within 24 hours.');
    setSubject(''); setMessage('');
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setTickets(data || []);
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
              { icon: MessageCircle, title: 'Live Chat', desc: 'Coming soon' },
              { icon: Mail, title: 'Email Support', desc: 'support@creatorboost.io' },
            ].map((s, i) => (
              <div key={i} className="glass rounded-2xl p-5 card-glow">
                <s.icon className="w-5 h-5 text-purple-400 mb-2" />
                <h4 className="font-semibold text-sm">{s.title}</h4>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            ))}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Support online
              </div>
              <p className="text-xs text-gray-500 mt-1">Avg response: 2 hours</p>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Your Tickets</h3>
          <div className="space-y-2">
            {tickets.map(t => (
              <div key={t.id} className="p-3 glass rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{t.subject}</div>
                  <div className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <span className={`badge status-${t.status === 'resolved' || t.status === 'closed' ? 'paid' : t.status === 'in_progress' ? 'approved' : 'pending'}`}>{t.status}</span>
              </div>
            ))}
            {!tickets.length && <p className="text-sm text-gray-500 text-center py-4">No tickets yet</p>}
          </div>
        </div>
      </div>
    </>
  );
}
