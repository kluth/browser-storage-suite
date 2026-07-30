import { describe, it, expect } from 'vitest';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';
import { StorageItem, CookieItem } from '../../../utils/browserApi';

describe('Tier 3 Interaction: F15 (Quota Advisor) + F1 (Storage Inspector)', () => {
  it('should analyze live inspected storage items and cookies to generate performance & security insights', () => {
    // Inspected items from F1 Storage Inspector
    const inspectedItems: StorageItem[] = [
      { key: 'session_auth_token', value: 'ey...secret_jwt', type: 'local' },
      { key: 'heavy_state_cache', value: 'x'.repeat(120 * 1024), type: 'local' }, // >100KB
    ];

    const inspectedCookies: CookieItem[] = [
      { name: 'session_id', value: 'sess_123', domain: 'example.com', path: '/', secure: true, httpOnly: true },
    ];

    // Map inspected items to format expected by Quota Advisor
    const localEntries: Record<string, string> = {};
    inspectedItems.forEach((item) => {
      localEntries[item.key] = item.value;
    });

    const metrics = analyzeStoragePerformance(localEntries, inspectedCookies);

    expect(metrics.localStorageBytes).toBeGreaterThan(120 * 1024);
    expect(metrics.cookieCount).toBe(1);

    // Verify insights generated for large items and auth token in LocalStorage
    const largeItemInsight = metrics.insights.find((i) => i.id.includes('heavy_state_cache'));
    expect(largeItemInsight).toBeDefined();
    expect(largeItemInsight?.type).toBe('warning');

    const tokenInsight = metrics.insights.find((i) => i.id.includes('session_auth_token'));
    expect(tokenInsight).toBeDefined();
    expect(tokenInsight?.type).toBe('tip');
  });
});
