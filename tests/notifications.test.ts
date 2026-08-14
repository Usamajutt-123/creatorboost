import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canUserAccessNotification } from '@/lib/notifications';
import {
  ADMIN_SENT_NOTIFICATION_TYPE,
  isAdminSentNotification,
} from '@/lib/notification-policy';

const root = join(__dirname, '..');
const manualOnlyMigration = readFileSync(
  join(root, 'supabase', 'migrations', '0018_manual_admin_notifications_only.sql'),
  'utf8',
);
const campaignActionsSource = readFileSync(join(root, 'src', 'lib', 'campaign-actions.ts'), 'utf8');
const supportActionsSource = readFileSync(join(root, 'src', 'lib', 'support-actions.ts'), 'utf8');
const notificationPageSource = readFileSync(
  join(root, 'src', 'app', 'dashboard', 'notifications', 'page.tsx'),
  'utf8',
);
const notificationClientSource = readFileSync(
  join(root, 'src', 'app', 'dashboard', 'notifications', 'NotificationsClient.tsx'),
  'utf8',
);
const notificationActionsSource = readFileSync(join(root, 'src', 'lib', 'notification-actions.ts'), 'utf8');
const notificationCountSource = readFileSync(join(root, 'src', 'lib', 'notifications.ts'), 'utf8');

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

