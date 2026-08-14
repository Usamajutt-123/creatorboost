'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Plus, Edit, Trash2, X, Check, Power, PowerOff, RefreshCw, Eye, PanelTop, MousePointerClick } from 'lucide-react';
import Select from '@/components/Select';
import { PlatformAdPreview } from '@/components/PlatformAdSlot';
import { resolvePlatformAdPlacement } from '@/lib/platform-ads';
import { adminLoadSettings, adminLoadWithdrawalMethods, adminSaveSettings, adminSaveWithdrawalMethod, adminAddWithdrawalMethod, adminDeleteWithdrawalMethod } from '@/lib/admin-server';

type Method = { id: number; method: string; label: string; icon: string; enabled: boolean; min_amount: number; max_amount: number; fee_percentage: number; sort_order: number };

export default function AdminSettingsClient({
  initialSettings,
  initialMethods,
  initialError,
}: {
  initialSettings: any;
  initialMethods: Method[];
  initialError: string | null;
}) {
  const [settings, setSettings] = useState<any>(initialSettings);
  const [methods, setMethods] = useState<Method[]>(initialMethods);
  const [loading, setLoading] = useState(false);
  const [editingMethod, setEditingMethod] = useState<Method | null>(null);
  const [newMethod, setNewMethod] = useState({ method: '', label: '', icon: '💳', min_amount: 1, max_amount: 10000, fee_percentage: 0 });
  const [previewPlacement, setPreviewPlacement] = useState<'banner' | 'popunder' | null>(null);

  useEffect(() => {
    if (!initialError) return;
    toast.error(initialError);
  }, [initialError]);

  const load = async () => {
    try {
      const [s, m] = await Promise.all([adminLoadSettings(), adminLoadWithdrawalMethods()]);
      setSettings(s);
      setMethods(m as Method[]);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load settings');
    }
  };

  const save = async () => {
    setLoading(true);
    try {
      await adminSaveSettings({
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
        max_earnings_per_view: parseFloat(settings.max_earnings_per_view ?? 1),
        max_views_per_device_per_day: parseInt(settings.max_views_per_device_per_day ?? 20),
        max_views_per_ip_per_day: parseInt(settings.max_views_per_ip_per_day ?? 200),
        creator_daily_earning_cap: parseFloat(settings.creator_daily_earning_cap ?? 500),
        campaign_daily_earning_cap: parseFloat(settings.campaign_daily_earning_cap ?? 200),
        platform_daily_earning_cap: parseFloat(settings.platform_daily_earning_cap ?? 10000),
        earning_holding_hours: parseInt(settings.earning_holding_hours ?? 24),
        banner_enabled: Boolean(settings.banner_enabled),
        banner_code: settings.banner_code || '',
        banner_url: settings.banner_url || '',
        popunder_enabled: Boolean(settings.popunder_enabled),
        popunder_code: settings.popunder_code || '',
        popunder_url: settings.popunder_url || '',
      });
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const saveMethod = async (m: Method) => {
    try {
      await adminSaveWithdrawalMethod(m.id, { label: m.label, icon: m.icon, min_amount: parseFloat(String(m.min_amount)), max_amount: parseFloat(String(m.max_amount)), fee_percentage: parseFloat(String(m.fee_percentage)), sort_order: m.sort_order, enabled: m.enabled });
      toast.success('Method updated');
      setEditingMethod(null);
      load();
    } catch (e: any) { toast.error(e.message || 'Save failed'); }
  };

  const addMethod = async () => {
    if (!newMethod.method || !newMethod.label) { toast.error('Method key and label are required'); return; }
    try {
      await adminAddWithdrawalMethod({ method: newMethod.method.toLowerCase().replace(/\s+/g, '_'), label: newMethod.label, icon: newMethod.icon, min_amount: parseFloat(String(newMethod.min_amount)), max_amount: parseFloat(String(newMethod.max_amount)), fee_percentage: parseFloat(String(newMethod.fee_percentage)), enabled: true, sort_order: methods.length + 1 });
      toast.success('Method added');
      setNewMethod({ method: '', label: '', icon: '💳', min_amount: 1, max_amount: 10000, fee_percentage: 0 });
      load();
    } catch (e: any) { toast.error(e.message || 'Add failed'); }
  };

  const deleteMethod = async (id: number) => {
    if (!confirm('Delete this withdrawal method?')) return;
    try { await adminDeleteWithdrawalMethod(id); toast.success('Method deleted'); load(); }
    catch (e: any) { toast.error(e.message || 'Delete failed'); }
  };

  if (!settings) return <div className="p-6"><div className="skeleton h-96 rounded-2xl" /></div>;

  // Preview works against the current draft, while public pages only receive
  // the server-resolved setting after an authorized save.
  const bannerPreview = resolvePlatformAdPlacement({ code: settings.banner_code, url: settings.banner_url });
  const popunderPreview = resolvePlatformAdPlacement({ code: settings.popunder_code, url: settings.popunder_url });

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">Platform Settings</h2>
        <button onClick={() => { setLoading(true); load(); }} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Brand</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="text-xs text-gray-400 block mb-1.5">Site Name</label><input value={settings.site_name || ''} onChange={e => setSettings({ ...settings, site_name: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Support Email</label><input value={settings.support_email || ''} onChange={e => setSettings({ ...settings, support_email: e.target.value })} className="input-field" /></div>
        </div>
        <div><label className="text-xs text-gray-400 block mb-1.5">Tagline</label><input value={settings.site_tagline || ''} onChange={e => setSettings({ ...settings, site_tagline: e.target.value })} className="input-field" /></div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Earnings & Payouts</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><label className="text-xs text-gray-400 block mb-1.5">Minimum Withdrawal ($)</label><input type="number" step="0.01" value={settings.min_withdrawal} onChange={e => setSettings({ ...settings, min_withdrawal: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Referral Commission (%)</label><input type="number" step="0.1" value={settings.referral_percentage} onChange={e => setSettings({ ...settings, referral_percentage: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Earning Holding Period (hours)</label><input type="number" value={settings.earning_holding_hours ?? 24} onChange={e => setSettings({ ...settings, earning_holding_hours: e.target.value })} className="input-field" /></div>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Earnings Caps (server-enforced)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div><label className="text-xs text-gray-400 block mb-1.5">Max earnings per view ($)</label><input type="number" step="0.0001" value={settings.max_earnings_per_view ?? 1} onChange={e => setSettings({ ...settings, max_earnings_per_view: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Views / device / day</label><input type="number" value={settings.max_views_per_device_per_day ?? 20} onChange={e => setSettings({ ...settings, max_views_per_device_per_day: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Views / IP / day</label><input type="number" value={settings.max_views_per_ip_per_day ?? 200} onChange={e => setSettings({ ...settings, max_views_per_ip_per_day: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Creator daily cap ($)</label><input type="number" step="0.01" value={settings.creator_daily_earning_cap ?? 500} onChange={e => setSettings({ ...settings, creator_daily_earning_cap: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Campaign daily cap ($)</label><input type="number" step="0.01" value={settings.campaign_daily_earning_cap ?? 200} onChange={e => setSettings({ ...settings, campaign_daily_earning_cap: e.target.value })} className="input-field" /></div>
          <div><label className="text-xs text-gray-400 block mb-1.5">Platform daily cap ($)</label><input type="number" step="0.01" value={settings.platform_daily_earning_cap ?? 10000} onChange={e => setSettings({ ...settings, platform_daily_earning_cap: e.target.value })} className="input-field" /></div>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Withdrawal Methods</h3>
          <span className="text-xs text-gray-500">{methods.filter(m => m.enabled).length} enabled</span>
        </div>
        <div className="space-y-2">
          {methods.map(m => (
            <div key={m.id} className={`glass rounded-xl p-3 transition ${editingMethod?.id === m.id ? 'ring-2 ring-purple-500' : ''}`}>
              {editingMethod?.id === m.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div><label className="text-[10px] text-gray-500 block">Icon</label><input value={editingMethod.icon} onChange={e => setEditingMethod({ ...editingMethod, icon: e.target.value })} className="input-field text-sm py-2" /></div>
                    <div className="col-span-3"><label className="text-[10px] text-gray-500 block">Label</label><input value={editingMethod.label} onChange={e => setEditingMethod({ ...editingMethod, label: e.target.value })} className="input-field text-sm py-2" /></div>
                    <div><label className="text-[10px] text-gray-500 block">Min</label><input type="number" step="0.01" value={editingMethod.min_amount} onChange={e => setEditingMethod({ ...editingMethod, min_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" /></div>
                    <div><label className="text-[10px] text-gray-500 block">Max</label><input type="number" step="0.01" value={editingMethod.max_amount} onChange={e => setEditingMethod({ ...editingMethod, max_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" /></div>
                    <div><label className="text-[10px] text-gray-500 block">Fee %</label><input type="number" step="0.1" value={editingMethod.fee_percentage} onChange={e => setEditingMethod({ ...editingMethod, fee_percentage: parseFloat(e.target.value) })} className="input-field text-sm py-2" /></div>
                    <div><label className="text-[10px] text-gray-500 block">Enabled</label><label className="flex items-center pt-2"><input type="checkbox" checked={!!editingMethod.enabled} onChange={e => setEditingMethod({ ...editingMethod, enabled: e.target.checked })} /></label></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveMethod(editingMethod)} className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Save</button>
                    <button onClick={() => setEditingMethod(null)} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-2xl">{m.icon}</span>
                    <div className="min-w-0"><div className="font-medium text-sm">{m.label}</div><div className="text-[10px] text-gray-500">${m.min_amount} - ${m.max_amount} · {m.fee_percentage}% fee · {m.method}</div></div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`badge ${m.enabled ? 'status-active' : 'status-rejected'} text-[10px]`}>{m.enabled ? 'Enabled' : 'Disabled'}</span>
                    <button onClick={() => saveMethod({ ...m, enabled: !m.enabled })} className="p-1.5 rounded hover:bg-white/10">{m.enabled ? <PowerOff className="w-3.5 h-3.5 text-yellow-400" /> : <Power className="w-3.5 h-3.5 text-green-400" />}</button>
                    <button onClick={() => setEditingMethod(m)} className="p-1.5 rounded hover:bg-white/10 text-blue-400"><Edit className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteMethod(m.id)} className="p-1.5 rounded hover:bg-white/10 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 pt-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add New Method</h4>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input value={newMethod.icon} onChange={e => setNewMethod({ ...newMethod, icon: e.target.value })} className="input-field text-sm py-2" placeholder="Icon" />
            <input value={newMethod.method} onChange={e => setNewMethod({ ...newMethod, method: e.target.value })} className="input-field text-sm py-2" placeholder="Key (e.g. wise)" />
            <input value={newMethod.label} onChange={e => setNewMethod({ ...newMethod, label: e.target.value })} className="input-field text-sm py-2 col-span-2" placeholder="Display label" />
            <input type="number" step="0.01" value={newMethod.min_amount} onChange={e => setNewMethod({ ...newMethod, min_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" placeholder="Min" />
            <input type="number" step="0.01" value={newMethod.max_amount} onChange={e => setNewMethod({ ...newMethod, max_amount: parseFloat(e.target.value) })} className="input-field text-sm py-2" placeholder="Max" />
          </div>
          <button onClick={addMethod} className="btn-primary mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Method</button>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><PanelTop className="w-4 h-4 text-purple-300" /> Unlock Page Ads</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">Platform-level placements shown only on public campaign unlock pages. Creators cannot configure or override these settings through campaign data.</p>
          </div>
          <span className="badge bg-purple-500/10 text-purple-200 border border-purple-500/25 w-fit">Admin / Super Admin only</span>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/10 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-purple-500/15 p-2"><PanelTop className="w-4 h-4 text-purple-300" /></span>
              <div><h4 className="text-sm font-semibold">Banner ad</h4><p className="mt-0.5 text-xs text-gray-500">A responsive, labeled ad box below the normal unlock/tasks card.</p></div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings.banner_enabled)}
              aria-label="Enable banner ad"
              onClick={() => setSettings({ ...settings, banner_enabled: !settings.banner_enabled })}
              className={`toggle border-0 p-0 flex-shrink-0 ${settings.banner_enabled ? 'on' : ''}`}
            ><span className="sr-only">Enable banner ad</span></button>
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            <label className="text-xs text-gray-400 block">Banner ad code
              <textarea rows={5} value={settings.banner_code || ''} onChange={e => setSettings({ ...settings, banner_code: e.target.value })} className="input-field mt-1.5 font-mono text-xs leading-relaxed" placeholder={'<script src="https://ad-network.example/banner.js"></script>'} maxLength={5000} spellCheck={false} />
            </label>
            <label className="text-xs text-gray-400 block">Banner ad URL <span className="text-gray-600">(optional fallback)</span>
              <input type="url" value={settings.banner_url || ''} onChange={e => setSettings({ ...settings, banner_url: e.target.value })} className="input-field mt-1.5" placeholder="https://ads.example/placement" maxLength={2000} inputMode="url" />
              <span className="mt-1 block text-[11px] leading-relaxed text-gray-600">Use a hosted ad URL when no ad code is required. If both are supplied, code takes priority.</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreviewPlacement(previewPlacement === 'banner' ? null : 'banner')} disabled={!bannerPreview} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"><Eye className="w-3.5 h-3.5" /> {previewPlacement === 'banner' ? 'Hide banner preview' : 'Preview banner'}</button>
            <span className={`text-[11px] ${settings.banner_enabled && bannerPreview ? 'text-green-400' : 'text-gray-500'}`}>{settings.banner_enabled && bannerPreview ? 'Ready for the unlock page after save.' : 'Disabled or awaiting valid code/URL — no public box will render.'}</span>
          </div>
          {previewPlacement === 'banner' && <PlatformAdPreview ad={bannerPreview} placement="banner" />}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/10 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-blue-500/15 p-2"><MousePointerClick className="w-4 h-4 text-blue-300" /></span>
              <div><h4 className="text-sm font-semibold">Popunder</h4><p className="mt-0.5 text-xs text-gray-500">Runs once when a visitor starts their first configured task; it never changes task or unlock behavior.</p></div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings.popunder_enabled)}
              aria-label="Enable popunder"
              onClick={() => setSettings({ ...settings, popunder_enabled: !settings.popunder_enabled })}
              className={`toggle border-0 p-0 flex-shrink-0 ${settings.popunder_enabled ? 'on' : ''}`}
            ><span className="sr-only">Enable popunder</span></button>
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            <label className="text-xs text-gray-400 block">Popunder code
              <textarea rows={5} value={settings.popunder_code || ''} onChange={e => setSettings({ ...settings, popunder_code: e.target.value })} className="input-field mt-1.5 font-mono text-xs leading-relaxed" placeholder={'<script src="https://ad-network.example/popunder.js"></script>'} maxLength={5000} spellCheck={false} />
            </label>
            <label className="text-xs text-gray-400 block">Popunder URL <span className="text-gray-600">(optional fallback)</span>
              <input type="url" value={settings.popunder_url || ''} onChange={e => setSettings({ ...settings, popunder_url: e.target.value })} className="input-field mt-1.5" placeholder="https://ads.example/popunder" maxLength={2000} inputMode="url" />
              <span className="mt-1 block text-[11px] leading-relaxed text-gray-600">A URL opens from the visitor&apos;s first task click when no code is supplied. If both are supplied, code takes priority.</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreviewPlacement(previewPlacement === 'popunder' ? null : 'popunder')} disabled={!popunderPreview} className="btn-ghost px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"><Eye className="w-3.5 h-3.5" /> {previewPlacement === 'popunder' ? 'Hide popunder preview' : 'Preview popunder'}</button>
            <span className={`text-[11px] ${settings.popunder_enabled && popunderPreview ? 'text-green-400' : 'text-gray-500'}`}>{settings.popunder_enabled && popunderPreview ? 'Ready for the unlock page after save.' : 'Disabled or awaiting valid code/URL — no visitor popunder will run.'}</span>
          </div>
          {previewPlacement === 'popunder' && <PlatformAdPreview ad={popunderPreview} placement="popunder" />}
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Fraud Detection</h3>
        <div><label className="text-xs text-gray-400 block mb-1.5">Sensitivity</label>
          <Select value={settings.fraud_detection_sensitivity} onChange={value => setSettings({ ...settings, fraud_detection_sensitivity: value })} ariaLabel="Sensitivity" options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium (Recommended)' },
            { value: 'high', label: 'High' },
            { value: 'strict', label: 'Strict' },
          ]} />
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
          <div><label className="text-xs text-gray-400 block mb-1.5">Duplicate IP Window (hours)</label><input type="number" value={settings.duplicate_ip_window_hours} onChange={e => setSettings({ ...settings, duplicate_ip_window_hours: e.target.value })} className="input-field" /></div>
        </div>
      </div>

      <div className="glass-strong rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Announcement</h3>
        <textarea rows={3} value={settings.site_announcement || ''} onChange={e => setSettings({ ...settings, site_announcement: e.target.value })} className="input-field" placeholder="🎉 Big news..." />
      </div>

      <button onClick={save} disabled={loading} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50">
        <Save className="w-4 h-4" /> {loading ? 'Saving...' : 'Save All Settings'}
      </button>
    </div>
  );
}
