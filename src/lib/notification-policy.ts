export const ADMIN_SENT_NOTIFICATION_TYPE = 'announcement' as const;

type NotificationLike = { type?: unknown };

/**
 * Admin/Super Admin announcements are the only in-app notifications exposed
 * to creators. Automatic campaign/system/financial events use other legacy
 * types and must never enter the creator notification feed.
 */
export function isAdminSentNotification(notification: NotificationLike): boolean {
  return notification.type === ADMIN_SENT_NOTIFICATION_TYPE;
}
