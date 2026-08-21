'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Loader2, FlaskConical, Zap, LayoutGrid, Timer, Clock3 } from 'lucide-react';
import { monetizationSaveSettings } from '@/lib/monetization/monetization-admin';

type SettingsShape = {
  flow_enabled?: boolean;
  task_page_ads_enabled?: boolean;
  progress_bar_enabled?: boolean;
  educational_content_enabled?: boolean;
  final_redirect_enabled?: boolean;
  test_mode?: boolean;
  steps_count?: number;
  default_countdown_seconds?: number;
  session_ttl_minutes?: number;
};

const DEFAULTS: SettingsShape = {
  flow_enabled: false,
  task_page_ads_enabled: false,
  progress_bar_enabled: true,
  educational_content_enabled: true,
  final_redirect_enabled: true,
  test_mode: false,
  steps_count: 4,
  default_countdown_seconds: 10,
  session_ttl_minutes: 30,
};

function Toggle({ label, description, checked, onChange, accent = false }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-full text-left p-4 rounded-xl border transition flex items-start gap-3 ${
        checked ? (accent ? 'bg-amber-500/10 border-amber-500/40' : 'bg-purple-500/10 border-purple-500/40') : 'glass border-white/10 hover:border-white/20'
      }`}
      aria-pressed={checked}
    >
      <span className={`relative inline-flex w-10 h-5.5 mt-0.5 flex-shrink-0 rounded-full transition ${checked ? (accent ? 'bg-amber-500' : 'bg-purple-500') : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</span>
      </span>
    </button>
  );
}

function NumberField({ label, description, value, min, max, onChange, icon: Icon }: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  icon: typeof Timer;
}) {
  return (
    <div className="glass rounded-xl p-4 border border-white/10">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-purple-300" />
        <span className="text-sm font-semibold text-white">{label}</span>
      </div>
      <p className="text-xs text-gray-400 mb-3">{description}</p>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(Math.max(Math.trunc(n), min), max));
        }}
        className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:border-purple-500/60 focus:outline-none"
      />
    </div>
  );
}

export default function SettingsClient({ initialSettings, initialError }: {
  initialSettings: Record<string, unknown> | null;
  initialError: string | null;
}) {
  const [settings, setSettings] = useState<SettingsShape>({ ...DEFAULTS, ...(initialSettings || {}) });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  const set = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const result = await monetizationSaveSettings(settings as Record<string, unknown>);
      if (result.ok) {
        toast.success('Monetization settings saved');
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Settings could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Master flow */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-1"><Zap className="w-4 h-4 text-purple-300" /> Monetization Flow</h2>
        <p className="text-xs text-gray-400 mb-4">When enabled, completing tasks starts the monetized shortener flow instead of redirecting directly to the destination.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Monetization Flow"
            description="Task completion → Step 1..N with ads and countdown → destination. When OFF, the visitor goes straight to the destination after unlocking."
            checked={settings.flow_enabled === true}
            onChange={v => set('flow_enabled', v)}
          />
          <Toggle
            label="Final Redirect"
            description="Automatically send the visitor to the destination after the last step. When OFF, the destination is revealed as a link instead."
            checked={settings.final_redirect_enabled === true}
            onChange={v => set('final_redirect_enabled', v)}
          />
          <Toggle
            label="Task Page Ads"
            description="Enable the ad slots configured for the task page (Ad management → Task Page)."
            checked={settings.task_page_ads_enabled === true}
            onChange={v => set('task_page_ads_enabled', v)}
          />
          <Toggle
            label="Progress Bar"
            description="Show the Step X of N progress bar on the flow pages."
            checked={settings.progress_bar_enabled === true}
            onChange={v => set('progress_bar_enabled', v)}
          />
          <Toggle
            label="Educational Content"
            description="Show the step content (articles, cards, timelines). When OFF, steps show only the title, ads and the countdown."
            checked={settings.educational_content_enabled === true}
            onChange={v => set('educational_content_enabled', v)}
          />
          <Toggle
            label="Test Mode"
            description="Replace all ads with labeled placeholders, generate no creator earnings and no qualified payout events. Use it to test the complete flow safely."
            checked={settings.test_mode === true}
            onChange={v => set('test_mode', v)}
            accent
          />
        </div>
      </section>

      {/* Flow shape */}
      <section className="glass-strong rounded-2xl p-5 sm:p-6 border border-white/5">
        <h2 className="flex items-center gap-2 font-semibold text-white mb-1"><LayoutGrid className="w-4 h-4 text-purple-300" /> Flow Shape</h2>
        <p className="text-xs text-gray-400 mb-4">The public flow reads these values live — changing them never requires a deployment. In-flight sessions finish on their existing step count safely.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Number of Steps"
            description="How many shortener steps the public flow uses (1–12). Set to 4 for the default flow."
            value={settings.steps_count ?? 4}
            min={1}
            max={12}
            onChange={v => set('steps_count', v)}
            icon={LayoutGrid}
          />
          <NumberField
            label="Default Countdown"
            description="Fallback countdown in seconds for steps that don't set their own (1–120)."
            value={settings.default_countdown_seconds ?? 10}
            min={1}
            max={120}
            onChange={v => set('default_countdown_seconds', v)}
            icon={Timer}
          />
          <NumberField
            label="Session Lifetime"
            description="How many minutes a visitor's flow session stays valid (5–240)."
            value={settings.session_ttl_minutes ?? 30}
            min={5}
            max={240}
            onChange={v => set('session_ttl_minutes', v)}
            icon={Clock3}
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save settings
        </button>
        {settings.test_mode && (
          <span className="flex items-center gap-1.5 text-xs text-amber-300"><FlaskConical className="w-4 h-4" /> Test mode is ON — no earnings are generated.</span>
        )}
      </div>
    </div>
  );
}
