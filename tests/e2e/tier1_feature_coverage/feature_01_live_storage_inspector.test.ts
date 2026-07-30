import { describe, it, expect } from 'vitest';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue } from '../../../src/domain/model/valueObjects';

class InMemoryStorageRepository implements StorageRepositoryPort {
  private localMap = new Map<string, string>();
  private sessionMap = new Map<string, string>();

  async fetchEntries(target: 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB' | 'cacheAPI' | 'opfs'): Promise<{ ok: true; value: StorageEntryDto[] }> {
    const map = target === 'localStorage' ? this.localMap : this.sessionMap;
    const entries: StorageEntryDto[] = [];
    map.forEach((val, key) => {
      entries.push({
        key,
        value: val,
        sizeInBytes: new Blob([key + val]).size,
      });
    });
    return { ok: true, value: entries };
  }

  async saveEntry(target: 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB' | 'cacheAPI' | 'opfs', key: StorageKey, value: StorageValue): Promise<{ ok: true; value: void }> {
    const map = target === 'localStorage' ? this.localMap : this.sessionMap;
    map.set(key.value, value.value);
    return { ok: true, value: undefined };
  }

  async deleteEntry(target: 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB' | 'cacheAPI' | 'opfs', key: StorageKey): Promise<{ ok: true; value: void }> {
    const map = target === 'localStorage' ? this.localMap : this.sessionMap;
    map.delete(key.value);
    return { ok: true, value: undefined };
  }
}

describe('Feature 01: Live Storage Inspector (LocalStorage & SessionStorage)', () => {
  it('1.1 should create and inspect valid StorageKey and StorageValue value objects', () => {
    const keyRes = StorageKey.create('  user_session_id  ');
    expect(keyRes.ok).toBe(true);
    if (keyRes.ok) {
      expect(keyRes.value.value).toBe('user_session_id');
    }

    const valRes = StorageValue.create('{"auth": true}');
    expect(valRes.ok).toBe(true);
    if (valRes.ok) {
      expect(valRes.value.value).toBe('{"auth": true}');
      expect(valRes.value.sizeInBytes).toBeGreaterThan(0);
    }
  });

  it('1.2 should reject empty or whitespace-only storage keys', () => {
    const emptyRes = StorageKey.create('');
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.error).toBe('StorageKey cannot be empty');
    }

    const whitespaceRes = StorageKey.create('   ');
    expect(whitespaceRes.ok).toBe(false);
  });

  it('1.3 should perform CRUD operations on LocalStorage target via service', async () => {
    const repo = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repo);

    const saveRes = await service.setStorageItem('localStorage', 'app_theme', 'dark');
    expect(saveRes.ok).toBe(true);

    const listRes = await service.loadStorageView('localStorage');
    expect(listRes.ok).toBe(true);
    if (listRes.ok) {
      expect(listRes.value).toHaveLength(1);
      expect(listRes.value[0].key).toBe('app_theme');
      expect(listRes.value[0].value).toBe('dark');
    }

    const deleteRes = await service.removeStorageItem('localStorage', 'app_theme');
    expect(deleteRes.ok).toBe(true);

    const emptyList = await service.loadStorageView('localStorage');
    if (emptyList.ok) {
      expect(emptyList.value).toHaveLength(0);
    }
  });

  it('1.4 should isolate SessionStorage entries from LocalStorage entries', async () => {
    const repo = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repo);

    await service.setStorageItem('localStorage', 'key_local', 'val1');
    await service.setStorageItem('sessionStorage', 'key_session', 'val2');

    const localEntries = await service.loadStorageView('localStorage');
    const sessionEntries = await service.loadStorageView('sessionStorage');

    expect(localEntries.ok && localEntries.value[0].key).toBe('key_local');
    expect(sessionEntries.ok && sessionEntries.value[0].key).toBe('key_session');
  });

  it('1.5 should handle complex JSON string payloads and calculate byte sizes accurately', async () => {
    const repo = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repo);

    const jsonPayload = JSON.stringify({ user: 'Alice', roles: ['admin', 'dev'], metadata: { loginCount: 42 } });
    await service.setStorageItem('localStorage', 'user_profile', jsonPayload);

    const view = await service.loadStorageView('localStorage');
    expect(view.ok).toBe(true);
    if (view.ok) {
      const entry = view.value[0];
      expect(entry.key).toBe('user_profile');
      expect(JSON.parse(entry.value)).toEqual({ user: 'Alice', roles: ['admin', 'dev'], metadata: { loginCount: 42 } });
      expect(entry.sizeInBytes).toBe(new Blob(['user_profile' + jsonPayload]).size);
    }
  });

  it('1.6 should reject invalid key when removing item from storage view', async () => {
    const repo = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repo);

    const removeRes = await service.removeStorageItem('localStorage', '   ');
    expect(removeRes.ok).toBe(false);
    if (!removeRes.ok) {
      expect(removeRes.error).toBe('StorageKey cannot be empty');
    }
  });
});
