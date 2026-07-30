import { describe, it, expect } from 'vitest';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { StorageSnapshot } from '../../../utils/storageAggregate';
import { Result } from '../../../utils/result';

class InMemoryStorageRepository implements StorageRepositoryPort {
  private store = new Map<string, string>();

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

describe('Tier 3 Interaction: F16 (Snapshot Export/Import) + F12 (Hexagonal Application Service)', () => {
  it('should export Hexagonal service storage state into a snapshot JSON and restore it via hexagonal port commands', async () => {
    const repository = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repository);

    // 1. Populate Hexagonal service items
    await service.setStorageItem('localStorage', 'theme', 'dark');
    await service.setStorageItem('localStorage', 'locale', 'de-DE');

    const viewRes = await service.loadStorageView('localStorage');
    expect(viewRes.ok).toBe(true);

    // 2. Export service entries to F16 Snapshot JSON format
    const entriesMap: Record<string, string> = {};
    if (viewRes.ok) {
      viewRes.value.forEach((item) => {
        entriesMap[item.key] = item.value;
      });
    }

    const exportedSnapshot: StorageSnapshot = {
      timestamp: Date.now(),
      entries: entriesMap,
    };

    const jsonString = JSON.stringify(exportedSnapshot);
    expect(jsonString).toContain('theme');
    expect(jsonString).toContain('locale');

    // 3. Import snapshot into a fresh Hexagonal service instance using Result-validated operations
    const newRepo = new InMemoryStorageRepository();
    const newService = new StorageApplicationService(newRepo);

    const importedSnapshot: StorageSnapshot = JSON.parse(jsonString);
    for (const [key, value] of Object.entries(importedSnapshot.entries)) {
      const setRes = await newService.setStorageItem('localStorage', key, value);
      expect(setRes.ok).toBe(true);
    }

    const importedViewRes = await newService.loadStorageView('localStorage');
    expect(importedViewRes.ok).toBe(true);
    if (importedViewRes.ok) {
      expect(importedViewRes.value.length).toBe(2);
      expect(importedViewRes.value.find((e) => e.key === 'theme')?.value).toBe('dark');
      expect(importedViewRes.value.find((e) => e.key === 'locale')?.value).toBe('de-DE');
    }
  });

  it('should reject invalid keys during snapshot import with Result error without throwing exceptions', async () => {
    const repository = new InMemoryStorageRepository();
    const service = new StorageApplicationService(repository);

    const invalidSnapshot: StorageSnapshot = {
      timestamp: Date.now(),
      entries: {
        '   ': 'invalid_blank_key',
      },
    };

    for (const [key, value] of Object.entries(invalidSnapshot.entries)) {
      const setRes = await service.setStorageItem('localStorage', key, value);
      expect(setRes.ok).toBe(false);
      if (!setRes.ok) {
        expect(setRes.error).toBe('StorageKey cannot be empty');
      }
    }
  });
});
