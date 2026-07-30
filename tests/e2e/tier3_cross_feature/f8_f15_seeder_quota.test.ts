import { describe, it, expect } from 'vitest';
import { generateSelectiveSeedData } from '../../../utils/dataSeeder';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';

describe('Tier 3 Interaction: F8 (Data Seeder) + F15 (Quota Advisor)', () => {
  it('should analyze high-volume seeded test datasets and generate quota usage & anti-pattern alerts', () => {
    // Generate seeded records (user profiles & auth tokens)
    const seededUsers = generateSelectiveSeedData('user_profiles', 10);
    const seededTokens = generateSelectiveSeedData('auth_tokens', 2);

    const localEntries: Record<string, string> = {};
    [...seededUsers, ...seededTokens].forEach((rec) => {
      localEntries[rec.key] = rec.value;
    });

    // Add a synthetic large object to simulate high quota usage (>3.8MB, >75% of 5MB)
    localEntries['heavy_cache_data'] = 'A'.repeat(4 * 1024 * 1024);

    const metrics = analyzeStoragePerformance(localEntries, []);

    expect(metrics.localStorageBytes).toBeGreaterThan(4 * 1024 * 1024);
    
    // Check quota warning insight (>75%)
    const quotaWarning = metrics.insights.find((i) => i.id === 'quota_warning');
    expect(quotaWarning).toBeDefined();
    expect(quotaWarning?.type).toBe('warning');
    expect(quotaWarning?.title).toContain('75%');
    expect(quotaWarning?.description).toContain('%');

    // Check large item insight
    const largeItemInsight = metrics.insights.find((i) => i.id.includes('heavy_cache_data'));
    expect(largeItemInsight).toBeDefined();

    // Check security token insight for seeded auth tokens
    const tokenInsight = metrics.insights.find((i) => i.id.includes('auth_token'));
    expect(tokenInsight).toBeDefined();
  });
});
