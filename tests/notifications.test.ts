import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUserAccessNotification } from '../src/lib/notifications';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('notification ownership', () => {
  it('lets a user access only their own notification', () => {
    expect(canUserAccessNotification('user-a', 'user-a')).toBe(true);
    expect(canUserAccessNotification('user-a', 'user-b')).toBe(false);
  });
});

const authGetUser = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: fromMock,
  })),
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: vi.fn() })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function updateChain(result: { data: unknown; error: unknown }) {
  const query: any = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

describe('mark notification as read', () => {
  afterEach(() => {
    vi.resetModules();
    authGetUser.mockReset();
    fromMock.mockReset();
  });

  it('marks the caller\'s own notification as read', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-a' } } });
    fromMock.mockReturnValue(updateChain({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }));
    const { markNotificationReadAction } = await import('@/lib/notification-actions');
    const res = await markNotificationReadAction('11111111-1111-4111-8111-111111111111');
    expect(res.ok).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('notifications');
  });

  it('does not succeed when the row belongs to another user (RLS / empty update)', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-b' } } });
    fromMock.mockReturnValue(updateChain({ data: null, error: null }));
    const { markNotificationReadAction } = await import('@/lib/notification-actions');
    const res = await markNotificationReadAction('11111111-1111-4111-8111-111111111111');
    expect(res.ok).toBe(false);
  });
});

describe('notification schema and event wiring', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0010_cpm_notifications.sql'), 'utf8');
  const withdraw = readFileSync(join(__dirname, '..', 'src', 'lib', 'withdraw-actions.ts'), 'utf8');
  const support = readFileSync(join(__dirname, '..', 'src', 'lib', 'support-actions.ts'), 'utf8');
  const campaigns = readFileSync(join(__dirname, '..', 'src', 'lib', 'campaign-actions.ts'), 'utf8');
  const slugPage = readFileSync(join(__dirname, '..', 'src', 'app', 'c', '[slug]', 'page.tsx'), 'utf8');

  it('creates withdrawal notifications in the request_withdrawal RPC', () => {
    expect(sql).toContain("VALUES (p_user_id, 'withdrawal', 'Withdrawal requested'");
    expect(sql).toContain('New withdrawal request');
    expect(withdraw).toContain('request_withdrawal');
  });

  it('creates support notifications for the creator and admins', () => {
    expect(support).toContain("title: 'Support ticket received'");
    expect(support).toContain('notifyAdmins');
    expect(sql).toContain('trg_support_ticket_notify');
  });

  it('creates campaign notifications on create/update/status', () => {
    expect(campaigns).toContain("title: 'Campaign created'");
    expect(campaigns).toContain("title: 'Campaign updated'");
    expect(campaigns).toContain('Campaign activated');
  });

  it('locks notification writes and allows users to mark only their own as read', () => {
    expect(sql).toContain('GRANT UPDATE (read) ON TABLE notifications TO authenticated');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
    expect(sql).not.toMatch(/GRANT INSERT ON TABLE notifications TO (anon|authenticated)/);
  });

  it('keeps /c/[slug] on Next.js 16 async params', () => {
    expect(slugPage).toContain('params: Promise<{ slug: string }>');
    expect(slugPage).toContain('await resolveParams(params)');
  });
});
