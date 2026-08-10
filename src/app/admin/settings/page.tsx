'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Save, Plus, Edit, Trash2, X, Check, Power, PowerOff } from 'lucide-react';

type Method = {
  id: number;
  method: string;
  label: string;
  icon: string;
  enabled: boolean;
  min_amount: number;
  max_amount: number;
  fee_percentage: number;
  sort_order: number;
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingMethod, setEditingMethod] = useState<Method | null>(null);
  const [newMethod, setNewMethod] = useState({ method: '', label: '', icon: 'ðŸ’³', min_amount: 1, max_amount: 10000, fee_percentage: 0 });

  const load = async () => {
    const supabase = createClient();
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('platform_settings').select('*').eq('id', 1).single(),
      supabase.from('withdrawal_method_config').select('*').order('sort_order'),
    ]);
    setSettings(s);
    setMethods((m || []) as Method[]);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from('platform_settings').update({
      site_name: settings.site_name,
      site_tagline: settings.site_tagline,
      support_email: settings.support_email,
      site_announcement: settings.site_announcement,
      site_announcement_active: settings.site_announcement_active,
      min_withdrawal: parseFloat(settings.min_withdrawal),
      referral_percentage: parseFloat(settings.referral_percentage),
      fraud_detection_sensitivity: settings.fraud_detection_sensitivity,
      vpn_block_enabled: settings.vpn_block_enabled,
      duplicate_device_block: settings.duplicate_device_block,
      duplicate_ip_window_hours: parseInt(settings.duplicate_ip_window_hours),
      maintenance_mode: settings.maintenance_mode,
      signup_enabled: settings.signup_enabled,
    }).eq('id', 1);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Settings saved');
  };

  const toggleMethodEnabled = async (m: Method) => {
    const supabase = createClient();
    const { error } = await supabase.from('withdrawal_method_config').update({ enabled: !m.enabled }).eq('id', m.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.label} ${!m.enabled ? 'enabled' : 'disabled'}`);
    load();
  };

  const deleteMethod = async (id: number) => {
    if (!confirm('Delete this withdrawal method?')) return;
    const supabase = createClient();
    const { error } = await supabase.from('withdrawal_method_config').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Method deleted');
    load();
  };

  const saveMethod = async (m: Method) => {
    const supabase = createClient();
    const { error } = await supabase.from('withdrawal_method_config').update({
      label: m.label,
      icon: m.icon,
      min_amount: parseFloat(String(m.min_amount)),
      max_amount: parseFloat(String(m.max_amount)),
      fee_percentage: parseFloat(String(m.fee_percentage)),
      sort_order: m.sort_order,
      enabled: m.enabled,
    }).eq('id', m.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Method updated');
    setEditingMethod(null);
    load();
  };

  const addMethod = async () => {
    if (!newMethod.method || !newMethod.label) { toast.error('Method key and label are required'); return; }
    const supabase = createClient();
    const { error } = await supabase.from('withdrawal_method_config').insert({
      method: newMethod.method.toLowerCase().replace(/\s+/g, '_'),
      label: newMethod.label,
      icon: newMethod.icon,
      min_amount: parseFloat(String(newMethod.min_amount)),
      max_amount: parseFloat(String(newMethod.max_amount)),
      fee_percentage: parseFloat(String(newMethod.fee_percentage)),
      enabled: true,
      sort_order: methods.length + 1,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Method added');
    setNewMethod({ method: '', label: '', icon: 'ðŸ’³', min_amount: 1, max_amount: 10000, fee_percentage: 0 });
    load();
  };

  if (!settings) return <div className="p-6"><div className="skeleton h-96 rounded-2xl" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <h2 className="font-display text-2xl font-bold">Platform Settings</h2>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Brand</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Site Name</label>
            <input value={settings.site_name || ''} onChange={e => setSettings({ ...settings, site_name: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Support Email</label>
            <input value={settings.support_email || ''} onChange={e => setSettings({ ...settings, support_email: e.target.value })} className="input-field" />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Tagline</label>
          <input value={settings.site_tagline || ''} onChange={e => setSettings({ ...settings, site_tagline: e.target.value })} className="input-field" />
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Earnings & Payouts</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Minimum Withdrawal ($)</label>
            <input type="number" step="0.01" value={settings.min_withdrawal} onChange={e => setSettings({ ...settings, min_withdrawal: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Referral Commission (%)</label>
            <input type="number" step="0.1" value={settings.referral_percentage} onChange={e => setSettings({ ...settings, referral_percentage: e.target.value })} className="input-field" />
          </div>
        </div>
      </div>

      {/* Withdrawal Methods Management */}
      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Withdrawal Methods</h3>
          <span className="text-xs text-gray-500">{methods.filter(m => m.enabled).length} enabled</span>
        </div>
        <p className="text-xs text-gray-500">Users can only see and use enabled methods. Click a method to edit or toggle it on/off.</p>

        <div className="space-y-2">
          {methods.map(m => (
            <div key={m.id} className={`glass rounded-xl p-3 transition ${editingMethod?.id === m.id ? 'ring-2 ring-purple-500' : ''}`}>
              {editingMethod?.id === m.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 block">Icon</label>
                      <input value={editingMethod.icon} onChange={e => setEditingMethod({ ...editingMethod, icon: e.target.value })} className="input-field text-sm py-2" />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[10px] text-gray-500 block">Label</label>
                      <input value={editingMethod.label} onChange={e => setEditingMethod({ ...editingMethod, label: e.target.value })} className="input-field text-sm py-2" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Min Amount</label>
                      <input type="number" step="0.01" value={editingMethod.min_amount} onChange={e => setEditingMethod({ ...editingMethod, min_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Max Amount</label>
                      <input type="number" step="0.01" value={editingMethod.max_amount} onChange={e => setEditingMethod({ ...editingMethod, max_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Fee %</label>
                      <input type="number" step="0.1" value={editingMethod.fee_percentage} onChange={e => setEditingMethod({ ...editingMethod, fee_percentage: parseFloat(e.target.value) })} className="input-field text-sm py-2" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Sort Order</label>
                      <input type="number" value={editingMethod.sort_order} onChange={e => setEditingMethod({ ...editingMethod, sort_order: parseInt(e.target.value) })} className="input-field text-sm py-2" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveMethod(editingMethod)} className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button onClick={() => setEditingMethod(null)} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-2xl">{m.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{m.label}</div>
                      <div className="text-[10px] text-gray-500">
                        ${m.min_amount} - ${m.max_amount} Â· {m.fee_percentage}% fee Â· {m.method}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`badge ${m.enabled ? 'status-active' : 'status-rejected'} text-[10px]`}>
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button onClick={() => toggleMethodEnabled(m)} className={`p-1.5 rounded hover:bg-white/10 ${m.enabled ? 'text-yellow-400' : 'text-green-400'}`} title={m.enabled ? 'Disable' : 'Enable'}>
                      {m.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => setEditingMethod(m)} className="p-1.5 rounded hover:bg-white/10 text-blue-400" title="Edit">
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteMethod(m.id)} className="p-1.5 rounded hover:bg-white/10 text-red-400" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add new method */}
        <div className="border-t border-white/5 pt-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add New Method</h4>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input value={newMethod.icon} onChange={e => setNewMethod({ ...newMethod, icon: e.target.value })} className="input-field text-sm py-2" placeholder="Icon" />
            <input value={newMethod.method} onChange={e => setNewMethod({ ...newMethod, method: e.target.value })} className="input-field text-sm py-2" placeholder="Key (e.g. wise)" />
            <input value={newMethod.label} onChange={e => setNewMethod({ ...newMethod, label: e.target.value })} className="input-field text-sm py-2 col-span-2 sm:col-span-2" placeholder="Display label" />
            <input type="number" step="0.01" value={newMethod.min_amount} onChange={e => setNewMethod({ ...newMethod, min_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" placeholder="Min" />
            <input type="number" step="0.01" value={newMethod.max_amount} onChange={e => setNewMethod({ ...newMethod, max_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" placeholder="Max" />
          </div>
          <button onClick={addMethod} className="btn-primary mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Method
          </button>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Fraud Detection</h3>
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Sensitivity</label>
          <select value={settings.fraud_detection_sensitivity} onChange={e => setSettings({ ...settings, fraud_detection_sensitivity: e.target.value })} className="input-field">
            <option value="low">Low</option>
            <option value="medium">Medium (Recommended)</option>
            <option value="high">High</option>
            <option value="strict">Strict</option>
          </select>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { key: 'vpn_block_enabled', label: 'Block VPN/Proxy' },
            { key: 'duplicate_device_block', label: 'Block Duplicate Devices' },
            { key: 'maintenance_mode', label: 'Maintenance Mode' },
            { key: 'signup_enabled', label: 'Allow New Signups' },
            { key: 'site_announcement_active', label: 'Show Announcement' },
          ].map(s => (
            <label key={s.key} className="flex items-center justify-between p-3 glass rounded-xl cursor-pointer">
              <span className="text-sm">{s.label}</span>
              <div className={`toggle ${settings[s.key] ? 'on' : ''}`} onClick={() => setSettings({ ...settings, [s.key]: !settings[s.key] })} />
            </label>
          ))}
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Duplicate IP Window (hours)</label>
            <input type="number" value={settings.duplicate_ip_window_hours} onChange={e => setSettings({ ...settings, duplicate_ip_window_hours: e.target.value })} className="input-field" />
          </div>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Announcement</h3>
        <textarea rows={3} value={settings.site_announcement || ''} onChange={e => setSettings({ ...settings, site_announcement: e.target.value })} className="input-field" placeholder="ðŸŽ‰ Big news..." />
        <p className="text-xs text-gray-500">When active, this announcement is sent to all users as a notification.</p>
      </div>

      <button onClick={save} disabled={loading} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50">
        <Save className="w-4 h-4" /> {loading ? 'Saving...' : 'Save All Settings'}
      </button>
    </div>
  );
}