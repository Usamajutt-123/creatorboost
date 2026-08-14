/**
 * Custom flows (4 Pages / 5 Pages) must EXTEND the existing Normal flow,
 * never replace it:
 *
 *   Normal  → task page → destination                (unchanged, 1.00×)
 *   4 Pages → task page → custom page 1..3 → destination  (1.25×)
 *   5 Pages → task page → custom page 1..4 → destination  (1.40×)
 *
 * These assertions pin the wiring between the public page, the Normal task
 * renderer (UnlockClient), and the custom-page renderer (FlowClient) so the
 * Normal flow cannot silently be duplicated, replaced, or bypassed, and so
 * the destination stays server-gated until the final custom page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const publicPage = readSrc('app/c/[slug]/page.tsx');
const unlockClient = readSrc('app/c/[slug]/UnlockClient.tsx');
const flowClient = readSrc('app/c/[slug]/FlowClient.tsx');
const stepRoute = readSrc('app/api/flow/step/route.ts');
const recordRoute = readSrc('app/api/views/record/route.ts');
const publicCampaign = readSrc('lib/public-campaign.ts');

describe('custom flows extend — never replace — the existing Normal flow', () => {
  it('the public campaign page renders UnlockClient for Normal exactly as before', () => {
    expect(publicPage).toContain('<UnlockClient');
    // Normal campaigns (or inconsistent custom data) always take the
    // existing task flow; custom flows branch to FlowClient.
    expect(publicPage).toContain("campaign.flow_type !== 'normal'");
  });

  it('stage 1 of every custom flow is the exact existing Normal task page', () => {
    expect(flowClient).toContain("import UnlockClient from './UnlockClient'");
    // Exactly ONE Normal task stage is rendered — no duplicate task page.
    expect(flowClient.split('<UnlockClient').length - 1).toBe(1);
    // Control is handed over via the onUnlocked hook after tasks complete.
    expect(flowClient).toContain('onUnlocked={handleTasksUnlocked}');
  });

  it('the custom flow session only starts AFTER the Normal task stage completes', () => {
    const handlerStart = flowClient.indexOf('const handleTasksUnlocked');
    const startCall = flowClient.indexOf("action: 'start'");
    expect(handlerStart).toBeGreaterThan(-1);
    expect(startCall).toBeGreaterThan(handlerStart);
    // There is no mount-time session start anymore.
    expect(flowClient).not.toContain('useEffect');
  });

  it('Normal campaigns keep the untouched default path: record view → destination', () => {
    // onUnlocked is optional and omitted by Normal usage.
    expect(unlockClient).toContain('onUnlocked?:');
    // When omitted, the original behavior is intact.
    expect(unlockClient).toContain("'/api/views/record'");
    expect(unlockClient).toContain('router.push(`/destination/${campaign.slug}`)');
  });

  it('the real task completions from stage 1 are sent at the end (tasks are not auto-satisfied)', () => {
    expect(flowClient).not.toContain('tasksCompleted: campaign.tasks');
    expect(flowClient).toContain('tasksCompleted,');
  });

  it('the destination only appears at the final step and stays server-controlled', () => {
    // FlowClient never receives or renders the destination URL itself.
    expect(flowClient).not.toContain('destination_url');
    expect(flowClient).not.toContain('destinationUrl');
    // The only way out is the existing unlock-cookie-gated destination page,
    // reached after the recorded view.
    expect(flowClient).toContain('router.push(`/destination/${campaign.slug}`)');
    // Custom page rows carry no destination-capable field at all.
    expect(publicCampaign).toContain("'position, image_url, button_text'");
  });

  it('the multiplier stays server-derived: flow verification lives entirely on the server', () => {
    // Step progression is verified via HMAC tokens, and the multiplier is
    // only applied after the completion token is verified in views/record.
    expect(stepRoute).toContain('advanceStepToken');
    expect(recordRoute).toContain('verifyFlowCompletion');
    expect(recordRoute).toContain('coerceFlowType(campaign.flow_type)');
    // The client can never submit a multiplier/flow type.
    expect(recordRoute).not.toMatch(/parsed\.data\.(multiplier|flowType)/);
    expect(stepRoute).not.toMatch(/parsed\.data\.(multiplier|flowType)/);
  });

  it('custom flows cannot start without an active campaign server-side', () => {
    expect(stepRoute).toContain("campaign.status !== 'active'");
    expect(stepRoute).toContain("This campaign does not use a custom flow");
  });
});
