import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  role: 'admin',
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
  getDashboardProfile: vi.fn(async () => ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    full_name: 'Admin User',
    email: 'admin@example.com',
    role: state.role,
    status: 'active',
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
  createAdminClient: vi.fn(() => ({ rpc: state.rpc })),
}));

vi.mock('next/cache', () => ({ revalidatePath: state.revalidatePath }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const root = join(__dirname, '..');
const announcementMigration = readFileSync(
  join(root, 'supabase', 'migrations', '0011_admin_announcements.sql'),
  'utf8',
);
const manualOnlyMigration = readFileSync(
  join(root, 'supabase', 'migrations', '0018_manual_admin_notifications_only.sql'),
  'utf8',
);

const payload = {
  title: 'Important Update',
  message: 'Your account has been reviewed successfully.',
  type: 'important',
  audience: 'specific_creators',
  recipientIds: ['11111111-1111-4111-8111-111111111111'],
  idempotencyKey: 'manual-notification-test-key-0001',
};

function successfulRpc(name: string) {
  if (name === 'send_admin_announcement') {
    return Promise.resolve({
      data: {
        ok: true,
        duplicate: false,
        announcement_id: '22222222-2222-4222-8222-222222222222',
        recipient_count: 1,
        status: 'sent',
      },
      error: null,
    });
  }
  return Promise.resolve({ data: null, error: null });
}

describe('manual Admin/Super Admin notification delivery', () => {
  afterEach(() => {
    state.role = 'admin';
    state.rpc.mockReset();
    state.revalidatePath.mockReset();
  });

  it('allows an Admin to manually send a notification to a selected creator', async () => {
    state.role = 'admin';
    state.rpc.mockImplementation(successfulRpc);
    const { adminSendAnnouncement } = await import('@/lib/admin-server');

    await expect(adminSendAnnouncement(payload)).resolves.toMatchObject({
      ok: true,
      duplicate: false,
      recipientCount: 1,
    });
    expect(state.rpc).toHaveBeenCalledWith('send_admin_announcement', expect.objectContaining({
      p_admin_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_title: payload.title,
      p_message: payload.message,
      p_recipient_ids: payload.recipientIds,
    }));
  });

  it('allows a Super Admin to manually send the same kind of notification', async () => {
    state.role = 'super_admin';
    state.rpc.mockImplementation(successfulRpc);
    const { adminSendAnnouncement } = await import('@/lib/admin-server');

    await expect(adminSendAnnouncement({
      ...payload,
      idempotencyKey: 'manual-notification-test-key-0002',
    })).resolves.toMatchObject({ ok: true, recipientCount: 1 });
    expect(state.rpc).toHaveBeenCalledWith('send_admin_announcement', expect.objectContaining({
      p_admin_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_recipient_ids: payload.recipientIds,
    }));
  });

  it('rejects a creator before any notification delivery RPC is called', async () => {
    state.role = 'creator';
    state.rpc.mockImplementation(successfulRpc);
    const { adminSendAnnouncement } = await import('@/lib/admin-server');

    await expect(adminSendAnnouncement(payload)).rejects.toThrow('Admin privileges required');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('stores one normal notification row for each selected creator', () => {
    expect(announcementMigration).toContain('INSERT INTO public.notifications');
    expect(announcementMigration).toContain("'announcement'::notification_type");
    expect(announcementMigration).toContain("WHERE p.role = 'creator'");
    expect(announcementMigration).toContain("p_audience = 'specific_creators' AND p.id = ANY(v_recipient_ids)");
    expect(manualOnlyMigration).toContain("recipient.role = 'creator'");
    expect(manualOnlyMigration).toContain("sender.role IN ('admin', 'super_admin')");
  });

  it('keeps idempotency protection so retries do not create duplicates', () => {
    expect(announcementMigration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_idempotency_key');
    expect(announcementMigration).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(announcementMigration).toContain("'duplicate', TRUE");
  });
});
