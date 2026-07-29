import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageInterceptorAdapter } from '../src/infrastructure/adapters/storageInterceptorAdapter';
import { StorageMutation } from '../utils/storageAggregate';
import { DataBlameRegistry } from '../utils/dataBlamer';
import { Result } from '../utils/result';

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

describe('StorageInterceptorAdapter (Native Storage Proxy & Event Engine)', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should intercept native localStorage.setItem and record mutation with callstack', () => {
    const mutations: StorageMutation[] = [];
    const rawStacks: string[] = [];

    const adapter = new StorageInterceptorAdapter((mut, rawStack) => {
      mutations.push(mut);
      if (rawStack) rawStacks.push(rawStack);
    });

    const attachRes = adapter.attach();
    expect(attachRes.ok).toBe(true);

    localStorage.setItem('intercepted_key', 'intercepted_val');

    expect(localStorage.getItem('intercepted_key')).toBe('intercepted_val');
    expect(mutations).toHaveLength(1);
    expect(mutations[0].type).toBe('set');
    expect(mutations[0].key).toBe('intercepted_key');
    expect(mutations[0].value).toBe('intercepted_val');
    expect(rawStacks.length).toBeGreaterThan(0);
    expect(typeof rawStacks[0]).toBe('string');

    const detachRes = adapter.detach();
    expect(detachRes.ok).toBe(true);
  });

  it('should intercept native localStorage.removeItem and clear operations', () => {
    const mutations: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));

    adapter.attach();

    localStorage.setItem('k1', 'v1');
    localStorage.removeItem('k1');
    localStorage.clear();

    expect(mutations).toHaveLength(3);
    expect(mutations[1].type).toBe('delete');
    expect(mutations[1].key).toBe('k1');
    expect(mutations[2].type).toBe('clear');

    adapter.detach();
  });

  it('should restore original native Storage.prototype methods cleanly after detach()', () => {
    const mutations: StorageMutation[] = [];
    const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));

    adapter.attach();
    adapter.detach();

    localStorage.setItem('post_detach_key', 'val');

    expect(localStorage.getItem('post_detach_key')).toBe('val');
    expect(mutations).toHaveLength(0);
  });

  it('should prevent infinite recursion loops via re-entrancy guard', () => {
    let reentrantCallCount = 0;
    const adapter = new StorageInterceptorAdapter((mut) => {
      if (mut.key === 'outer_key') {
        reentrantCallCount++;
        localStorage.setItem('nested_key', 'nested_val');
      }
    });

    adapter.attach();
    localStorage.setItem('outer_key', 'outer_val');

    expect(localStorage.getItem('outer_key')).toBe('outer_val');
    expect(localStorage.getItem('nested_key')).toBe('nested_val');
    expect(reentrantCallCount).toBe(1);

    adapter.detach();
  });

  it('should maintain backward compatibility with synthetic CustomEvent listeners', () => {
    const mockCallback = vi.fn();
    const eventTarget = new EventTarget();
    const adapter = new StorageInterceptorAdapter(mockCallback, eventTarget);

    adapter.attach();

    const customEvent = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: {
        id: 'evt-1',
        timestamp: 2000,
        type: 'set' as const,
        storageType: 'localStorage' as const,
        key: 'authToken',
        value: 'jwt_secret_99',
      },
    });

    eventTarget.dispatchEvent(customEvent);

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback.mock.calls[0][0].key).toBe('authToken');

    adapter.detach();
  });

  it('should clean up activeInstances and customListener when patchPrototype fails', () => {
    const mockCallback = vi.fn();
    const eventTarget = new EventTarget();
    const adapter = new StorageInterceptorAdapter(mockCallback, eventTarget);

    const spy = vi.spyOn(StorageInterceptorAdapter as any, 'patchPrototype').mockReturnValue(
      Result.err({
        code: 'PROPERTY_NON_CONFIGURABLE',
        message: 'Mocked prototype patch failure',
      })
    );

    const attachRes = adapter.attach();
    expect(attachRes.ok).toBe(false);

    // Verify customListener was cleaned up by dispatching custom event (callback should NOT be invoked)
    const customEvent = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: {
        id: 'evt-fail',
        timestamp: Date.now(),
        type: 'set' as const,
        storageType: 'localStorage' as const,
        key: 'fail_key',
        value: 'fail_val',
      },
    });
    eventTarget.dispatchEvent(customEvent);
    expect(mockCallback).not.toHaveBeenCalled();

    // Verify activeInstances was cleaned up by restoring spy and re-attaching
    spy.mockRestore();
    const secondAttach = adapter.attach();
    expect(secondAttach.ok).toBe(true);
    adapter.detach();
  });
});
