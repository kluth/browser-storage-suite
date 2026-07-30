import { describe, it, expect } from 'vitest';
import { Result } from '../../../utils/result';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';

class TestMockRepository implements StorageRepositoryPort {
  public store = new Map<string, string>();
  public shouldFail = false;

  async fetchEntries(_target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    if (this.shouldFail) return Result.err('Database read failure');

    const dtos: StorageEntryDto[] = [];
    this.store.forEach((val, key) => dtos.push({ key, value: val, sizeInBytes: val.length }));
    return Result.ok(dtos);
  }

  async saveEntry(_target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    if (this.shouldFail) return Result.err('Disk write permission denied');

    this.store.set(key.value, value.value);
    return Result.ok(undefined);
  }

  async deleteEntry(_target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    if (this.shouldFail) return Result.err('Key not found in database');

    this.store.delete(key.value);
    return Result.ok(undefined);
  }
}

describe('Feature 12: Hexagonal Application Service & Result<T, E>', () => {
  it('12.1 should wrap ok and err values cleanly using Result monadic helpers', () => {
    const okRes = Result.ok(100);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.value).toBe(100);

    const errRes = Result.err('System Error');
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) expect(errRes.error).toBe('System Error');
  });

  it('12.2 should validate domain StorageKey creation via Result pattern', () => {
    const validKey = StorageKey.create('user_token');
    expect(validKey.ok).toBe(true);
    if (validKey.ok) expect(validKey.value.value).toBe('user_token');

    const invalidKey = StorageKey.create('   ');
    expect(invalidKey.ok).toBe(false);
    if (!invalidKey.ok) expect(invalidKey.error).toBe('StorageKey cannot be empty');
  });

  it('12.3 should create domain StorageValue with accurate byte calculation', () => {
    const valRes = StorageValue.create('Hello World');
    expect(valRes.ok).toBe(true);
    if (valRes.ok) {
      expect(valRes.value.value).toBe('Hello World');
      expect(valRes.value.sizeInBytes).toBe(11);
    }

    const nullValRes = StorageValue.create(null as any);
    expect(nullValRes.ok).toBe(true);
    if (nullValRes.ok) {
      expect(nullValRes.value.value).toBe('');
      expect(nullValRes.value.sizeInBytes).toBe(0);
    }
  });

  it('12.4 should delegate setStorageItem through Hexagonal Service to Secondary Port', async () => {
    const repo = new TestMockRepository();
    const service = new StorageApplicationService(repo);

    const res = await service.setStorageItem('localStorage', 'user_pref', 'compact');
    expect(res.ok).toBe(true);
    expect(repo.store.get('user_pref')).toBe('compact');
  });

  it('12.5 should reject invalid keys before hitting repository port', async () => {
    const repo = new TestMockRepository();
    const service = new StorageApplicationService(repo);

    const res = await service.setStorageItem('localStorage', '', 'value');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('StorageKey cannot be empty');
    }
    expect(repo.store.size).toBe(0);
  });

  it('12.6 should pass through repository failure error Results without throwing control exceptions', async () => {
    const repo = new TestMockRepository();
    repo.shouldFail = true;
    const service = new StorageApplicationService(repo);

    const loadRes = await service.loadStorageView('localStorage');
    expect(loadRes.ok).toBe(false);
    if (!loadRes.ok) {
      expect(loadRes.error).toBe('Database read failure');
    }

    const saveRes = await service.setStorageItem('localStorage', 'valid_key', 'val');
    expect(saveRes.ok).toBe(false);
    if (!saveRes.ok) {
      expect(saveRes.error).toBe('Disk write permission denied');
    }
  });
});
