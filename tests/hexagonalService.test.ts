import { describe, it, expect } from 'vitest';
import { StorageApplicationService } from '../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../src/domain/model/valueObjects';
import { Result } from '../utils/result';

class InMemoryStorageAdapter implements StorageRepositoryPort {
  private store: Map<string, string> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list: StorageEntryDto[] = Array.from(this.store.entries()).map(([k, v]) => ({
      key: k,
      value: v,
      target,
    }));
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(key.value, value.value);
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(key.value);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    this.store.clear();
    return Result.ok(undefined);
  }
}

describe('Hexagonal Architecture Application Service', () => {
  it('should save and load entries via secondary port adapter', async () => {
    const mockAdapter = new InMemoryStorageAdapter();
    const service = new StorageApplicationService(mockAdapter);

    const setRes = await service.setStorageItem('localStorage', 'theme_mode', 'dark');
    expect(setRes.ok).toBe(true);

    const viewRes = await service.loadStorageView('localStorage');
    expect(viewRes.ok).toBe(true);
    if (viewRes.ok) {
      expect(viewRes.value.length).toBe(1);
      expect(viewRes.value[0].key).toBe('theme_mode');
      expect(viewRes.value[0].value).toBe('dark');
    }
  });

  it('should reject invalid keys via domain validation without throwing exceptions', async () => {
    const mockAdapter = new InMemoryStorageAdapter();
    const service = new StorageApplicationService(mockAdapter);

    const invalidRes = await service.setStorageItem('localStorage', '   ', 'val');
    expect(invalidRes.ok).toBe(false);
    if (!invalidRes.ok) {
      expect(invalidRes.error).toBe('StorageKey cannot be empty');
    }
  });
});
