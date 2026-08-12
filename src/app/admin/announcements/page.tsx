'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, CheckCircle2, Eye, RefreshCw, Search, Send, Users, X } from 'lucide-react';
import {
  adminGetAnnouncementRecipientCount,
  adminListAnnouncementCreators,
  adminListAnnouncements,
  adminSendAnnouncement,
  type AdminAnnouncementAudience,
  type AdminAnnouncementType,
} from '@/lib/admin-server';

type Creator = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  status: string;
};

type HistoryRow = {
  id: string;
  title: string;
  body: string;
  type: string;
  audience: string;
  recipient_count: number;
  created_at: string;
  sent_at: string | null;
  sent_by: string | null;
  status: string;
  sender: { full_name: string | null; email: string | null } | null;
};

const TYPE_OPTIONS: { value: AdminAnnouncementType; label: string; hint: string }[] = [
  { value: 'announcement', label: 'Announcement', hint: 'General platform news' },
  { value: 'important', label: 'Important', hint: 'Needs creator attention' },
  { value: 'maintenance', label: 'Maintenance', hint: 'Planned service work' },
  { value: 'update', label: 'Update', hint: 'New feature or improvement' },
];

const AUDIENCE_OPTIONS: { value: AdminAnnouncementAudience; label: string; hint: string }[] = [
  { value: 'all_creators', label: 'All creators', hint: 'Includes active, suspended, and banned creator profiles' },
  { value: 'active_creators', label: 'Active creators only', hint: 'Only creators with an active account' },
  { value: 'suspended_creators', label: 'Suspended creators', hint: 'Only suspended creator profiles' },
  { value: 'banned_creators', label: 'Banned creators', hint: 'Only banned creator profiles' },
  { value: 'specific_creators', label: 'Specific creator(s)', hint: 'Choose one or more creator profiles' },
];

function audienceLabel(value: string) {
  return AUDIENCE_OPTIONS.find(option => option.value === value)?.label || value.replace(/_/g, ' ');
}

function typeLabel(value: string) {
  return TYPE_OPTIONS.find(option => option.value === value)?.label || value;
}

function typeColor(value: string) {
  if (value === 'important') return 'text-amber-300 bg-amber-400/10 border-amber-400/20';
  if (value === 'maintenance') return 'text-blue-300 bg-blue-400/10 border-blue-400/20';
  if (value === 'update') return 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20';
  return 'text-purple-300 bg-purple-400/10 border-purple-400/20';
}

function typeIcon(value: string) {
  if (value === 'important') return '⚠️';
  if (value === 'maintenance') return '🛠️';
  if (value === 'update') return '✨';
  return '📣';
}

function creatorName(creator: Creator) {
  return creator.full_name || creator.username || creator.email || 'Creator';
}

