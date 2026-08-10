'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';
import { Search, X, Eye, Ban, Shield, ShieldOff, UserCheck, UserMinus, Mail, DollarSign, BarChart3, Megaphone, Wallet, Pause, Play } from 'lucide-react';

type Profile = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  level: string;
  role: string;
  status: string;
  total_earnings: number;
  total_views: number;
  valid_views: number;
  created_at: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Profile | null>(null);
  const [detail, setDetail] = useState<{ campaigns: any[]; withdrawals: any[]; earnings: any[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('profiles')
      .select('id, username, full_name, email, level, role, status, total_earnings, total_views, valid_views, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    setUsers((data || []) as Profile[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadDetail = async (user: Profile) => {
    setSelected(user);
    setDetail(null);
    const supabase = createClient();
    const [{ data: c }, { data: w }, { data: e }] = await Promise.all([
      supabase.from('campaigns').select('*').eq('creator_id', user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(20),
      supabase.from('withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('earnings').select('*, campaign:campaigns(name)').eq('creator_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    setDetail({ campaigns: c || [], withdrawals: w || [], earnings: e || [] });
  };

  const updateUser = async (id: string, patch: Partial<Profile>, action: string) => {
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(action);
    load();
    if (selected?.id === id) {
      setSelected({ ...selected, ...patch });
    }
  };

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.email?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Manage Users</h2>
          <p className="text-sm text-gray-500">{filtered.length} of {users.length} users</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email, username, name..."
            className="input-field pl-10"
          />
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
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[700px]">
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
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-white/5 table-row">
                    <td className="py-3 px-4 sm:px-2">
                      <button onClick={() => loadDetail(u)} className="flex items-center gap-2 text-left group">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {u.full_name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium group-hover:text-purple-300 truncate max-w-[160px]">{u.full_name || u.username}</div>
                          <div className="text-[10px] text-gray-500">@{u.username}</div>
                        </div>
                      </button>
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-xs hidden lg:table-cell">{u.email}</td>
                    <td className="py-3 px-2"><span className={`badge badge-${u.level}`}>{u.level}</span></td>
                    <td className="py-3 px-2">
                      <span className={`badge ${u.role === 'super_admin' ? 'badge-diamond' : u.role === 'admin' ? 'badge-platinum' : 'badge-silver'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-green-400 font-semibold text-xs hidden md:table-cell">{formatCurrency(u.total_earnings)}</td>
                    <td className="py-3 px-2">
                      <span className={`badge status-${u.status === 'active' ? 'active' : u.status === 'pending_verification' ? 'pending' : 'rejected'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 sm:px-2 text-right">
                      <button onClick={() => loadDetail(u)} className="p-1.5 hover:bg-white/10 rounded text-purple-400" title="View profile">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={7} className="py-12 text-center text-gray-500 text-sm">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto glass-strong rounded-t-2xl sm:rounded-2xl shadow-2xl">
            <div className="sticky top-0 glass-strong border-b border-white/10 p-4 flex items-center justify-between z-10">
              <h3 className="font-display text-lg font-bold">User Profile</h3>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-white/10 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Profile */}
              <div className="flex items-start gap-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-2xl font-bold flex-shrink-0">
                  {selected.full_name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-lg">{selected.full_name || selected.username}</h4>
                  <p className="text-xs text-gray-400">@{selected.username}</p>
                  <p className="text-xs text-gray-500 truncate">{selected.email}</p>
                  <div className="flex gap-1.5 mt-2">
                    <span className={`badge badge-${selected.level}`}>{selected.level}</span>
                    <span className={`badge ${selected.role === 'super_admin' ? 'badge-diamond' : selected.role === 'admin' ? 'badge-platinum' : 'badge-silver'}`}>{selected.role}</span>
                    <span className={`badge status-${selected.status === 'active' ? 'active' : 'rejected'}`}>{selected.status}</span>
                  </div>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Earnings</div><div className="font-bold text-green-400 text-sm">{formatCurrency(selected.total_earnings)}</div></div>
                <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Views</div><div className="font-bold text-sm">{formatNumber(selected.total_views)}</div></div>
                <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Valid</div><div className="font-bold text-sm">{formatNumber(selected.valid_views)}</div></div>
                <div className="glass rounded-lg p-3"><div className="text-xs text-gray-500">Joined</div><div className="font-bold text-xs">{timeAgo(selected.created_at)}</div></div>
              </div>

              {/* Management actions */}
              <div className="glass rounded-xl p-4 space-y-2">
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Account Actions</h5>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {selected.status === 'active' ? (
                    <button onClick={() => updateUser(selected.id, { status: 'suspended' }, 'User suspended')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-yellow-300">
                      <Pause className="w-3.5 h-3.5" /> Suspend
                    </button>
                  ) : (
                    <button onClick={() => updateUser(selected.id, { status: 'active' }, 'User activated')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-green-300">
                      <Play className="w-3.5 h-3.5" /> Activate
                    </button>
                  )}
                  <button onClick={() => updateUser(selected.id, { status: 'banned' }, 'User banned')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-red-300">
                    <Ban className="w-3.5 h-3.5" /> Ban
                  </button>

                  {selected.role === 'creator' && (
                    <button onClick={() => updateUser(selected.id, { role: 'admin' }, 'Promoted to admin')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-blue-300">
                      <Shield className="w-3.5 h-3.5" /> Make Admin
                    </button>
                  )}
                  {selected.role === 'admin' && (
                    <>
                      <button onClick={() => updateUser(selected.id, { role: 'super_admin' }, 'Promoted to super admin')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-purple-300">
                        <Shield className="w-3.5 h-3.5" /> Make Super
                      </button>
                      <button onClick={() => updateUser(selected.id, { role: 'creator' }, 'Demoted to creator')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-gray-300">
                        <ShieldOff className="w-3.5 h-3.5" /> Demote
                      </button>
                    </>
                  )}
                  {selected.role === 'super_admin' && (
                    <button onClick={() => updateUser(selected.id, { role: 'admin' }, 'Demoted to admin')} disabled={busy === selected.id} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-gray-300">
                      <ShieldOff className="w-3.5 h-3.5" /> Demote to Admin
                    </button>
                  )}
                </div>
              </div>

              {/* Campaigns */}
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Campaigns ({detail?.campaigns.length || '...'})</h5>
                {!detail ? (
                  <div className="skeleton h-20 rounded-lg" />
                ) : detail.campaigns.length === 0 ? (
                  <p className="text-xs text-gray-500 glass rounded-lg p-3">No campaigns</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {detail.campaigns.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-[10px] text-gray-500">{formatNumber(c.total_views)} views Â· {formatCurrency(c.total_earnings)}</div>
                        </div>
                        <span className={`badge status-${c.status}`}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Withdrawals */}
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Withdrawals</h5>
                {!detail ? (
                  <div className="skeleton h-20 rounded-lg" />
                ) : detail.withdrawals.length === 0 ? (
                  <p className="text-xs text-gray-500 glass rounded-lg p-3">No withdrawals</p>
                ) : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {detail.withdrawals.map((w: any) => (
                      <div key={w.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div>
                          <div className="font-medium text-green-400">{formatCurrency(w.amount)}</div>
                          <div className="text-[10px] text-gray-500">{w.method} Â· {timeAgo(w.created_at)}</div>
                        </div>
                        <span className={`badge status-${w.status}`}>{w.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent earnings */}
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Recent Earnings</h5>
                {!detail ? (
                  <div className="skeleton h-20 rounded-lg" />
                ) : detail.earnings.length === 0 ? (
                  <p className="text-xs text-gray-500 glass rounded-lg p-3">No earnings</p>
                ) : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {detail.earnings.map((er: any) => (
                      <div key={er.id} className="flex items-center justify-between glass rounded-lg p-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-green-400">+{formatCurrency(er.amount)}</div>
                          <div className="text-[10px] text-gray-500 truncate">{er.campaign?.name || er.type}</div>
                        </div>
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