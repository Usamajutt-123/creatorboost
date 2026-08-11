'use client';
import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Search, X, Ban, Shield, ShieldOff, UserCheck, UserMinus, Mail, DollarSign, Megaphone, Wallet, Pause, Play, RefreshCw } from 'lucide-react';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/utils';
import {
  serverAdminMe, adminListUsers, adminSetUserStatus, adminSetUserRole, adminUserDetail,
} from '@/lib/admin-server';

type Profile = {
  id: string; username: string; full_name: string; email: string; level: string;
  role: string; status: string; total_earnings: number; total_views: number;
  valid_views: number; created_at: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Profile | null>(null);
  const [detail, setDetail] = useState<{ campaigns: any[]; withdrawals: any[]; earnings: any[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await serverAdminMe();
    if (me.isSuper) setIsSuper(true);
    try {
      const rows = await adminListUsers(search, roleFilter, statusFilter);
      setUsers(rows as Profile[]);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (user: Profile) => {
    setSelected(user);
    setDetail(null);
    try {
      const d = await adminUserDetail(user.id);
      setDetail(d);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load detail');
    }
  };

  const setStatus = async (id: string, status: string, label: string) => {
    setBusy(id);
    try { await adminSetUserStatus(id, status); toast.success(label); }
    catch (e: any) { toast.error(e.message || 'Action failed'); }
    finally { setBusy(null); load(); if (selected?.id === id) setSelected({ ...selected, status }); }
  };

  const setRole = async (id: string, role: string, label: string) => {
    setBusy(id);
    try { await adminSetUserRole(id, role); toast.success(label); }
    catch (e: any) { toast.error(e.message || 'Role change failed'); }
    finally { setBusy(null); load(); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Manage Users</h2>
          <p className="text-sm text-gray-500">{users.length} users</p>
        </div>
        <button onClick={() => { setLoading(true); load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email, username, name..." className="input-field pl-10" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-field sm:w-auto">
          <option value="all">All Roles</option>
          <option value="creator">Creator</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field sm:w-auto">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
          <option value="pending_verification">Pending</option>
        </select>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5">
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 px-4 sm:px-2 font-medium">User</th>
                  <th className="text-left py-2 px-2 font-medium hidden lg:table-cell">Email</th>
                  <th className="text-left py-2 px-2 font-medium">Level</th>
                  <th className="text-left py-2 px-2 font-medium">Role</th>
                  <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Earnings</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                  <th className="text-right py-2 px-4 sm:px-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-white/5 table-row cursor-pointer hover:bg-white/5" onClick={() => loadDetail(u)}>
                    <td className="py-3 px-4 sm:px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(u.full_name || u.username || 'U')[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{u.full_name || u.username}</div>
                          <div className="text-[10px] text-gray-500">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-gray-400 hidden lg:table-cell">{u.email}</td>
                    <td className="py-3 px-2"><span className={`badge badge-${u.level}`}>{u.level}</span></td>
                    <td className="py-3 px-2 text-gray-300">{u.role}</td>
                    <td className="py-3 px-2 text-green-400 hidden md:table-cell">{formatCurrency(u.total_earnings)}</td>
                    <td className="py-3 px-2"><span className={`badge status-${u.status === 'active' ? 'active' : u.status === 'suspended' ? 'paused' : u.status === 'banned' ? 'rejected' : 'pending'}`}>{u.status}</span></td>
                    <td className="py-3 px-4 sm:px-2 text-right">
                      <span className="text-xs text-purple-400">View</span>
                    </td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={7} className="py-10 text-center text-gray-500 text-sm">No users found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelected(null)} />
          <div className="relative bg-[#0f0a1f] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display text-xl font-bold">{selected.full_name || selected.username}</h3>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {selected.email} · {timeAgo(selected.created_at)}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Earnings</div><div className="font-bold text-sm">{formatCurrency(selected.total_earnings)}</div></div>
              <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Views</div><div className="font-bold text-sm">{formatNumber(selected.total_views)}</div></div>
              <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Valid</div><div className="font-bold text-sm">{formatNumber(selected.valid_views)}</div></div>
              <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Role</div><div className="font-bold text-sm">{selected.role}</div></div>
            </div>

            <div className="glass rounded-xl p-4 space-y-2">
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Account Actions</h5>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {selected.status === 'active' ? (
                  <button onClick={() => setStatus(selected.id, 'suspended', 'User suspended')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-yellow-300"><Pause className="w-3.5 h-3.5" /> Suspend</button>
                ) : (
                  <button onClick={() => setStatus(selected.id, 'active', 'User activated')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-green-300"><Play className="w-3.5 h-3.5" /> Activate</button>
                )}
                <button onClick={() => setStatus(selected.id, 'banned', 'User banned')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-red-300"><Ban className="w-3.5 h-3.5" /> Ban</button>
                {selected.status === 'banned' && (
                  <button onClick={() => setStatus(selected.id, 'active', 'User unbanned')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-green-300"><UserCheck className="w-3.5 h-3.5" /> Unban</button>
                )}
              </div>
              {isSuper ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-white/5">
                  {selected.role === 'creator' && <button onClick={() => setRole(selected.id, 'admin', 'Promoted to admin')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-blue-300"><Shield className="w-3.5 h-3.5" /> Make Admin</button>}
                  {selected.role === 'admin' && <button onClick={() => setRole(selected.id, 'super_admin', 'Promoted to super admin')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-purple-300"><Shield className="w-3.5 h-3.5" /> Make Super</button>}
                  {(selected.role === 'admin' || selected.role === 'super_admin') && <button onClick={() => setRole(selected.id, 'creator', 'Demoted to creator')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-gray-300"><UserMinus className="w-3.5 h-3.5" /> Demote</button>}
                </div>
              ) : (
                <p className="text-[10px] text-gray-500 pt-2 border-t border-white/5">Role changes require super admin privileges.</p>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Campaigns ({detail?.campaigns.length || '...'})</h5>
                {!detail ? <div className="skeleton h-20 rounded-lg" /> : detail.campaigns.length === 0 ? <p className="text-xs text-gray-500 glass rounded-lg p-3">No campaigns</p> : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {detail.campaigns.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div className="min-w-0 flex-1"><div className="font-medium truncate">{c.name}</div><div className="text-[10px] text-gray-500">{formatNumber(c.total_views)} views · {formatCurrency(c.total_earnings)}</div></div>
                        <span className={`badge status-${c.status}`}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Withdrawals</h5>
                {!detail ? <div className="skeleton h-20 rounded-lg" /> : detail.withdrawals.length === 0 ? <p className="text-xs text-gray-500 glass rounded-lg p-3">No withdrawals</p> : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {detail.withdrawals.map((w: any) => (
                      <div key={w.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div><div className="font-medium text-green-400">{formatCurrency(w.amount)}</div><div className="text-[10px] text-gray-500">{w.method} · {timeAgo(w.created_at)}</div></div>
                        <span className={`badge status-${w.status}`}>{w.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Recent Earnings</h5>
                {!detail ? <div className="skeleton h-20 rounded-lg" /> : detail.earnings.length === 0 ? <p className="text-xs text-gray-500 glass rounded-lg p-3">No earnings</p> : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {detail.earnings.map((er: any) => (
                      <div key={er.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div className="min-w-0 flex-1"><div className="font-medium text-green-400">+{formatCurrency(er.amount)}</div><div className="text-[10px] text-gray-500 truncate">{er.campaign?.name || er.type}</div></div>
                        <div className="text-[10px] text-gray-500">{timeAgo(er.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
