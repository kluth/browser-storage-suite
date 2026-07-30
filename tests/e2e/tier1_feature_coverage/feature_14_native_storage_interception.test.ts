import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageInterceptorAdapter } from '../../../src/infrastructure/adapters/storageInterceptorAdapter';
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

describe('Feature 14: Native Storage Interception Adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('14.1 should attach native Storage.prototype proxy and receive storage mutations', () => {
    const mutationsReceived: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((mut) => {
      mutationsReceived.push(mut);
    });

    const attachResult = adapter.attach();
    expect(attachResult.ok).toBe(true);

    localStorage.setItem('intercepted_key', 'intercepted_val');

    expect(mutationsReceived).toHaveLength(1);
    expect(mutationsReceived[0].key).toBe('intercepted_key');
    expect(mutationsReceived[0].value).toBe('intercepted_val');

    adapter.detach();
  });

  it('14.2 should stop receiving native mutations after calling detach()', () => {
    const mutationsReceived: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((mut) => {
      mutationsReceived.push(mut);
    });

    adapter.attach();
    adapter.detach();

    localStorage.setItem('deleted_key', 'val');

    expect(mutationsReceived).toHaveLength(0);
  });

  it('14.3 should prevent duplicate listener registration when attach() is called multiple times', () => {
    const mutationsReceived: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((mut) => {
      mutationsReceived.push(mut);
    });

    adapter.attach();
    adapter.attach();
    adapter.attach();

    localStorage.setItem('multi_key', 'multi_val');

    expect(mutationsReceived).toHaveLength(1);

    adapter.detach();
  });

  it('14.4 should handle CustomEvents with detail and ignore events without detail', () => {
    const target = new EventTarget();
    const callback = vi.fn();

    const adapter = new StorageInterceptorAdapter(callback, target);
    adapter.attach();

    const emptyEvent = new Event('__STORAGE_SUITE_INTERCEPT__');
    target.dispatchEvent(emptyEvent);
    expect(callback).not.toHaveBeenCalled();

    const detailEvent = new CustomEvent('__STORAGE_SUITE_INTERCEPT__', {
      detail: {
        id: '1',
        timestamp: 100,
        type: 'set',
        storageType: 'localStorage',
        key: 'k',
        value: 'v',
      },
    });
    target.dispatchEvent(detailEvent);
    expect(callback).toHaveBeenCalledTimes(1);

    adapter.detach();
  });

  it('14.5 should handle detach() safely even if attach() was never invoked', () => {
    const adapter = new StorageInterceptorAdapter(() => {});
    expect(() => adapter.detach()).not.toThrow();
  });

  it('14.6 should fallback gracefully when window / globalThis is provided as target', () => {
    const fakeWindow = new EventTarget();
    vi.stubGlobal('window', fakeWindow);

    const mutations: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((m) => mutations.push(m));

    adapter.attach();

    const event = new CustomEvent('__STORAGE_SUITE_INTERCEPT__', {
      detail: {
        id: 'global_1',
        timestamp: 100,
        type: 'set',
        storageType: 'localStorage',
        key: 'gkey',
        value: 'gval',
      },
    });
    fakeWindow.dispatchEvent(event);

    expect(mutations).toHaveLength(1);
    expect(mutations[0].key).toBe('gkey');

    adapter.detach();
    vi.unstubAllGlobals();
  });
});
