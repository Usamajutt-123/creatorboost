'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { getClientIpFromHeaders } from '@/lib/request-ip';
import { validateCpmUpdate } from '@/lib/cpm';

export type UpdateCpmInput = {
  cpm: number;
  minCpm: number;
  maxCpm: number;
  reason?: string;
};

export type UpdateCpmResult =
  | { ok: true; cpm: number; minCpm: number; maxCpm: number; updatedAt: string }
  | { ok: false; error: string };

async function requireAdminSession(): Promise<{ id: string; role: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    return { error: 'Admin privileges required' };
  }
  return { id: user.id, role: profile.role };
}

export async function getCpmSettingsAction(): Promise<
  | { ok: true; settings: Record<string, unknown>; updatedByName: string | null }
  | { ok: false; error: string }
> {
  const admin = await requireAdminSession();
  if ('error' in admin) return { ok: false, error: admin.error };
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('cpm_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return { ok: false, error: 'CPM settings could not be loaded' };
  if (!data) return { ok: false, error: 'CPM settings are not configured' };
  let updatedByName: string | null = null;
  if (data.updated_by) {
    const { data: actor } = await supabase.from('profiles').select('full_name, email').eq('id', data.updated_by).maybeSingle();
    updatedByName = actor?.full_name || actor?.email || null;
  }
  return { ok: true, settings: data, updatedByName };
}

export async function getPublicCpmAction(): Promise<{ cpm: number } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('public_cpm').select('cpm').maybeSingle();
  if (error) {
    const admin = createAdminClient();
    const { data: row } = await admin.from('cpm_settings').select('cpm, is_active').eq('id', 1).maybeSingle();
    if (!row) return { error: 'CPM is unavailable' };
    return { cpm: Number(row.is_active ? row.cpm : 0) };
  }
  return { cpm: Number(data?.cpm ?? 0) };
}

export async function updateCpmAction(input: UpdateCpmInput): Promise<UpdateCpmResult> {
  const admin = await requireAdminSession();
  if ('error' in admin) return { ok: false, error: admin.error };

  const validated = validateCpmUpdate({
    cpm: input.cpm,
    minCpm: input.minCpm,
    maxCpm: input.maxCpm,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const reason = String(input.reason || '').trim().slice(0, 500);
  const supabase = createAdminClient();
  const { data: previous, error: loadError } = await supabase
    .from('cpm_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (loadError) return { ok: false, error: 'CPM settings could not be loaded' };

  const { data: updated, error } = await supabase
    .from('cpm_settings')
    .upsert({
      id: 1,
      cpm: validated.cpm,
      min_cpm: validated.minCpm,
      max_cpm: validated.maxCpm,
      is_active: true,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('*')
    .single();
  if (error || !updated) return { ok: false, error: error?.message || 'CPM could not be saved' };

  await supabase.from('cpm_change_log').insert({
    previous_cpm: previous?.cpm ?? null,
    new_cpm: validated.cpm,
    previous_min: previous?.min_cpm ?? null,
    new_min: validated.minCpm,
    previous_max: previous?.max_cpm ?? null,
    new_max: validated.maxCpm,
    admin_user_id: admin.id,
    action_type: 'cpm_changed',
    reason: reason || null,
  });

  try {
    let ip: string | null = null;
    try { ip = getClientIpFromHeaders(await headers()); } catch { /* ignore */ }
    await supabase.rpc('audit_action', {
      p_action: 'cpm_changed',
      p_entity_type: 'cpm_settings',
      p_entity_id: null,
      p_old_values: previous ? { cpm: previous.cpm, min_cpm: previous.min_cpm, max_cpm: previous.max_cpm } : null,
      p_new_values: { cpm: validated.cpm, min_cpm: validated.minCpm, max_cpm: validated.maxCpm, reason },
      p_ip: ip,
      p_actor_id: admin.id,
    });
  } catch (e) {
    console.error('[cpm] audit failed', e);
  }

  revalidatePath('/admin/cpm');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/analytics');

  return {
    ok: true,
    cpm: Number(updated.cpm),
    minCpm: Number(updated.min_cpm),
    maxCpm: Number(updated.max_cpm),
    updatedAt: updated.updated_at,
  };
}
