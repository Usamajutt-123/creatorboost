import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderTemplate, sendEmail, sendTemplateEmail, isConfigured } from '../src/lib/email';

describe('renderTemplate', () => {
  it('produces a subject and html for every template', () => {
    const templates = [
      'welcome', 'withdrawal_requested', 'withdrawal_approved', 'withdrawal_rejected',
      'withdrawal_paid', 'account_suspended', 'account_banned', 'support_confirmation',
    ] as const;
    for (const t of templates) {
      const r = renderTemplate(t, { name: 'A&B', amount: '10.00', method: 'paypal', reason: 'test', txId: 'tx1', ticketId: '123', subject: 'Hi', message: 'Hello' });
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.html.length).toBeGreaterThan(0);
    }
  });

  it('escapes user-controlled data in html', () => {
    const r = renderTemplate('support_confirmation', { message: '<script>alert(1)</script>', name: 'X', ticketId: '1', subject: 'S' });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
});

describe('sendEmail — graceful failure', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it('reports not_configured when RESEND_API_KEY is absent (never throws)', async () => {
    const res = await sendEmail({ to: 'a@b.com', subject: 'T', html: '<p>hi</p>' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('not_configured');
  });

  it('rejects invalid recipients', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const res = await sendEmail({ to: 'not-an-email', subject: 'T', html: '<p>hi</p>' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('invalid_recipient');
  });

  it('sendTemplateEmail returns not_configured without provider', async () => {
    const res = await sendTemplateEmail('welcome', 'a@b.com', { name: 'Test' });
    expect(res.sent).toBe(false);
    expect(isConfigured()).toBe(false);
  });

  it('returns provider_error when the provider call fails (simulated)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = await sendEmail({ to: 'a@b.com', subject: 'T', html: '<p>hi</p>' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('provider_error');
    fetchMock.mockRestore();
  });
});