function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `announcement-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminAnnouncementsPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<AdminAnnouncementType>('announcement');
  const [audience, setAudience] = useState<AdminAnnouncementAudience>('all_creators');
  const [selectedCreators, setSelectedCreators] = useState<Record<string, Creator>>({});
  const [creatorSearch, setCreatorSearch] = useState('');
  const [creatorResults, setCreatorResults] = useState<Creator[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerState, setComposerState] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const countRequest = useRef(0);

  const selectedIds = useMemo(() => Object.keys(selectedCreators), [selectedCreators]);
  const selectedIdKey = selectedIds.join(',');
  const selectedType = TYPE_OPTIONS.find(option => option.value === type) || TYPE_OPTIONS[0];
  const selectedAudience = AUDIENCE_OPTIONS.find(option => option.value === audience) || AUDIENCE_OPTIONS[0];

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory((await adminListAnnouncements()) as HistoryRow[]);
    } catch (error: any) {
      const text = error?.message || 'Announcement history could not be loaded.';
      setHistoryError(text);
      toast.error(text);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const request = ++countRequest.current;
    setRecipientCount(null);
    setCountLoading(true);
    adminGetAnnouncementRecipientCount(audience, audience === 'specific_creators' ? selectedIds : [])
      .then(count => {
        if (request === countRequest.current) setRecipientCount(count);
      })
      .catch(error => {
        if (request === countRequest.current) {
          setRecipientCount(null);
          setComposerState({ kind: 'error', text: error?.message || 'Recipient count could not be calculated.' });
        }
      })
      .finally(() => {
        if (request === countRequest.current) setCountLoading(false);
      });
    // selectedIdKey is the stable dependency for the selected creator array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, selectedIdKey]);

  useEffect(() => {
    if (audience !== 'specific_creators') return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCreatorsLoading(true);
      try {
        const rows = await adminListAnnouncementCreators(creatorSearch);
        if (!cancelled) setCreatorResults(rows as Creator[]);
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || 'Creators could not be loaded.');
      } finally {
        if (!cancelled) setCreatorsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audience, creatorSearch]);

  const toggleCreator = (creator: Creator) => {
    setSelectedCreators(previous => {
      const next = { ...previous };
      if (next[creator.id]) delete next[creator.id];
      else next[creator.id] = creator;
      return next;
    });
  };

  const sendAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (!title.trim() || !message.trim()) {
      setComposerState({ kind: 'error', text: 'Add a title and message before sending.' });
      return;
    }
    if (audience === 'specific_creators' && selectedIds.length === 0) {
      setComposerState({ kind: 'error', text: 'Select at least one creator.' });
      return;
    }
    if (recipientCount === null || countLoading) {
      setComposerState({ kind: 'error', text: 'Wait for the recipient count to finish calculating.' });
      return;
    }

    setSending(true);
    setComposerState(null);
    const key = idempotencyKey.current || newIdempotencyKey();
    idempotencyKey.current = key;
    try {
      const result = await adminSendAnnouncement({
        title,
        message,
        type,
        audience,
        recipientIds: selectedIds,
        idempotencyKey: key,
      });
      const duplicateText = result.duplicate ? 'This announcement was already sent safely.' : 'Announcement sent successfully.';
      const successText = `${duplicateText} ${result.recipientCount.toLocaleString()} creator${result.recipientCount === 1 ? '' : 's'} notified.`;
      setComposerState({ kind: 'success', text: successText });
      toast.success(successText);
      idempotencyKey.current = null;
      setTitle('');
      setMessage('');
      setPreviewOpen(false);
      if (audience === 'specific_creators') setSelectedCreators({});
      await loadHistory();
    } catch (error: any) {
      const text = error?.message || 'Announcement could not be sent.';
      setComposerState({ kind: 'error', text });
      toast.error(text);
      // Keep the same key for a safe retry if the response was lost or the
      // transient database request failed.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-purple-300" />
            <h2 className="font-display text-2xl font-bold">Announcements</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">Send secure in-app updates to creator notification feeds.</p>
        </div>
        <button type="button" onClick={() => void loadHistory()} disabled={historyLoading} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} /> Refresh history
        </button>
      </div>

      <section className="glass rounded-2xl p-4 sm:p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-400/20 flex items-center justify-center flex-shrink-0">
            <Send className="w-5 h-5 text-purple-300" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold">Announcement Composer</h3>
            <p className="text-xs text-gray-500 mt-0.5">Every send is authorized on the server and protected against duplicate submissions.</p>
          </div>
        </div>

        <form onSubmit={sendAnnouncement} className="space-y-4">
          <div>
            <label htmlFor="announcement-title" className="block text-xs font-semibold text-gray-300 mb-1.5">Title</label>
            <input
              id="announcement-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="input-field"
              placeholder="Platform Update"
              maxLength={200}
              required
            />
            <div className="text-[10px] text-gray-600 text-right mt-1">{title.length}/200</div>
          </div>

          <div>
            <label htmlFor="announcement-message" className="block text-xs font-semibold text-gray-300 mb-1.5">Message</label>
            <textarea
              id="announcement-message"
              value={message}
              onChange={event => setMessage(event.target.value)}
              className="input-field min-h-32 resize-y"
              placeholder="CreatorBoost has received a new dashboard update."
              maxLength={2000}
              rows={5}
              required
            />
            <div className="text-[10px] text-gray-600 text-right mt-1">{message.length}/2000</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="announcement-type" className="block text-xs font-semibold text-gray-300 mb-1.5">Notification type</label>
              <select id="announcement-type" value={type} onChange={event => setType(event.target.value as AdminAnnouncementType)} className="input-field">
                {TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-500 mt-1.5">{selectedType.hint}</p>
            </div>
            <div>
              <label htmlFor="announcement-audience" className="block text-xs font-semibold text-gray-300 mb-1.5">Audience</label>
              <select id="announcement-audience" value={audience} onChange={event => setAudience(event.target.value as AdminAnnouncementAudience)} className="input-field">
                {AUDIENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-500 mt-1.5">{selectedAudience.hint}</p>
            </div>
          </div>

          {audience === 'specific_creators' && (
            <div className="glass rounded-xl p-4 border border-purple-400/15">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h4 className="text-sm font-semibold">Choose creators</h4>
                  <p className="text-[11px] text-gray-500">Search by name, username, or email. Suspended and banned creators can be selected.</p>
                </div>
                <span className="badge bg-purple-400/10 text-purple-200 border border-purple-400/20">{selectedIds.length} selected</span>
              </div>
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={creatorSearch} onChange={event => setCreatorSearch(event.target.value)} className="input-field pl-9" placeholder="Search creators..." />
              </div>
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedIds.map(id => {
                    const creator = selectedCreators[id];
                    return (
                      <button key={id} type="button" onClick={() => toggleCreator(creator)} className="badge bg-white/5 text-gray-200 border border-white/10 hover:border-purple-400/40">
                        {creatorName(creator)} <X className="w-3 h-3" />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="max-h-56 overflow-y-auto space-y-1">
                {creatorsLoading && <p className="text-xs text-gray-500 py-4 text-center">Searching creators…</p>}
                {!creatorsLoading && creatorResults.map(creator => {
                  const selected = Boolean(selectedCreators[creator.id]);
                  return (
                    <button
                      key={creator.id}
                      type="button"
                      onClick={() => toggleCreator(creator)}
                      className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-3 transition ${selected ? 'bg-purple-500/15 border border-purple-400/30' : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${selected ? 'bg-purple-500/30 text-purple-100' : 'bg-white/10 text-gray-300'}`}>
                        {creatorName(creator)[0]?.toUpperCase() || 'C'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium truncate">{creatorName(creator)}</span>
                        <span className="block text-[10px] text-gray-500 truncate">{creator.email || `@${creator.username || 'creator'}`}</span>
                      </span>
                      <span className={`text-[10px] capitalize ${creator.status === 'active' ? 'text-green-300' : creator.status === 'suspended' ? 'text-amber-300' : 'text-red-300'}`}>{creator.status.replace(/_/g, ' ')}</span>
                      {selected && <CheckCircle2 className="w-4 h-4 text-purple-300 flex-shrink-0" />}
                    </button>
                  );
                })}
                {!creatorsLoading && !creatorResults.length && <p className="text-xs text-gray-500 py-4 text-center">No creators found.</p>}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-purple-400/20 bg-purple-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-300" />
              <span className="text-sm text-gray-200">Recipient count</span>
            </div>
            <strong className="text-purple-100">
              {countLoading ? 'Calculating…' : recipientCount === null ? 'Unavailable' : `${recipientCount.toLocaleString()} creator${recipientCount === 1 ? '' : 's'}`}
            </strong>
          </div>

          {composerState && (
            <div role="status" className={`rounded-xl px-4 py-3 text-sm border ${composerState.kind === 'success' ? 'border-green-400/20 bg-green-400/10 text-green-200' : 'border-red-400/20 bg-red-400/10 text-red-200'}`}>
              {composerState.text}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={() => setPreviewOpen(true)} className="btn-ghost px-4 py-2.5 text-sm flex items-center gap-2">
              <Eye className="w-4 h-4" /> Preview
            </button>
            <button type="submit" disabled={sending || countLoading || recipientCount === null || !title.trim() || !message.trim() || (audience === 'specific_creators' && selectedIds.length === 0)} className="btn-primary px-5 py-2.5 text-sm gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
              <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send Announcement'}
            </button>
          </div>
        </form>
      </section>

      <section className="glass rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-display text-lg font-semibold">Announcement History</h3>
            <p className="text-xs text-gray-500 mt-0.5">Previously sent in-app announcements and delivery counts.</p>
          </div>
          <span className="text-xs text-gray-500">{history.length} shown</span>
        </div>
        {historyError && <div className="rounded-xl bg-red-400/10 border border-red-400/20 p-3 text-sm text-red-200 mb-3">{historyError}</div>}
        {historyLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(item => <div key={item} className="skeleton h-14 rounded-lg" />)}</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 px-4 sm:px-2 font-medium">Announcement</th>
                  <th className="text-left py-2 px-2 font-medium">Type</th>
                  <th className="text-left py-2 px-2 font-medium">Audience</th>
                  <th className="text-left py-2 px-2 font-medium">Recipients</th>
                  <th className="text-left py-2 px-2 font-medium">Date</th>
                  <th className="text-left py-2 px-2 font-medium">Admin</th>
                  <th className="text-left py-2 px-4 sm:px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(row => (
                  <tr key={row.id} className="border-b border-white/5 align-top">
                    <td className="py-3 px-4 sm:px-2 max-w-[280px]">
                      <div className="font-medium truncate">{row.title}</div>
                    </td>
                    <td className="py-3 px-2"><span className={`badge border ${typeColor(row.type)}`}>{typeLabel(row.type)}</span></td>
                    <td className="py-3 px-2 text-gray-400 whitespace-nowrap">{audienceLabel(row.audience)}</td>
                    <td className="py-3 px-2 text-gray-300 whitespace-nowrap">{Number(row.recipient_count || 0).toLocaleString()}</td>
                    <td className="py-3 px-2 text-gray-400 whitespace-nowrap">{dateTime(row.sent_at || row.created_at)}</td>
                    <td className="py-3 px-2 text-gray-400 max-w-[170px] truncate">{row.sender?.full_name || row.sender?.email || 'System'}</td>
                    <td className="py-3 px-4 sm:px-2"><span className={`badge ${row.status === 'sent' ? 'text-green-300 bg-green-400/10 border border-green-400/20' : 'text-amber-300 bg-amber-400/10 border border-amber-400/20'}`}>{row.status}</span></td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan={7} className="py-12 text-center text-gray-500">No announcements sent yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close announcement preview" className="absolute inset-0 bg-black/75" onClick={() => setPreviewOpen(false)} />
          <section className="relative w-full max-w-lg glass-strong rounded-2xl p-5 shadow-2xl border border-purple-400/20">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-purple-300">Creator notification preview</p>
                <h3 className="font-display text-xl font-bold mt-1">{title.trim() || 'Untitled announcement'}</h3>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} className="p-2 text-gray-400 hover:text-white" aria-label="Close preview"><X className="w-5 h-5" /></button>
            </div>
            <div className="glass rounded-xl p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center text-xl flex-shrink-0">{typeIcon(type)}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-sm">{title.trim() || 'Untitled announcement'}</h4>
                  <span className={`badge border ${typeColor(type)}`}>{selectedType.label}</span>
                </div>
                <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap break-words">{message.trim() || 'Your announcement message will appear here.'}</p>
                <p className="text-xs text-gray-500 mt-3">Just now · {recipientCount === null ? 'recipient count pending' : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}`}</p>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setPreviewOpen(false)} className="btn-primary px-4 py-2 text-sm">Looks good</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
