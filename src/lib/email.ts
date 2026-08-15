/**
 * CreatorBoost transactional email.
 *
 * Provider: Resend (https://resend.com) — API key is server-side only.
 *
 *   RESEND_API_KEY   required to actually send.
 *   EMAIL_FROM       sender address, e.g. "CreatorBoost <no-reply@yourdomain.com>"
 *   SUPPORT_EMAIL    support address shown in emails / used for notifications.
 *   NEXT_PUBLIC_SITE_URL  base URL for links inside emails.
 *
 * Design rules:
 *  - Never expose the API key (or any provider error) to the browser.
 *  - Graceful failure: if the provider is not configured or the call fails,
 *    we log server-side and return `{ sent: false, reason }` — the caller
 *    decides how to degrade (never crash a money movement).
 *  - `sendEmail` accepts a plain template name + data, so call sites stay
 *    provider-agnostic.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  sent: boolean;
  reason?: 'not_configured' | 'invalid_recipient' | 'provider_error' | 'disabled';
}

export type EmailTemplate =
  | 'welcome'
  | 'withdrawal_requested'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'withdrawal_paid'
  | 'account_suspended'
  | 'account_banned'
  | 'support_confirmation';

type TemplateData = Record<string, string | number>;

export function isConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://creatorboost.io').replace(/\/$/, '');
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || 'CreatorBoost <no-reply@creatorboost.io>';
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build subject + HTML body for a template. Pure, unit-testable.
 *
 * ESCAPING RULE: every interpolated value in the HTML below must be escaped.
 *   * `d[...]` — caller-supplied data (names, messages, ticket ids, rejection
 *     reasons, transaction ids). Escaped once, up front, in the loop below.
 *   * `s` and `support` — environment-derived, escaped here too. They are
 *     operator-controlled rather than user-controlled, but an unescaped quote
 *     in EMAIL_FROM/SUPPORT_EMAIL/NEXT_PUBLIC_SITE_URL would still break out
 *     of the surrounding `href="..."` attribute, so they get the same
 *     treatment rather than relying on the operator to be careful.
 *
 * Subjects and the plain-text alternative body are NOT an HTML context, so
 * they use the RAW values (`r[...]`). Escaping them would surface literal
 * `&amp;` / `&#39;` in the user's inbox — an appearance regression, not a
 * security win. Only the `html` field needs escaping.
 */
