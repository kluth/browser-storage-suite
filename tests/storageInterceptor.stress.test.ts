import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { StorageInterceptorAdapter } from '../src/infrastructure/adapters/storageInterceptorAdapter';
import { StorageMutation } from '../utils/storageAggregate';
import { DataBlameRegistry } from '../utils/dataBlamer';

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

describe('StorageInterceptorAdapter — Adversarial Stress Test Suite', { timeout: 60000 }, () => {
  let originalSetItem: typeof Storage.prototype.setItem;
  let originalRemoveItem: typeof Storage.prototype.removeItem;
  let originalClear: typeof Storage.prototype.clear;

  beforeAll(() => {
    // Force detach any residual active instances from previous test files to ensure clean prototype baseline
    // @ts-ignore
    const activeInstances = StorageInterceptorAdapter['activeInstances'] as Set<StorageInterceptorAdapter>;
    if (activeInstances) {
      Array.from(activeInstances).forEach((inst) => inst.detach());
    }
    // @ts-ignore
    if (StorageInterceptorAdapter['isPatched']) {
      // @ts-ignore
      StorageInterceptorAdapter.unpatchPrototype();
    }

    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;
    originalClear = Storage.prototype.clear;
  });

  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    // Force detach active instances to avoid cross-test pollution
    // @ts-ignore
    const activeInstances = StorageInterceptorAdapter['activeInstances'] as Set<StorageInterceptorAdapter>;
    if (activeInstances) {
      Array.from(activeInstances).forEach((inst) => inst.detach());
    }
    // @ts-ignore
    if (StorageInterceptorAdapter['isPatched']) {
      // @ts-ignore
      StorageInterceptorAdapter.unpatchPrototype();
    }
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. High-Frequency Operations (10,000 rapid calls)
  // --------------------------------------------------------------------------
  describe('1. High-Frequency Rapid Operations', () => {
    it('should process 10,000 rapid setItem calls cleanly without missed mutations or memory corruption', () => {
      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));

      expect(adapter.attach().ok).toBe(true);

      const startTime = performance.now();
      const count = 10000;

      for (let i = 0; i < count; i++) {
        localStorage.setItem(`high_freq_key_${i}`, `val_${i}`);
      }

      const duration = performance.now() - startTime;

      expect(mutations.length).toBe(count);
      expect(localStorage.length).toBe(count);
      expect(localStorage.getItem('high_freq_key_0')).toBe('val_0');
      expect(localStorage.getItem('high_freq_key_9999')).toBe('val_9999');
      expect(mutations[0].key).toBe('high_freq_key_0');
      expect(mutations[9999].key).toBe('high_freq_key_9999');

      // Ensure high frequency executes efficiently (under 30000ms for 10k items with stack capture)
      expect(duration).toBeLessThan(30000);

      expect(adapter.detach().ok).toBe(true);
    });

    it('should process 10,000 rapid removeItem operations cleanly', () => {
      // Pre-seed storage
      for (let i = 0; i < 10000; i++) {
        localStorage.setItem(`del_key_${i}`, `v_${i}`);
      }

      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));
      adapter.attach();

      const count = 10000;
      for (let i = 0; i < count; i++) {
        localStorage.removeItem(`del_key_${i}`);
      }

      expect(mutations.length).toBe(count);
      expect(localStorage.length).toBe(0);
      expect(mutations[0].type).toBe('delete');
      expect(mutations[0].key).toBe('del_key_0');
      expect(mutations[9999].type).toBe('delete');

      adapter.detach();
    });

    it('should handle 1,000 rapid clear operations', () => {
      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));
      adapter.attach();

      const count = 1000;
      for (let i = 0; i < count; i++) {
        localStorage.setItem('temp', '1');
        localStorage.clear();
      }

      // 1000 setItem + 1000 clear = 2000 mutations
      expect(mutations.length).toBe(2000);
      expect(localStorage.length).toBe(0);

      adapter.detach();
    });

    it('should handle mixed high-frequency workload across localStorage and sessionStorage', () => {
      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));
      adapter.attach();

      for (let i = 0; i < 2500; i++) {
        localStorage.setItem(`l_key_${i}`, `v_${i}`);
        sessionStorage.setItem(`s_key_${i}`, `v_${i}`);
        localStorage.removeItem(`l_key_${i}`);
        sessionStorage.removeItem(`s_key_${i}`);
      }

      expect(mutations.length).toBe(10000);
      adapter.detach();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Recursive Re-Entrancy
  // --------------------------------------------------------------------------
  describe('2. Recursive Re-Entrancy', () => {
    it('should support mutation callback triggering storage operations 5 levels deep in stack', () => {
      const executionOrder: string[] = [];
      const maxDepth = 5;

      const adapter = new StorageInterceptorAdapter((mut) => {
        executionOrder.push(mut.key);

        if (mut.key.startsWith('depth_')) {
          const depth = parseInt(mut.key.split('_')[1], 10);
          if (depth < maxDepth) {
            localStorage.setItem(`depth_${depth + 1}`, `val_${depth + 1}`);
          }
        }
      });

      adapter.attach();

      localStorage.setItem('depth_1', 'val_1');

      // The execution chain:
      // level 1 setItem -> notifies -> callback sets level 2 -> notifies -> callback sets level 3 ... up to level 5
      expect(executionOrder).toEqual(['depth_1', 'depth_2', 'depth_3', 'depth_4', 'depth_5']);

      for (let i = 1; i <= maxDepth; i++) {
        expect(localStorage.getItem(`depth_${i}`)).toBe(`val_${i}`);
      }

      adapter.detach();
    });

    it('should handle recursive set, delete, and clear intermixed operations without stack overflow', () => {
      const log: string[] = [];

      const adapter = new StorageInterceptorAdapter((mut) => {
        log.push(`${mut.type}:${mut.key}`);

        if (mut.type === 'set' && mut.key === 'step1') {
          localStorage.setItem('step2', 'val2');
        } else if (mut.type === 'set' && mut.key === 'step2') {
          localStorage.removeItem('step1');
        } else if (mut.type === 'delete' && mut.key === 'step1') {
          localStorage.clear();
        }
      });

      adapter.attach();

      localStorage.setItem('step1', 'val1');

      expect(log).toEqual(['set:step1', 'set:step2', 'delete:step1', 'clear:']);
      expect(localStorage.length).toBe(0);

      adapter.detach();
    });

    it('should safely swallow callback exceptions during recursive execution without corrupting prototype state', () => {
      let callbackCalls = 0;

      const adapter = new StorageInterceptorAdapter((mut) => {
        callbackCalls++;
        if (mut.key === 'faulty') {
          throw new Error('Callback boom!');
        }
      });

      adapter.attach();

      // Calling setItem should NOT throw despite callback error
      expect(() => {
        localStorage.setItem('faulty', 'value');
      }).not.toThrow();

      expect(localStorage.getItem('faulty')).toBe('value');
      expect(callbackCalls).toBe(1);

      // Subsequent call should still work fine
      localStorage.setItem('normal', 'ok');
      expect(callbackCalls).toBe(2);

      adapter.detach();
    });

    it('should support deep re-entrancy up to 50 levels without recursion overflow', () => {
      const executionOrder: string[] = [];
      const maxDepth = 50;

      const adapter = new StorageInterceptorAdapter((mut) => {
        executionOrder.push(mut.key);
        if (mut.key.startsWith('deep_depth_')) {
          const depth = parseInt(mut.key.split('_')[2], 10);
          if (depth < maxDepth) {
            localStorage.setItem(`deep_depth_${depth + 1}`, `v_${depth + 1}`);
          }
        }
      });

      adapter.attach();
      localStorage.setItem('deep_depth_1', 'v_1');
      expect(executionOrder.length).toBe(50);
      expect(executionOrder[49]).toBe('deep_depth_50');
      for (let i = 1; i <= maxDepth; i++) {
        expect(localStorage.getItem(`deep_depth_${i}`)).toBe(`v_${i}`);
      }
      adapter.detach();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Concurrent Adapter Attachments & Detachments (Reference Counting)
  // --------------------------------------------------------------------------
  describe('3. Concurrent Adapter Attachments & Detachments', () => {
    it('should support multiple concurrent adapters receiving storage mutations', () => {
      const list1: StorageMutation[] = [];
      const list2: StorageMutation[] = [];
      const list3: StorageMutation[] = [];

      const adapter1 = new StorageInterceptorAdapter((mut) => list1.push(mut));
      const adapter2 = new StorageInterceptorAdapter((mut) => list2.push(mut));
      const adapter3 = new StorageInterceptorAdapter((mut) => list3.push(mut));

      adapter1.attach();
      adapter2.attach();
      adapter3.attach();

      localStorage.setItem('multi_key', 'multi_val');

      expect(list1).toHaveLength(1);
      expect(list2).toHaveLength(1);
      expect(list3).toHaveLength(1);
      expect(list1[0].key).toBe('multi_key');
      expect(list2[0].key).toBe('multi_key');
      expect(list3[0].key).toBe('multi_key');

      adapter1.detach();
      adapter2.detach();
      adapter3.detach();
    });

    it('should maintain prototype patch while at least one adapter remains attached', () => {
      const list1: StorageMutation[] = [];
      const list2: StorageMutation[] = [];

      const adapter1 = new StorageInterceptorAdapter((mut) => list1.push(mut));
      const adapter2 = new StorageInterceptorAdapter((mut) => list2.push(mut));

      adapter1.attach();
      adapter2.attach();

      // Detach adapter1 only
      adapter1.detach();

      localStorage.setItem('shared_key', 'val');

      // list1 should not get new events, list2 SHOULD get event
      expect(list1).toHaveLength(0);
      expect(list2).toHaveLength(1);

      // Prototype should still be patched because adapter2 is attached
      expect(Storage.prototype.setItem).not.toBe(originalSetItem);

      adapter2.detach();

      // Now prototype must be fully unpatched
      expect(Storage.prototype.setItem).toBe(originalSetItem);
    });

    it('should handle repeated attach/detach cycles on multiple instances cleanly', () => {
      const adapters = Array.from({ length: 10 }, (_, i) => {
        return new StorageInterceptorAdapter(() => {});
      });

      // Attach all 10
      adapters.forEach((a) => expect(a.attach().ok).toBe(true));
      expect(Storage.prototype.setItem).not.toBe(originalSetItem);

      // Detach first 5
      for (let i = 0; i < 5; i++) {
        expect(adapters[i].detach().ok).toBe(true);
      }
      expect(Storage.prototype.setItem).not.toBe(originalSetItem);

      // Re-attach first 5
      for (let i = 0; i < 5; i++) {
        expect(adapters[i].attach().ok).toBe(true);
      }
      expect(Storage.prototype.setItem).not.toBe(originalSetItem);

      // Detach all 10
      adapters.forEach((a) => expect(a.detach().ok).toBe(true));

      // Must be unpatched now
      expect(Storage.prototype.setItem).toBe(originalSetItem);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Unpatching Idempotency & Native Restoration
  // --------------------------------------------------------------------------
  describe('4. Unpatching Idempotency & Native Restoration', () => {
    it('should be 100% restored to original native prototype references after detach', () => {
      const adapter = new StorageInterceptorAdapter(() => {});

      adapter.attach();
      expect(Storage.prototype.setItem).not.toBe(originalSetItem);
      expect(Storage.prototype.removeItem).not.toBe(originalRemoveItem);
      expect(Storage.prototype.clear).not.toBe(originalClear);

      adapter.detach();

      expect(Storage.prototype.setItem).toBe(originalSetItem);
      expect(Storage.prototype.removeItem).toBe(originalRemoveItem);
      expect(Storage.prototype.clear).toBe(originalClear);
    });

    it('should handle redundant attach calls on the same adapter idempotently', () => {
      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));

      // Attach 3 times
      expect(adapter.attach().ok).toBe(true);
      expect(adapter.attach().ok).toBe(true);
      expect(adapter.attach().ok).toBe(true);

      localStorage.setItem('key_redundant_attach', 'val');

      // Should only deliver mutation ONCE (not 3 times)
      expect(mutations).toHaveLength(1);

      // Single detach should unpatch cleanly
      expect(adapter.detach().ok).toBe(true);
      expect(Storage.prototype.setItem).toBe(originalSetItem);
    });

    it('should handle redundant detach calls on the same adapter idempotently', () => {
      const adapter = new StorageInterceptorAdapter(() => {});

      adapter.attach();
      expect(adapter.detach().ok).toBe(true);
      expect(adapter.detach().ok).toBe(true); // Redundant call
      expect(adapter.detach().ok).toBe(true); // Redundant call

      expect(Storage.prototype.setItem).toBe(originalSetItem);
    });

    it('should restore prototype even if detach is called without attach', () => {
      const adapter = new StorageInterceptorAdapter(() => {});
      expect(adapter.detach().ok).toBe(true);
      expect(Storage.prototype.setItem).toBe(originalSetItem);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Edge Cases & Boundary Values
  // --------------------------------------------------------------------------
  describe('5. Edge Cases & Special Arguments', () => {
    it('should handle empty key, special character keys, and very large values', () => {
      const mutations: StorageMutation[] = [];
      const adapter = new StorageInterceptorAdapter((mut) => mutations.push(mut));
      adapter.attach();

      const largeValue = 'x'.repeat(100000); // 100KB string
      const specialKey = 'key_!@#$%^&*()_+~`|}{[]:;?><,./"\'\\';

      localStorage.setItem('', 'empty_key_val');
      localStorage.setItem(specialKey, largeValue);

      expect(mutations).toHaveLength(2);
      expect(mutations[0].key).toBe('');
      expect(mutations[1].key).toBe(specialKey);
      expect(mutations[1].value?.length).toBe(100000);

      adapter.detach();
    });

    it('should preserve function invocation context (this binding)', () => {
      const adapter = new StorageInterceptorAdapter(() => {});
      adapter.attach();

      // Direct method invocation with explicit .call()
      Storage.prototype.setItem.call(localStorage, 'explicit_this_key', 'explicit_this_val');
      expect(localStorage.getItem('explicit_this_key')).toBe('explicit_this_val');

      adapter.detach();
    });
  });
});
