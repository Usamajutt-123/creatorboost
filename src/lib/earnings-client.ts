/**
 * Client-side helper to record views.
 * The actual fraud detection and earnings calculation
 * happen on the server (see /api/views/record).
 */
export async function recordView(data: {
  campaignId: string;
  creatorId: string;
  countryCode?: string;
  deviceFingerprint?: string;
  userAgent?: string;
  tasksCompleted?: any[];
}) {
  const res = await fetch('/api/views/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('View recording failed');
  return res.json();
}
