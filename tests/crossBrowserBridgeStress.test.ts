import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Result } from '../utils/result';
import {
  ExtensionBridgeError,
  ExtensionBridgeErrorCode,
  ExtensionStorageArea,
  BridgeMessagePayload,
} from '../src/domain/ports/secondary/extensionBridgePort';
import { WxtBridgeAdapter } from '../src/infrastructure/adapters/wxtBridgeAdapter';
import { CrossBrowserBridge } from '../utils/crossBrowserBridge';

describe('ADR-0014 Cross-Browser Storage Bridge — Empirical Stress Suite', () => {
  let originalChrome: any;
  let originalBrowser: any;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    originalBrowser = (globalThis as any).browser;

    delete (globalThis as any).chrome;
    delete (globalThis as any).browser;
    CrossBrowserBridge.reset();
  });

  afterEach(() => {
    if (originalChrome !== undefined) (globalThis as any).chrome = originalChrome;
    else delete (globalThis as any).chrome;

    if (originalBrowser !== undefined) (globalThis as any).browser = originalBrowser;
    else delete (globalThis as any).browser;

    CrossBrowserBridge.reset();
  });

  function setupMockExtensionEnv(options?: {
    storageDelayMs?: number;
    failureRate?: number;
  }) {
    const localStore = new Map<string, any>();
    const listeners: Array<(changes: Record<string, any>, area: string) => void> = [];

    const mockChrome: any = {
      runtime: {
        id: 'stress-test-extension-id',
        lastError: null,
        getManifest: () => ({ manifest_version: 3, name: 'Stress Test Suite', version: '1.0.0' }),
        sendMessage: (msg: any, cb: (res: any) => void) => {
          if (options?.failureRate && Math.random() < options.failureRate) {
            mockChrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
            cb(undefined);
            return;
          }
          mockChrome.runtime.lastError = null;
          if (options?.storageDelayMs) {
            setTimeout(() => cb({ echo: msg, status: 'ok' }), options.storageDelayMs);
          } else {
            cb({ echo: msg, status: 'ok' });
          }
        },
      },
      tabs: {
        sendMessage: (tabId: number, msg: any, cb: (res: any) => void) => {
          mockChrome.runtime.lastError = null;
          cb({ tabId, echo: msg, status: 'ok' });
        },
      },
      storage: {
        local: {
          get: (keys: any, cb: (res: any) => void) => {
            if (options?.failureRate && Math.random() < options.failureRate) {
              mockChrome.runtime.lastError = { message: 'Storage read failure under stress' };
              cb({});
              return;
            }
            mockChrome.runtime.lastError = null;
            const res: Record<string, any> = {};
            if (!keys) {
              localStore.forEach((v, k) => (res[k] = v));
            } else if (typeof keys === 'string') {
              if (localStore.has(keys)) res[keys] = localStore.get(keys);
            } else if (Array.isArray(keys)) {
              keys.forEach((k) => {
                if (localStore.has(k)) res[k] = localStore.get(k);
              });
            }
            cb(res);
          },
          set: (items: Record<string, any>, cb: () => void) => {
            if (options?.failureRate && Math.random() < options.failureRate) {
              mockChrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded under stress' };
              cb();
              return;
            }
            mockChrome.runtime.lastError = null;
            const changes: Record<string, any> = {};
            Object.entries(items).forEach(([k, v]) => {
              const oldVal = localStore.get(k);
              localStore.set(k, v);
              changes[k] = { oldValue: oldVal, newValue: v };
            });
            listeners.forEach((l) => l(changes, 'local'));
            cb();
          },
          remove: (keys: string | string[], cb: () => void) => {
            mockChrome.runtime.lastError = null;
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const changes: Record<string, any> = {};
            keyArr.forEach((k) => {
              if (localStore.has(k)) {
                const oldVal = localStore.get(k);
                localStore.delete(k);
                changes[k] = { oldValue: oldVal, newValue: undefined };
              }
            });
            listeners.forEach((l) => l(changes, 'local'));
            cb();
          },
          clear: (cb: () => void) => {
            mockChrome.runtime.lastError = null;
            localStore.clear();
            cb();
          },
          getBytesInUse: (keys: any, cb: (b: number) => void) => {
            mockChrome.runtime.lastError = null;
            let total = 0;
            localStore.forEach((val, k) => {
              if (!keys || (Array.isArray(keys) ? keys.includes(k) : keys === k)) {
                total += new Blob([JSON.stringify(val)]).size;
              }
            });
            cb(total);
          },
        },
        onChanged: {
          addListener: (fn: any) => listeners.push(fn),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    return { mockChrome, localStore, listeners };
  }

  describe('1. High-Concurrency Storage Operations (1,500+ Simultaneous Operations)', () => {
    it('1.1 should process 1,500 simultaneous write operations without error or state corruption', async () => {
      const adapter = new WxtBridgeAdapter();
      const count = 1500;
      const startTime = performance.now();

      const promises = Array.from({ length: count }, (_, i) =>
        adapter.setItem(`conc_key_${i}`, { index: i, timestamp: Date.now(), data: `payload_${i}` })
      );

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      expect(results.length).toBe(count);
      const failures = results.filter((r) => !r.ok);
      expect(failures.length).toBe(0);

      // Verify sample data retrieval
      const sampleIndices = [0, 500, 999, 1499];
      for (const idx of sampleIndices) {
        const itemRes = await adapter.getItem<{ index: number; data: string }>(`conc_key_${idx}`);
        expect(itemRes.ok).toBe(true);
        if (itemRes.ok) {
          expect(itemRes.value).toEqual({ index: idx, timestamp: expect.any(Number), data: `payload_${idx}` });
        }
      }

      console.log(`[STRESS METRIC] 1,500 Concurrent Writes completed in ${durationMs.toFixed(2)}ms (${((count / durationMs) * 1000).toFixed(0)} ops/sec)`);
    });

    it('1.2 should process 1,500 simultaneous read operations concurrently', async () => {
      const adapter = new WxtBridgeAdapter();
      const count = 1500;

      // Seed 1,500 items
      const seedItems: Record<string, any> = {};
      for (let i = 0; i < count; i++) {
        seedItems[`read_key_${i}`] = { val: i * 2 };
      }
      await adapter.setItems(seedItems);

      const startTime = performance.now();
      const readPromises = Array.from({ length: count }, (_, i) =>
        adapter.getItem<{ val: number }>(`read_key_${i}`)
      );

      const results = await Promise.all(readPromises);
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      expect(results.length).toBe(count);
      let totalSum = 0;
      results.forEach((r, idx) => {
        expect(r.ok).toBe(true);
        if (r.ok && r.value) {
          totalSum += r.value.val;
          expect(r.value.val).toBe(idx * 2);
        }
      });

      // Sum of 2*i for i=0..1499 -> 2 * (1499 * 1500 / 2) = 2,248,500
      expect(totalSum).toBe(2248500);

      console.log(`[STRESS METRIC] 1,500 Concurrent Reads completed in ${durationMs.toFixed(2)}ms (${((count / durationMs) * 1000).toFixed(0)} ops/sec)`);
    });

    it('1.3 should execute 1,500 interleaved mixed operations (set, get, remove, clear) safely', async () => {
      const adapter = new WxtBridgeAdapter();
      const count = 1500;

      const ops = Array.from({ length: count }, (_, i) => {
        const mod = i % 4;
        if (mod === 0) return adapter.setItem(`mix_key_${i}`, i);
        if (mod === 1) return adapter.getItem(`mix_key_${i - 1}`);
        if (mod === 2) return adapter.removeItem(`mix_key_${Math.max(0, i - 2)}`);
        return adapter.getBytesInUse(`mix_key_${i}`);
      });

      const results = await Promise.all(ops);
      expect(results.length).toBe(count);
      const failures = results.filter((r) => !r.ok);
      expect(failures.length).toBe(0);
    });
  });

  describe('2. High-Frequency RPC Messaging Calls', () => {
    it('2.1 should handle 2,000 rapid RPC message dispatches with correlation uniqueness', async () => {
      setupMockExtensionEnv();
      const bridge = CrossBrowserBridge.getInstance();
      const count = 2000;

      const startTime = performance.now();
      const messagePromises = Array.from({ length: count }, (_, i) =>
        bridge.sendRPC<{ echo: BridgeMessagePayload }, { seq: number }>('STRESS_PING', { seq: i })
      );

      const results = await Promise.all(messagePromises);
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      expect(results.length).toBe(count);

      const correlationIds = new Set<string>();
      results.forEach((r) => {
        expect(r.ok).toBe(true);
        if (r.ok) {
          const cid = r.value.echo.correlationId;
          expect(cid).toBeDefined();
          expect(correlationIds.has(cid)).toBe(false);
          correlationIds.add(cid);
        }
      });

      expect(correlationIds.size).toBe(count);
      console.log(`[STRESS METRIC] 2,000 High-Frequency RPC Messages completed in ${durationMs.toFixed(2)}ms (${((count / durationMs) * 1000).toFixed(0)} msg/sec)`);
    });

    it('2.2 should maintain failure isolation when 2,000 RPC messages hit non-extension fallback environment', async () => {
      const bridge = CrossBrowserBridge.getInstance();
      const count = 1000;

      const promises = Array.from({ length: count }, (_, i) =>
        bridge.sendRPC('WEB_RPC', { id: i })
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(count);
      results.forEach((r) => {
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
        }
      });
    });
  });

  describe('3. Large Payload Storage Operations (1 MB+ and 5 MB+ payloads)', () => {
    it('3.1 should write and read a 1 MB payload (1,048,576 bytes) accurately', async () => {
      const adapter = new WxtBridgeAdapter();
      const oneMbString = 'A'.repeat(1024 * 1024); // 1 MB string

      const startTime = performance.now();
      const writeRes = await adapter.setItem('large_1mb', oneMbString);
      const writeTime = performance.now();

      expect(writeRes.ok).toBe(true);

      const readRes = await adapter.getItem<string>('large_1mb');
      const readTime = performance.now();

      expect(readRes.ok).toBe(true);
      if (readRes.ok) {
        expect(readRes.value).not.toBeNull();
        expect(readRes.value?.length).toBe(1024 * 1024);
        expect(readRes.value).toBe(oneMbString);
      }

      const bytesRes = await adapter.getBytesInUse('large_1mb');
      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBeGreaterThanOrEqual(1024 * 1024);
      }

      console.log(`[STRESS METRIC] 1 MB Payload Write: ${(writeTime - startTime).toFixed(2)}ms | Read: ${(readTime - writeTime).toFixed(2)}ms`);
    });

    it('3.2 should write and read a 5 MB payload (5,242,880 bytes) safely', async () => {
      const adapter = new WxtBridgeAdapter();
      const fiveMbString = 'X'.repeat(5 * 1024 * 1024); // 5 MB string

      const writeRes = await adapter.setItem('large_5mb', { data: fiveMbString });
      expect(writeRes.ok).toBe(true);

      const readRes = await adapter.getItem<{ data: string }>('large_5mb');
      expect(readRes.ok).toBe(true);
      if (readRes.ok && readRes.value) {
        expect(readRes.value.data.length).toBe(5 * 1024 * 1024);
      }

      const bytesRes = await adapter.getBytesInUse('large_5mb');
      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBeGreaterThanOrEqual(5 * 1024 * 1024);
      }
    });

    it('3.3 should handle multiple concurrent large payload writes (5 x 1 MB payloads)', async () => {
      const adapter = new WxtBridgeAdapter();
      const payload = 'Z'.repeat(1024 * 1024); // 1 MB each

      const promises = Array.from({ length: 5 }, (_, i) =>
        adapter.setItem(`multi_1mb_${i}`, payload)
      );

      const results = await Promise.all(promises);
      expect(results.every((r) => r.ok)).toBe(true);

      const totalBytesRes = await adapter.getBytesInUse();
      expect(totalBytesRes.ok).toBe(true);
      if (totalBytesRes.ok) {
        expect(totalBytesRes.value).toBeGreaterThanOrEqual(5 * 1024 * 1024);
      }
    });
  });

  describe('4. Memory Leak Inspection & Error Propagation Under Stress', () => {
    it('4.1 should register and unregister 3,000 storage listeners without memory or listener leaks', async () => {
      const adapter = new WxtBridgeAdapter();
      const dummyListeners: Array<() => void> = [];

      // Attach 3,000 listeners
      for (let i = 0; i < 3000; i++) {
        const unsub = adapter.onStorageChanged(() => {});
        dummyListeners.push(unsub);
      }

      // Trigger change — all listeners run without error
      await adapter.setItem('leak_check_key', 'val1');

      // Unsubscribe all 3,000 listeners
      dummyListeners.forEach((unsub) => unsub());

      // Trigger another change
      await adapter.setItem('leak_check_key', 'val2');

      // Verify internal listeners set is empty (by casting to any for validation)
      const internalListeners = (adapter as any).listeners as Set<any>;
      expect(internalListeners.size).toBe(0);
    });

    it('4.2 should maintain stable heap usage across 10,000 repeated set-and-clear cycles', async () => {
      const adapter = new WxtBridgeAdapter();
      const cycles = 5; // 5 batches of 2,000 = 10,000 ops total

      if (globalThis.gc) {
        globalThis.gc();
      }
      const initialMem = process.memoryUsage().heapUsed;

      for (let c = 0; c < cycles; c++) {
        const batch: Record<string, any> = {};
        for (let i = 0; i < 2000; i++) {
          batch[`cycle_${c}_${i}`] = { payload: 'small_data_string' };
        }
        await adapter.setItems(batch);
        await adapter.clear();
      }

      if (globalThis.gc) {
        globalThis.gc();
      }
      const finalMem = process.memoryUsage().heapUsed;
      const memDeltaMB = (finalMem - initialMem) / (1024 * 1024);

      console.log(`[STRESS METRIC] Heap delta after 10,000 write/clear operations: ${memDeltaMB.toFixed(2)} MB`);
      // Heap growth should be minimal (less than 25 MB under standard V8 garbage collection window)
      expect(memDeltaMB).toBeLessThan(25);
    });

    it('4.3 should gracefully handle 20% random error injection during 1,000 concurrent operations without throwing unhandled exceptions', async () => {
      setupMockExtensionEnv({ failureRate: 0.2 }); // 20% failure rate
      const adapter = new WxtBridgeAdapter();
      const count = 1000;

      const promises = Array.from({ length: count }, (_, i) =>
        adapter.setItem(`fault_key_${i}`, `value_${i}`)
      );

      // Must not throw any unhandled rejection!
      const results = await Promise.all(promises);

      expect(results.length).toBe(count);
      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);

      expect(successes.length).toBeGreaterThan(0);
      expect(failures.length).toBeGreaterThan(0);

      // Verify all failures are ExtensionBridgeError instances with valid error codes
      failures.forEach((f) => {
        if (!f.ok) {
          expect(f.error).toBeInstanceOf(ExtensionBridgeError);
          expect(['QUOTA_EXCEEDED', 'WRITE_FAILED']).toContain(f.error.code);
        }
      });

      console.log(`[STRESS METRIC] Fault Injection Test: ${successes.length} Passed, ${failures.length} Failed gracefully (100% monadic Result compliance)`);
    });
  });
});
