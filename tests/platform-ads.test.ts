import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPublicPlatformAds,
  normalizePlatformAdUrl,
  resolvePlatformAdPlacement,
} from '@/lib/platform-ads';

const root = join(__dirname, '..');
const adminServer = readFileSync(join(root, 'src/lib/admin-server.ts'), 'utf8');
const unlockPage = readFileSync(join(root, 'src/app/unlock/UnlockServerBody.tsx'), 'utf8');
const unlockClient = readFileSync(join(root, 'src/app/c/[slug]/UnlockClient.tsx'), 'utf8');
const adSlot = readFileSync(join(root, 'src/components/PlatformAdSlot.tsx'), 'utf8');
const campaignPayload = readFileSync(join(root, 'src/lib/campaign-payload.ts'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/0016_platform_unlock_ads.sql'), 'utf8');

describe('platform unlock-page ads', () => {
  it('only exposes enabled placements that have valid admin-configured content', () => {
    const disabled = getPublicPlatformAds({
      banner_enabled: false,
      banner_code: '<div>ad</div>',
      popunder_enabled: false,
      popunder_url: 'https://ads.example/popunder',
    });
    expect(disabled.banner).toBeNull();
    expect(disabled.popunder).toBeNull();

    const enabled = getPublicPlatformAds({
      banner_enabled: true,
      banner_code: '  <div>banner</div>  ',
      banner_url: 'javascript:alert(1)',
      popunder_enabled: true,
      popunder_url: 'https://ads.example/popunder',
    });
    expect(enabled.banner).toEqual({ code: '<div>banner</div>', url: null });
    expect(enabled.popunder).toEqual({ code: null, url: 'https://ads.example/popunder' });
  });

  it('drops empty/malformed placements, so the public page has no empty ad box', () => {
    expect(resolvePlatformAdPlacement({ code: '   ', url: 'javascript:alert(1)' })).toBeNull();
    expect(resolvePlatformAdPlacement({ code: '  <ins>banner</ins> ', url: 'https://ads.example/fallback' }))
      .toEqual({ code: '<ins>banner</ins>', url: 'https://ads.example/fallback' });
    expect(normalizePlatformAdUrl('data:text/html,ad')).toBeNull();
    expect(normalizePlatformAdUrl('https://publisher:secret@ads.example/ad')).toBeNull();
  });

  it('keeps ad writes behind the existing admin guard and validates URL fallbacks', () => {
    const saveSettings = adminServer.match(/export async function adminSaveSettings[\s\S]*?\n}\n\nexport async function adminListWithdrawalMethods/);
    expect(saveSettings?.[0]).toContain('const admin = await requireAdmin();');
    expect(saveSettings?.[0]).toContain("'banner_enabled', 'banner_code', 'banner_url', 'popunder_enabled', 'popunder_code', 'popunder_url'");
    expect(saveSettings?.[0]).toContain('isValidPlatformAdUrl');
    expect(saveSettings?.[0]).toContain('normalizePlatformAdCode');
    expect(migration).toContain('platform_settings_banner_url_http');
    expect(migration).toContain('platform_settings_popunder_url_http');
  });

  it('keeps ads out of campaign mutations and reads public placements server-side', () => {
    expect(campaignPayload).toContain('}).strict();');
    expect(campaignPayload).not.toContain('banner_code');
    expect(campaignPayload).not.toContain('popunder_code');
    expect(unlockPage).toContain('createAdminClient');
    expect(unlockPage).toContain(".from('platform_settings')");
    expect(unlockPage).toContain('getPublicPlatformAds(platformSettings.data)');
  });

  it('keeps the normal task click and constrains the ad slot on narrow screens', () => {
    expect(unlockClient).toContain("window.open(url, '_blank', 'noopener,noreferrer');");
    expect(unlockClient).toContain('triggerPopunder();');
    expect(adSlot).toContain('min-w-0 max-w-full overflow-hidden');
    expect(adSlot).toContain('w-full h-[100px] sm:h-[120px] max-w-full');
  });
});
