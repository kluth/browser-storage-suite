import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { getStorageDataBlame, DataBlameRegistry } from '../../../utils/dataBlamer';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';
import { deleteCookie, CookieItem } from '../../../utils/browserApi';

class InMemoryAuditStorageAdapter implements StorageRepositoryPort {
  private store: Map<string, StorageEntryDto> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.values()).filter((e) => e.target === target);
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(`${target}:${key.value}`, {
      key: key.value,
      value: value.value,
      target,
    });
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(`${target}:${key.value}`);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    for (const [k, entry] of this.store.entries()) {
      if (entry.target === target) {
        this.store.delete(k);
      }
    }
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 1: Full Storage Inspection & Provenance Audit (F1, F2, F4, F15)', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  it('should load and inspect live storage entries across targets and query data blaming provenance', async () => {
    const adapter = new InMemoryAuditStorageAdapter();
    const service = new StorageApplicationService(adapter);

    const authStack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
    at async handleLogin (https://example.com/login.ts:45:3)`;

    const themeStack = `Error
    at toggleDarkMode (https://example.com/assets/theme-switch.js:12:5)
    at HTMLButtonElement.onClick (https://example.com/theme.js:10:2)`;

    await service.setStorageItem('localStorage', 'user_auth_token', 'bearer_secret_jwt_token_999');
    await service.setStorageItem('localStorage', 'theme_preference', 'dark');
    await service.setStorageItem('sessionStorage', 'app_config_state', '{"env":"production","debug":false}');

    const localView = await service.loadStorageView('localStorage');
    expect(localView.ok).toBe(true);
    if (localView.ok) {
      expect(localView.value.length).toBe(2);
      const keys = localView.value.map((e) => e.key);
      expect(keys).toContain('user_auth_token');
      expect(keys).toContain('theme_preference');
    }

    const authTokenBlame = getStorageDataBlame('user_auth_token', 'bearer_secret_jwt_token_999', authStack);
    expect(authTokenBlame.key).toBe('user_auth_token');
    expect(authTokenBlame.actor.name).toContain('setAuthToken');
    expect(authTokenBlame.actor.type).toBe('script');
    expect(authTokenBlame.actor.scriptUrl).toContain('auth-bundle.js');
    expect(authTokenBlame.actor.stackTraceSnippet).toContain('handleLogin');
    expect(authTokenBlame.revisionCount).toBeGreaterThan(0);

    const themeBlame = getStorageDataBlame('theme_preference', 'dark', themeStack);
    expect(themeBlame.key).toBe('theme_preference');
    expect(themeBlame.actor.type).toBe('user_action');
    expect(themeBlame.actor.name).toContain('User Action');

    const genericBlame = getStorageDataBlame('app_config_state', '{"env":"production"}');
    expect(genericBlame.actor.name).toBeDefined();
    expect(genericBlame.actor.type).toBe('script');
  });

  it('should analyze storage performance quota, identify anti-patterns, and provide recommendations', () => {
    const largePayload = 'A'.repeat(120 * 1024); // 120 KB string
    const localEntries: Record<string, string> = {
      large_state_cache: largePayload,
      user_auth_token: 'bearer_token_xyz',
      normal_key: 'simple_value',
    };

    const mockCookies: CookieItem[] = [
      { name: 'session_id', value: 'sess_123', domain: 'example.com', path: '/', secure: true, httpOnly: true },
      { name: 'tracking_id', value: 'tr_456', domain: 'example.com', path: '/', secure: false, httpOnly: false },
    ];

    const metrics = analyzeStoragePerformance(localEntries, mockCookies);

    expect(metrics.localStorageBytes).toBeGreaterThan(100 * 1024);
    expect(metrics.cookieCount).toBe(2);
    expect(metrics.localStorageLimitBytes).toBe(5 * 1024 * 1024);

    const largeItemInsight = metrics.insights.find((i) => i.id === 'large_item_large_state_cache');
    expect(largeItemInsight).toBeDefined();
    expect(largeItemInsight?.type).toBe('warning');
    expect(largeItemInsight?.recommendation).toContain('IndexedDB');

    const jwtSecInsight = metrics.insights.find((i) => i.id === 'jwt_sec_user_auth_token');
    expect(jwtSecInsight).toBeDefined();
    expect(jwtSecInsight?.type).toBe('tip');
    expect(jwtSecInsight?.recommendation).toContain('HttpOnly');
  });

  it('should execute storage remediation workflow to resolve warnings and re-audit for optimal health', async () => {
    const adapter = new InMemoryAuditStorageAdapter();
    const service = new StorageApplicationService(adapter);

    await service.setStorageItem('localStorage', 'large_state_cache', 'A'.repeat(120 * 1024));
    await service.setStorageItem('localStorage', 'user_auth_token', 'jwt_val');

    let localView = await service.loadStorageView('localStorage');
    expect(localView.ok && localView.value.length === 2).toBe(true);

    await service.removeStorageItem('localStorage', 'large_state_cache');
    await service.removeStorageItem('localStorage', 'user_auth_token');

    await service.setStorageItem('localStorage', 'theme', 'dark');

    localView = await service.loadStorageView('localStorage');
    expect(localView.ok).toBe(true);
    const cleanEntries: Record<string, string> = {};
    if (localView.ok) {
      localView.value.forEach((e) => {
        cleanEntries[e.key] = e.value;
      });
    }

    const originalChrome = global.chrome;
    global.chrome = {
      cookies: {
        remove: vi.fn().mockResolvedValue({ url: 'https://example.com', name: 'tracking_id' }),
      },
    } as unknown as typeof chrome;

    const cookieRemoved = await deleteCookie('https://example.com', 'tracking_id');
    expect(cookieRemoved).toBe(true);

    global.chrome = originalChrome;

    const cleanMetrics = analyzeStoragePerformance(cleanEntries, []);

    expect(cleanMetrics.insights.length).toBe(1);
    expect(cleanMetrics.insights[0].id).toBe('optimal_storage');
    expect(cleanMetrics.insights[0].type).toBe('success');
    expect(cleanMetrics.insights[0].title).toContain('Optimale Storage Performance');
  });
});
