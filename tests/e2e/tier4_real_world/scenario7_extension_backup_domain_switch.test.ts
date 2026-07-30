import { describe, it, expect, vi } from 'vitest';
import { getDefaultStoragePresets, StoragePreset } from '../../../utils/presetManager';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { getCookiesForTab, CookieItem } from '../../../utils/browserApi';

class InMemoryDomainAdapter implements StorageRepositoryPort {
  private store: Map<string, StorageEntryDto> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.values()).filter((e) => e.target === target);
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(`${target}:${key.value}`, { key: key.value, value: value.value, target });
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(`${target}:${key.value}`);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    for (const [k, entry] of this.store.entries()) {
      if (entry.target === target) this.store.delete(k);
    }
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 7: Extension Backup, Presets & Domain Switch Workflow (F16, F9, F1, F2)', () => {
  it('should retrieve default extension presets and export environment backup JSON', () => {
    const res = getDefaultStoragePresets();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const defaultPresets: StoragePreset[] = res.value;
    expect(defaultPresets.length).toBe(3);

    const adminPreset = defaultPresets.find((p) => p.entries['user_role'] === 'super_admin');
    expect(adminPreset).toBeDefined();
    expect(adminPreset?.entries['user_role']).toBe('super_admin');
    expect(adminPreset?.entries['theme_preference']).toBe('dark');

    const guestPreset = defaultPresets.find((p) => p.entries['guest_session_id']);
    expect(guestPreset).toBeDefined();
    expect(guestPreset?.entries['guest_session_id']).toContain('guest_sess_');

    const corruptedPreset = defaultPresets.find((p) => p.entries['user_config_json']);
    expect(corruptedPreset).toBeDefined();

    const backupBackupConfig = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      presets: defaultPresets,
      activeDomain: 'app.staging.dev',
      storageOptions: {
        autoSync: true,
        telemetryEnabled: true,
      },
    };

    const serializedBackup = JSON.stringify(backupBackupConfig);
    expect(serializedBackup).toContain('user_role');

    const parsedBackup = JSON.parse(serializedBackup);
    expect(parsedBackup.presets.length).toBe(3);
    expect(parsedBackup.activeDomain).toBe('app.staging.dev');
  });

  it('should switch target domain and predict domain-specific presets', () => {
    const stagingMeta: PageMetadata = {
      url: 'https://app.staging.dev/dashboard',
      title: 'Staging Environment Dashboard',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };
    const stagingRes = predictPagePresets(stagingMeta);
    expect(stagingRes.ok).toBe(true);
    if (!stagingRes.ok) return;

    expect(stagingRes.value.length).toBeGreaterThan(0);

    const prodAdminMeta: PageMetadata = {
      url: 'https://admin.production.org/login',
      title: 'Admin Portal Login',
      hasPasswordField: true,
      hasFormCart: false,
      metaTags: ['admin', 'auth'],
    };
    const prodRes = predictPagePresets(prodAdminMeta);
    expect(prodRes.ok).toBe(true);
    if (!prodRes.ok) return;

    const prodPredictions = prodRes.value;
    expect(prodPredictions.length).toBe(2);

    const authAdminPreset = prodPredictions.find((p) => p.category === 'auth');
    expect(authAdminPreset).toBeDefined();
    expect(authAdminPreset?.category).toBe('auth');
    expect(authAdminPreset?.entries['user_role']).toBe('super_admin');
    expect(authAdminPreset?.entries['access_token']).toContain('bearer_admin_jwt');

    const expiredTokenPreset = prodPredictions[1];
    expect(expiredTokenPreset).toBeDefined();
    expect(expiredTokenPreset?.entries['access_token']).toContain('bearer_expired');
  });

  it('should isolate domain cookies during domain switch workflow', async () => {
    const mockCookies: CookieItem[] = [
      { name: 'staging_sess', value: 'stg_99', domain: 'app.staging.dev', path: '/', secure: true, httpOnly: true },
      { name: 'prod_admin_sess', value: 'prod_88', domain: 'admin.production.org', path: '/', secure: true, httpOnly: true },
    ];

    const originalChrome = global.chrome;
    global.chrome = {
      cookies: {
        getAll: vi.fn().mockImplementation(async (query: { url?: string }) => {
          if (query.url?.includes('staging')) {
            return [mockCookies[0]];
          } else if (query.url?.includes('production')) {
            return [mockCookies[1]];
          }
          return [];
        }),
      },
    } as unknown as typeof chrome;

    const stagingCookies = await getCookiesForTab('https://app.staging.dev');
    expect(stagingCookies.length).toBe(1);
    expect(stagingCookies[0].name).toBe('staging_sess');

    const prodCookies = await getCookiesForTab('https://admin.production.org');
    expect(prodCookies.length).toBe(1);
    expect(prodCookies[0].name).toBe('prod_admin_sess');

    global.chrome = originalChrome;
  });

  it('should apply selected preset and restore backup snapshot into StorageApplicationService', async () => {
    const adapter = new InMemoryDomainAdapter();
    const service = new StorageApplicationService(adapter);

    const res = getDefaultStoragePresets();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const adminPreset = res.value[0];

    for (const [key, value] of Object.entries(adminPreset.entries)) {
      const setRes = await service.setStorageItem('localStorage', key, value);
      expect(setRes.ok).toBe(true);
    }

    const viewRes = await service.loadStorageView('localStorage');
    expect(viewRes.ok).toBe(true);
    if (viewRes.ok) {
      expect(viewRes.value.length).toBe(4);
      const tokenEntry = viewRes.value.find((e) => e.key === 'user_auth_token');
      expect(tokenEntry).toBeDefined();

      const roleEntry = viewRes.value.find((e) => e.key === 'user_role');
      expect(roleEntry?.value).toBe('super_admin');
    }
  });
});