export function renderTemplate(template: EmailTemplate, data: TemplateData): { subject: string; html: string; text: string } {
  const s = escapeHtml(siteUrl());
  const support = escapeHtml(process.env.SUPPORT_EMAIL || 'support@creatorboost.io');
  // `d` = HTML-escaped (used only inside the `html` field).
  // `r` = raw (used only in `subject` / `text`, which are not HTML).
  const d: Record<string, string> = {};
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    r[k] = String(v);
    d[k] = escapeHtml(v);
  }

  // `title` is always a literal below, but escaping it keeps the helper safe
  // if a future caller ever passes user input.
  const layout = (rawTitle: string, bodyHtml: string): string => `
    <div style="font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0a0716;color:#e2e8f0;border-radius:16px">
      <div style="font-size:20px;font-weight:700;margin-bottom:16px">Creator<span style="color:#a78bfa">Boost</span></div>
      <h1 style="font-size:18px;margin:0 0 12px;color:#ffffff">${escapeHtml(rawTitle)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#cbd5e1">${bodyHtml}</div>
      <p style="font-size:12px;color:#64748b;margin-top:24px;border-top:1px solid #1e293b;padding-top:12px">
        You received this email because you have an account on CreatorBoost.
        <br/>Visit <a href="${s}" style="color:#a78bfa">${s}</a> · Support: <a href="mailto:${support}" style="color:#a78bfa">${support}</a>
      </p>
    </div>`;

  switch (template) {
    case 'welcome':
      return {
        subject: 'Welcome to CreatorBoost 🚀',
        html: layout('Welcome to CreatorBoost!', `
          <p>Hi ${d.name || 'there'},</p>
          <p>Your account is ready. Create your first unlock campaign, share your link, and start earning
             from valid views.</p>
          <p style="margin:20px 0"><a href="${s}/dashboard" style="background:#8b5cf6;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Go to dashboard</a></p>
          <p>Questions? Just reply to this email.</p>`),
        text: `Welcome to CreatorBoost! Your account is ready. Open ${s}/dashboard to get started.`,
      };
    case 'withdrawal_requested':
      return {
        subject: 'Withdrawal request received',
        html: layout('Withdrawal request received', `
          <p>A withdrawal of <strong>$${d.amount}</strong> via <strong>${d.method}</strong> has been received
             and is now pending review.</p>
          <p>You will be notified when it is approved and when it is paid.</p>`),
        text: `Your withdrawal of $${r.amount} via ${r.method} is pending review.`,
      };
    case 'withdrawal_approved':
      return {
        subject: 'Withdrawal approved ✅',
        html: layout('Withdrawal approved', `
          <p>Your withdrawal of <strong>$${d.amount}</strong> has been approved and will be processed shortly.</p>
          <p>We will email you again as soon as it is paid.</p>`),
        text: `Your withdrawal of $${r.amount} has been approved.`,
      };
    case 'withdrawal_rejected':
      return {
        subject: 'Withdrawal rejected',
        html: layout('Withdrawal rejected', `
          <p>Your withdrawal of <strong>$${d.amount}</strong> was rejected.</p>
          <p>Reason: <strong>${d.reason || 'Not specified'}</strong></p>
          <p>The full amount has been returned to your available balance.</p>`),
        text: `Your withdrawal of $${r.amount} was rejected: ${r.reason || 'Not specified'}.`,
      };
    case 'withdrawal_paid':
      return {
        subject: 'Withdrawal paid 🎉',
        html: layout('Withdrawal paid', `
          <p>Your withdrawal of <strong>$${d.amount}</strong> has been paid out
             ${d.txId ? `(transaction: <code>${d.txId}</code>)` : ''}.</p>
          <p>Thank you for using CreatorBoost!</p>`),
        text: `Your withdrawal of $${r.amount} has been paid.`,
      };
    case 'account_suspended':
      return {
        subject: 'Account suspended',
        html: layout('Account suspended', `
          <p>Your CreatorBoost account has been <strong>suspended</strong>.</p>
          <p>You cannot access your dashboard while suspended. If you believe this is a mistake,
             contact <a href="mailto:${support}">${support}</a>.</p>`),
        text: 'Your CreatorBoost account has been suspended. Contact support for details.',
      };
    case 'account_banned':
      return {
        subject: 'Account banned',
        html: layout('Account banned', `
          <p>Your CreatorBoost account has been <strong>banned</strong>.</p>
          <p>This decision was made after review of your account activity. Contact
             <a href="mailto:${support}">${support}</a>
             if you believe this is an error.</p>`),
        text: 'Your CreatorBoost account has been banned.',
      };
    case 'support_confirmation':
      return {
        subject: `Support request received: ${r.subject || 'Your ticket'}`,
        html: layout('Support request received', `
          <p>Hi ${d.name || 'there'},</p>
          <p>We received your support request <strong>#${d.ticketId}</strong> and will reply within 24 hours.</p>
          <p>Your message: <em>"${d.message}"</em></p>`),
        text: `We received your support request #${r.ticketId}. We will reply within 24 hours.`,
      };
  }
}

/**
 * Send a transactional email. Never throws; returns a result object.
 * When RESEND_API_KEY is absent, logs a server-side notice and reports
 * `not_configured` — the caller should surface a neutral message to users.
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const to = (payload.to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { sent: false, reason: 'invalid_recipient' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not configured; skipping "${payload.subject}" to ${to}`);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      // Never leak provider errors to the client; log them server-side.
      const body = await res.text().catch(() => '');
      console.error(`[email] provider error ${res.status}: ${body.slice(0, 300)}`);
      return { sent: false, reason: 'provider_error' };
    }
    return { sent: true };
  } catch (e) {
    console.error('[email] send failed', e);
    return { sent: false, reason: 'provider_error' };
  }
}

/** Convenience: render + send a template in one call. */
export async function sendTemplateEmail(
  template: EmailTemplate,
  to: string,
  data: TemplateData,
): Promise<EmailResult> {
  const { subject, html, text } = renderTemplate(template, data);
  return sendEmail({ to, subject, html, text });
}
