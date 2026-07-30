import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageInterceptorAdapter } from '../../../src/infrastructure/adapters/storageInterceptorAdapter';
import { getStorageDataBlame, DataBlameRegistry, DataBlameInfo } from '../../../utils/dataBlamer';
import { StorageMutation } from '../../../utils/storageAggregate';

class TestStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  [name: string]: any;
}

if (typeof globalThis.Storage === 'undefined') {
  globalThis.Storage = TestStorage;
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new TestStorage();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new TestStorage();
}

describe('Tier 3 Interaction: F14 (Native Interceptor) + F4 (Data Blamer)', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  it('should intercept native storage mutations and automatically perform Data Blame attribution', () => {
    let capturedBlameInfo: DataBlameInfo | null = null;

    const onMutation = (mutation: StorageMutation, rawStack?: string) => {
      if (mutation.value) {
        capturedBlameInfo = getStorageDataBlame(mutation.key, mutation.value, rawStack);
      }
    };

    const interceptor = new StorageInterceptorAdapter(onMutation);
    interceptor.attach();

    localStorage.setItem('oauth_access_token', 'bearer_token_xyz');

    expect(capturedBlameInfo).not.toBeNull();
    if (capturedBlameInfo) {
      const blame: DataBlameInfo = capturedBlameInfo;
      expect(blame.key).toBe('oauth_access_token');
      expect(blame.actor.type).toBe('script');
      expect(blame.actor.name).toBeDefined();
      expect(blame.revisionCount).toBeGreaterThan(0);
    }

    interceptor.detach();
  });
});
