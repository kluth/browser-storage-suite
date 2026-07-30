import { describe, it, expect } from 'vitest';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';

describe('Feature 15: Storage Quota & Performance Advisor', () => {
  it('15.1 should compute total localStorage bytes and return cookie count', () => {
    const entries = {
      key1: 'value1',
      key2: 'value2',
    };
    const cookies = [
      { name: 'c1', value: 'v1' },
      { name: 'c2', value: 'v2' },
    ];

    const metrics = analyzeStoragePerformance(entries, cookies);

    const expectedBytes = new Blob(['key1value1']).size + new Blob(['key2value2']).size;
    expect(metrics.localStorageBytes).toBe(expectedBytes);
    expect(metrics.localStorageLimitBytes).toBe(5 * 1024 * 1024);
    expect(metrics.cookieCount).toBe(2);
  });

  it('15.2 should detect anti-pattern for large storage items exceeding 100KB', () => {
    const largeValue = 'x'.repeat(101 * 1024); // > 100KB
    const entries = {
      large_payload_data: largeValue,
    };

    const metrics = analyzeStoragePerformance(entries, []);

    const largeInsight = metrics.insights.find((i) => i.id === 'large_item_large_payload_data');
    expect(largeInsight).toBeDefined();
    expect(largeInsight?.type).toBe('warning');
    expect(largeInsight?.title).toContain('Großes Objekt in LocalStorage');
    expect(largeInsight?.description).toContain('large_payload_data');
    expect(largeInsight?.recommendation).toContain('IndexedDB');
  });

  it('15.3 should detect security anti-pattern for raw auth JWT tokens stored in LocalStorage', () => {
    const entries = {
      user_auth_token: 'bearer_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    };

    const metrics = analyzeStoragePerformance(entries, []);

    const jwtInsight = metrics.insights.find((i) => i.id === 'jwt_sec_user_auth_token');
    expect(jwtInsight).toBeDefined();
    expect(jwtInsight?.type).toBe('tip');
    expect(jwtInsight?.title).toContain('Sicherheitshinweis: Auth Token in LocalStorage');
    expect(jwtInsight?.recommendation).toContain('HttpOnly');
  });

  it('15.4 should trigger quota warning insight when LocalStorage usage exceeds 75% of limit (3.75MB)', () => {
    // Generate ~4MB of data
    const chunk = 'a'.repeat(1024 * 1024); // 1MB
    const entries = {
      chunk1: chunk,
      chunk2: chunk,
      chunk3: chunk,
      chunk4: chunk,
    };

    const metrics = analyzeStoragePerformance(entries, []);

    const quotaWarning = metrics.insights.find((i) => i.id === 'quota_warning');
    expect(quotaWarning).toBeDefined();
    expect(quotaWarning?.type).toBe('warning');
    expect(quotaWarning?.title).toContain('LocalStorage Quota über 75%');
  });

  it('15.5 should return optimal storage success insight when no anti-patterns or quota warnings occur', () => {
    const entries = {
      simple_theme: 'dark',
      user_lang: 'en',
    };

    const metrics = analyzeStoragePerformance(entries, []);

    expect(metrics.insights).toHaveLength(1);
    expect(metrics.insights[0].id).toBe('optimal_storage');
    expect(metrics.insights[0].type).toBe('success');
    expect(metrics.insights[0].title).toContain('Optimale Storage Performance');
  });

  it('15.6 should accumulate multiple insights when multiple anti-patterns exist simultaneously', () => {
    const largeValue = 'y'.repeat(120 * 1024);
    const entries = {
      large_cache: largeValue,
      jwt_token_secret: 'bearer_token_xyz',
    };

    const metrics = analyzeStoragePerformance(entries, []);

    expect(metrics.insights.length).toBeGreaterThanOrEqual(2);
    const hasLarge = metrics.insights.some((i) => i.id.startsWith('large_item_'));
    const hasJwt = metrics.insights.some((i) => i.id.startsWith('jwt_sec_'));

    expect(hasLarge).toBe(true);
    expect(hasJwt).toBe(true);
  });
});
