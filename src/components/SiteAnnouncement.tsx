import { Megaphone } from 'lucide-react';
import { getOperationalSettings } from '@/lib/operational-settings';

/**
 * Platform-wide announcement banner.
 *
 * `site_announcement` / `site_announcement_active` were editable in the admin
 * Settings screen but were never rendered anywhere, so switching "Show
 * Announcement" on did nothing. This server component makes the toggle real.
 *
 * It renders nothing at all when the announcement is off or empty, so no
 * existing page layout shifts unless an operator deliberately enables it.
 * The text is rendered as TEXT (React escapes it) — never as HTML — so an
 * announcement cannot inject markup or script into every page.
 */
export default async function SiteAnnouncement() {
  const { announcement, announcementActive } = await getOperationalSettings();
  if (!announcementActive || !announcement) return null;

  return (
    <div
      role="status"
      className="w-full bg-gradient-to-r from-purple-600/25 to-blue-600/25 border-b border-purple-500/30 px-4 py-2"
    >
      <p className="mx-auto flex max-w-5xl items-center justify-center gap-2 text-center text-xs text-purple-100 sm:text-sm">
        <Megaphone className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>{announcement.slice(0, 300)}</span>
      </p>
    </div>
  );
}
