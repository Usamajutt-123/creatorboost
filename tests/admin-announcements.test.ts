import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const migration = readFileSync(join(root, 'supabase', 'migrations', '0011_admin_announcements.sql'), 'utf8');
const adminServer = readFileSync(join(root, 'src', 'lib', 'admin-server.ts'), 'utf8');
const composer = readFileSync(join(root, 'src', 'app', 'admin', 'announcements', 'page.tsx'), 'utf8');
const notifications = readFileSync(join(root, 'src', 'app', 'dashboard', 'notifications', 'NotificationsClient.tsx'), 'utf8');


describe('admin announcement system', () => {
  it('extends the existing announcements history and notifications tables', () => {
    expect(migration).toContain('ALTER TABLE public.announcements');
    expect(migration).toContain('recipient_count');
    expect(migration).toContain('sent_by');
    expect(migration).toContain('idempotency_key');
    expect(migration).toContain("'announcement'::notification_type");
    expect(migration).not.toContain('CREATE TABLE public.admin_notifications');
  });

  it('supports every requested creator audience without targeting admins', () => {
    for (const audience of ['all_creators', 'active_creators', 'suspended_creators', 'banned_creators', 'specific_creators']) {
      expect(migration).toContain(`'${audience}'`);
    }
    expect(migration).toContain("WHERE p.role = 'creator'");
    expect(migration).toContain("p.status = 'active'");
    expect(migration).toContain("p.status = 'suspended'");
    expect(migration).toContain("p.status = 'banned'");
  });

  it('protects delivery with server authorization, RLS-compatible grants, and idempotency', () => {
    expect(adminServer).toContain('await requireAdmin()');
    expect(adminServer).toContain("rpc('send_admin_announcement'");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("role IN ('admin', 'super_admin')");
    expect(migration).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(migration).toMatch(/REVOKE INSERT[\s\S]*ON TABLE public\.notifications FROM anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.send_admin_announcement/);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.send_admin_announcement');
  });

  it('wires the composer, history, metadata type labels, and mark-read behavior', () => {
    for (const text of ['Preview', 'Send Announcement', 'Announcement History', 'Recipient count']) {
      expect(composer).toContain(text);
    }
    expect(composer).toContain('adminGetAnnouncementRecipientCount');
    expect(composer).toContain('adminListAnnouncements');
    expect(notifications).toContain('metadata?.announcement_type');
    expect(notifications).toContain('onClick={() => { if (!n.read) markOne(n.id); }}');
  });
});