describe('manual admin notification policy', () => {
  it('lets a user access only their own notification', () => {
    expect(canUserAccessNotification('user-a', 'user-a')).toBe(true);
    expect(canUserAccessNotification('user-a', 'user-b')).toBe(false);
  });

  it('recognizes only Admin/Super Admin announcement rows as feed items', () => {
    expect(isAdminSentNotification({ type: ADMIN_SENT_NOTIFICATION_TYPE })).toBe(true);
    for (const type of ['campaign', 'earning', 'withdrawal', 'referral', 'system']) {
      expect(isAdminSentNotification({ type })).toBe(false);
    }
  });

  it('blocks every future automatic notification INSERT at the database boundary', () => {
    expect(manualOnlyMigration).toContain('CREATE TRIGGER trg_notifications_manual_admin_only');
    expect(manualOnlyMigration).toContain("NEW.type IS DISTINCT FROM 'announcement'::notification_type");
    expect(manualOnlyMigration).toContain('RETURN NULL;');
    expect(manualOnlyMigration).toContain("sender.role IN ('admin', 'super_admin')");
    expect(manualOnlyMigration).toContain("recipient.role = 'creator'");
    expect(manualOnlyMigration).toContain("NEW.link = '/dashboard/notifications'");
  });

  it('disables generic automatic helpers and the support-ticket trigger', () => {
    const createHelper = manualOnlyMigration.match(
      /CREATE OR REPLACE FUNCTION public\.create_notification[\s\S]*?\$\$;/,
    )?.[0];
    const notifyAdminsHelper = manualOnlyMigration.match(
      /CREATE OR REPLACE FUNCTION public\.notify_admins[\s\S]*?\$\$;/,
    )?.[0];
    expect(createHelper).toContain('RETURN NULL;');
    expect(createHelper).not.toContain('INSERT INTO');
    expect(notifyAdminsHelper).toContain('RETURN 0;');
    expect(notifyAdminsHelper).not.toContain('INSERT INTO');
    expect(manualOnlyMigration).toContain(
      'DROP TRIGGER IF EXISTS trg_support_ticket_notify ON public.support_tickets',
    );
    expect(supportActionsSource).not.toMatch(/createNotification|notifyAdmins|from\(['"]notifications['"]\)/);
  });

  it('preserves all existing notification and admin announcement history', () => {
    expect(manualOnlyMigration).not.toMatch(/DELETE\s+FROM\s+public\.notifications/i);
    expect(manualOnlyMigration).not.toMatch(/TRUNCATE\s+(TABLE\s+)?public\.notifications/i);
    expect(manualOnlyMigration).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public\.notifications/i);
    expect(manualOnlyMigration).not.toMatch(/DELETE\s+FROM\s+public\.announcements/i);
  });

  it('keeps creators unable to create or delete notification rows', () => {
    expect(manualOnlyMigration).toMatch(
      /REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*ON TABLE public\.notifications FROM anon, authenticated/,
    );
    expect(manualOnlyMigration).toContain('GRANT UPDATE (read) ON TABLE public.notifications TO authenticated');
    expect(manualOnlyMigration).not.toMatch(/GRANT INSERT ON TABLE public\.notifications TO (anon|authenticated)/);
  });
});

describe('campaign actions create no notifications', () => {
  afterEach(() => {
    authGetUser.mockReset();
    fromMock.mockReset();
  });

  function installCampaignDatabaseMock() {
    authGetUser.mockResolvedValue({ data: { user: { id: 'creator-a' } } });
    fromMock.mockImplementation((table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        is: vi.fn(() => query),
        insert: vi.fn(() => query),
        update: vi.fn(() => query),
        single: vi.fn(async () => (
          table === 'campaigns'
            ? { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }
            : { data: null, error: null }
        )),
        maybeSingle: vi.fn(async () => (
          table === 'profiles'
            ? { data: { id: 'creator-a', status: 'active' }, error: null }
            : { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }
        )),
      };
      return query;
    });
  }

  const input = {
    name: 'No notification campaign',
    description: 'Campaign mutations must not grow notification storage.',
    category: 'website_traffic' as const,
    destinationUrl: 'https://example.com/destination',
    status: 'active' as const,
    expiresAt: '',
    tasks: [{ id: 'website_visit' as const, title: '', url: 'https://example.com/task' }],
  };

  it('does not write a notification on campaign create or update', async () => {
    installCampaignDatabaseMock();
    const { createCampaignAction, updateCampaignAction } = await import('@/lib/campaign-actions');

    await expect(createCampaignAction(input)).resolves.toEqual({
      success: true,
      id: '11111111-1111-4111-8111-111111111111',
    });
    await expect(updateCampaignAction('11111111-1111-4111-8111-111111111111', input)).resolves.toEqual({
      success: true,
      id: '11111111-1111-4111-8111-111111111111',
    });

    expect(fromMock).not.toHaveBeenCalledWith('notifications');
    expect(campaignActionsSource).not.toMatch(/createNotification|sendNotification|from\(['"]notifications['"]\)/);
  });

  it('does not write a notification on publish, pause, resume, or status change', async () => {
    installCampaignDatabaseMock();
    const { setCampaignStatusAction } = await import('@/lib/campaign-actions');

    await expect(setCampaignStatusAction('11111111-1111-4111-8111-111111111111', 'active'))
      .resolves.toEqual({ success: true });
    await expect(setCampaignStatusAction('11111111-1111-4111-8111-111111111111', 'paused'))
      .resolves.toEqual({ success: true });

    expect(fromMock).not.toHaveBeenCalledWith('notifications');
    expect(campaignActionsSource).not.toMatch(/Campaign (activated|paused)|notification/i);
  });

  it('does not write a notification on campaign delete, and expiry has no notification path', async () => {
    installCampaignDatabaseMock();
    const { deleteCampaignAction } = await import('@/lib/campaign-actions');

    await expect(deleteCampaignAction('11111111-1111-4111-8111-111111111111'))
      .resolves.toEqual({ success: true });

    expect(fromMock).not.toHaveBeenCalledWith('notifications');
    expect(campaignActionsSource).not.toMatch(/campaign_expired|Campaign expired|createNotification|sendNotification/);
    // Defense in depth: even a legacy SQL writer using the campaign type is discarded.
    expect(manualOnlyMigration).toContain("NEW.type IS DISTINCT FROM 'announcement'::notification_type");
  });
});

describe('creator notification feed and read state', () => {
  afterEach(() => {
    authGetUser.mockReset();
    fromMock.mockReset();
  });

  it('queries, counts, and renders only admin-sent notifications', () => {
    expect(notificationPageSource.match(/\.eq\('type', ADMIN_SENT_NOTIFICATION_TYPE\)/g)).toHaveLength(2);
    expect(notificationActionsSource.match(/\.eq\('type', ADMIN_SENT_NOTIFICATION_TYPE\)/g)).toHaveLength(3);
    expect(notificationCountSource).toContain(".eq('type', ADMIN_SENT_NOTIFICATION_TYPE)");
    expect(notificationClientSource).toContain('initial.filter(isAdminSentNotification)');
  });

  it('preserves mark-one read behavior for an admin notification', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-a' } } });
    const query = updateChain({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null });
    fromMock.mockReturnValue(query);
    const { markNotificationReadAction } = await import('@/lib/notification-actions');

    await expect(markNotificationReadAction('11111111-1111-4111-8111-111111111111'))
      .resolves.toEqual({ ok: true });
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(query.eq).toHaveBeenCalledWith('type', ADMIN_SENT_NOTIFICATION_TYPE);
  });

  it('does not let a user mark another user\'s notification as read', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-b' } } });
    fromMock.mockReturnValue(updateChain({ data: null, error: null }));
    const { markNotificationReadAction } = await import('@/lib/notification-actions');

    await expect(markNotificationReadAction('11111111-1111-4111-8111-111111111111'))
      .resolves.toEqual({ ok: false, error: 'Notification not found' });
  });
});
