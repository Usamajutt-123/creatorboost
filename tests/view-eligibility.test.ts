/**
 * Traffic attribution vocabulary — the paid vs non-paid split.
 *
 * These are the pure rules that decide:
 *   - which safe category a recorded view belongs to,
 *   - whether a creator may ever see it,
 *   - how the admin summary is folded together.
 */
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_LABEL,
  VIEW_TRAFFIC_CATEGORIES,
  classifyViewOutcome,
  emptyCategoryCounts,
  isCreatorVisibleCategory,
  isCreatorVisibleOutcome,
  isDuplicateCategory,
  isFraudBlockedCategory,
  isViewTrafficCategory,
  summarizeTraffic,
} from '@/lib/view-eligibility';

describe('classifyViewOutcome', () => {
  it('classifies a valid view as paid', () => {
    expect(classifyViewOutcome('valid')).toBe('paid');
    // A stale reason on a valid row cannot demote it.
    expect(classifyViewOutcome('valid', 'duplicate_ip_24h')).toBe('paid');
  });

  it('maps the 24h campaign+IP duplicate to duplicate_24h', () => {
    expect(classifyViewOutcome('invalid', 'duplicate_ip_24h')).toBe('duplicate_24h');
    expect(classifyViewOutcome('invalid', 'duplicate_ip')).toBe('duplicate_24h');
  });

  it('maps automation reasons to bot_or_automation', () => {
    expect(classifyViewOutcome('invalid', 'bot')).toBe('bot_or_automation');
    expect(classifyViewOutcome('invalid', 'emulator')).toBe('bot_or_automation');
  });

  it('maps IP reputation reasons to vpn_or_proxy', () => {
    expect(classifyViewOutcome('invalid', 'vpn')).toBe('vpn_or_proxy');
    expect(classifyViewOutcome('invalid', 'proxy')).toBe('vpn_or_proxy');
    expect(classifyViewOutcome('invalid', 'tor')).toBe('vpn_or_proxy');
  });

  it('maps scoring/behavioural rejections to suspicious_traffic', () => {
    expect(classifyViewOutcome('invalid', 'abnormal_traffic')).toBe('suspicious_traffic');
    expect(classifyViewOutcome('invalid', 'click_spam')).toBe('suspicious_traffic');
  });

  it('maps cap and account reasons to their own buckets', () => {
    expect(classifyViewOutcome('invalid', 'creator_daily_cap')).toBe('earning_cap');
    expect(classifyViewOutcome('invalid', 'ip_limit')).toBe('earning_cap');
    expect(classifyViewOutcome('invalid', 'self_view')).toBe('account_or_campaign');
    expect(classifyViewOutcome('invalid', 'campaign_expired')).toBe('account_or_campaign');
  });

  it('never presents an unknown reason as paid traffic', () => {
    expect(classifyViewOutcome('invalid', 'some_future_reason')).toBe('other');
    expect(classifyViewOutcome('invalid', '')).toBe('other');
    expect(classifyViewOutcome('invalid', null)).toBe('other');
    expect(classifyViewOutcome('flagged', 'whatever')).toBe('other');
  });

  it('every produced category is a known category with a label', () => {
    for (const category of VIEW_TRAFFIC_CATEGORIES) {
      expect(isViewTrafficCategory(category)).toBe(true);
      expect(CATEGORY_LABEL[category]).toBeTruthy();
    }
    expect(isViewTrafficCategory('not_a_category')).toBe(false);
  });
});

describe('creator visibility — anti-fraud internals stay hidden', () => {
  it('hides every security category from creators', () => {
    for (const category of [
      'duplicate_24h', 'duplicate_device', 'bot_or_automation',
      'vpn_or_proxy', 'suspicious_traffic', 'rate_limited', 'invalid_session',
    ] as const) {
      expect(isCreatorVisibleCategory(category), `${category} must be hidden`).toBe(false);
    }
  });

  it('a duplicate view is never creator-visible', () => {
    expect(isCreatorVisibleOutcome('invalid', 'duplicate_ip_24h')).toBe(false);
  });

  it('paid traffic and legitimate business outcomes stay visible', () => {
    expect(isCreatorVisibleCategory('paid')).toBe(true);
    expect(isCreatorVisibleCategory('earning_cap')).toBe(true);
    expect(isCreatorVisibleCategory('account_or_campaign')).toBe(true);
    expect(isCreatorVisibleOutcome('valid')).toBe(true);
  });
});

describe('admin bucket helpers', () => {
  it('groups duplicate categories', () => {
    expect(isDuplicateCategory('duplicate_24h')).toBe(true);
    expect(isDuplicateCategory('duplicate_device')).toBe(true);
    expect(isDuplicateCategory('paid')).toBe(false);
  });

  it('groups fraud-blocked categories', () => {
    expect(isFraudBlockedCategory('bot_or_automation')).toBe(true);
    expect(isFraudBlockedCategory('vpn_or_proxy')).toBe(true);
    expect(isFraudBlockedCategory('suspicious_traffic')).toBe(true);
    expect(isFraudBlockedCategory('duplicate_24h')).toBe(false);
  });
});

describe('summarizeTraffic — the admin dashboard numbers', () => {
  it('computes the full paid / non-paid picture', () => {
    const summary = summarizeTraffic([
      { category: 'paid', views: 100, earnings: 0.625 },
      { category: 'duplicate_24h', views: 30, earnings: 0 },
      { category: 'duplicate_device', views: 5, earnings: 0 },
      { category: 'bot_or_automation', views: 12, earnings: 0 },
      { category: 'vpn_or_proxy', views: 3, earnings: 0 },
      { category: 'earning_cap', views: 2, earnings: 0 },
    ]);

    expect(summary.totalViews).toBe(152);
    expect(summary.paidViews).toBe(100);
    expect(summary.nonPaidViews).toBe(52);
    expect(summary.duplicateViews).toBe(35);
    expect(summary.fraudBlockedViews).toBe(15);
    expect(summary.earnings).toBeCloseTo(0.625, 10);
  });

  it('folds an unknown category into `other` instead of dropping it', () => {
    const summary = summarizeTraffic([
      { category: 'paid', views: 1, earnings: 0.005 },
      { category: 'mystery', views: 4, earnings: 0 },
    ]);
    expect(summary.totalViews).toBe(5);
    expect(summary.paidViews).toBe(1);
    expect(summary.nonPaidViews).toBe(4);
    expect(summary.byCategory.other).toBe(4);
  });

  it('handles empty/nullish input safely', () => {
    for (const input of [null, undefined, []]) {
      const summary = summarizeTraffic(input);
      expect(summary.totalViews).toBe(0);
      expect(summary.paidViews).toBe(0);
      expect(summary.nonPaidViews).toBe(0);
      expect(summary.earnings).toBe(0);
    }
    expect(Object.keys(emptyCategoryCounts()).sort()).toEqual([...VIEW_TRAFFIC_CATEGORIES].sort());
  });

  it('never reports a negative non-paid count', () => {
    const summary = summarizeTraffic([{ category: 'paid', views: 10, earnings: 1 }]);
    expect(summary.nonPaidViews).toBe(0);
  });
});
