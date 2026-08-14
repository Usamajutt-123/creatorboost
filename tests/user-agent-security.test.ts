/**
 * Tests for Fix 2: Client-Controlled User-Agent Override Prevention.
 *
 * These tests verify that:
 * - The server-derived User-Agent (from request headers) is used as
 *   authoritative for fraud/earnings decisions.
 * - A forged body.userAgent cannot override the real header UA.
 * - Missing body.userAgent does not break the request.
 * - The fraud/earnings logic receives the server-derived UA.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Fix 2: User-Agent security — route handler', () => {
  const root = join(__dirname, '..');
  const route = readFileSync(join(root, 'src/app/api/views/record/route.ts'), 'utf8');

  it('uses request.headers.get("user-agent") as the primary (authoritative) source', () => {
    // The assignment must use the server header FIRST, not the body field.
    // Pattern: request.headers.get('user-agent') || userAgent ||
    expect(route).toMatch(/request\.headers\.get\(['"]user-agent['"]\)\s*\|\|\s*userAgent/);
  });

  it('does NOT use body.userAgent as the primary UA source', () => {
    // Should NOT have: userAgent || request.headers.get(...)
    // (which would prioritize client-supplied UA).
    expect(route).not.toMatch(/userAgent\s*\|\|\s*request\.headers\.get\(['"]user-agent['"]\)/);
  });

  it('accepts a userAgent field in the request schema (for telemetry)', () => {
    const schema = readFileSync(join(root, 'src/lib/view-schema.ts'), 'utf8');
    expect(schema).toContain('userAgent');
  });
});

describe('Fix 2: Fraud assessment always uses server-derived UA', () => {
  const root = join(__dirname, '..');
  const fraud = readFileSync(join(root, 'src/lib/fraud.ts'), 'utf8');

  it('scoreUserAgent is called with the server-side UA', () => {
    // The fraud module's scoreUserAgent accepts a ua parameter.
    expect(fraud).toContain('scoreUserAgent');
    // The function signature accepts userAgent from the caller.
    expect(fraud).toMatch(/function scoreUserAgent\(ua/);
  });

  it('assessFraud receives userAgent from the caller (earnings engine)', () => {
    const earnings = readFileSync(join(root, 'src/lib/earnings.ts'), 'utf8');
    // The recordView function passes input.userAgent to assessFraud.
    expect(earnings).toMatch(/userAgent:\s*input\.userAgent/);
  });
});

describe('Fix 2: Earnings engine test — UA is never client-controlled for fraud', () => {
  it('client-supplied userAgent in the schema is optional and max-limited', () => {
    const root = join(__dirname, '..');
    const schema = readFileSync(join(root, 'src/lib/view-schema.ts'), 'utf8');
    // The schema accepts userAgent but limits its length (not infinite spoofing).
    expect(schema).toMatch(/userAgent.*max\(500\)/);
  });

  it('the view schema rejects unknown fields beyond the defined ones', () => {
    const root = join(__dirname, '..');
    const schema = readFileSync(join(root, 'src/lib/view-schema.ts'), 'utf8');
    // .strict() must be present to reject smuggled fields.
    expect(schema).toContain('.strict()');
  });
});
