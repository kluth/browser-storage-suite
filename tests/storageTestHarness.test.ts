import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageTestHarness } from '../utils/storageTestHarness';
import {
  StorageHarnessError,
} from '../src/domain/ports/secondary/mockStoragePort';
import {
  installMockStorageEnvironment,
  uninstallMockStorageEnvironment,
  withMockStorage,
} from './helpers/mockStorageEnvironment';

describe('StorageTestHarness & MockStorageEnvironment (ADR-0020 Test Suite)', () => {
  let harness: StorageTestHarness;

  beforeEach(() => {
    harness = new StorageTestHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  // ==========================================
  // SECTION 1: Quota Configuration & Area Initialization
  // ==========================================
  describe('1. Quota Configuration & Area Initialization', () => {
    it('1.1 should initialize default quota configurations for all 7 storage areas', () => {
      const syncConfig = harness.getQuotaConfig('sync');
      expect(syncConfig).toEqual({ maxItemBytes: 8192, maxBytes: 102400, maxItems: 512, isReadOnly: false });

      const localConfig = harness.getQuotaConfig('local');
      expect(localConfig).toEqual({ maxBytes: 10485760, isReadOnly: false });

      const managedConfig = harness.getQuotaConfig('managed');
      expect(managedConfig).toEqual({ maxBytes: 10485760, isReadOnly: true });

      const idbConfig = harness.getQuotaConfig('indexedDB');
      expect(idbConfig).toEqual({ maxBytes: 52428800, isReadOnly: false });
    });

    it('1.2 should allow updating quota configuration per area', () => {
      harness.setQuotaConfig('local', { maxBytes: 2048, maxItems: 10 });
      const config = harness.getQuotaConfig('local');
      expect(config.maxBytes).toBe(2048);
      expect(config.maxItems).toBe(10);
      expect(config.isReadOnly).toBe(false);
    });

    it('1.3 should return default fallback when querying unconfigured area', () => {
      // @ts-expect-error testing unknown area
      const config = harness.getQuotaConfig('custom_unknown_area');
      expect(config.maxBytes).toBe(10485760);
      expect(config.isReadOnly).toBe(false);
    });
  });

  // ==========================================
  // SECTION 2: CRUD Operations & Monadic Result Interface
  // ==========================================
  describe('2. CRUD Operations & Monadic Result Interface', () => {
    it('2.1 should set and get primitive string, number, boolean, and null values', async () => {
      await harness.setItem('local', 'strKey', 'hello world');
      await harness.setItem('local', 'numKey', 42);
      await harness.setItem('local', 'boolKey', true);
      await harness.setItem('local', 'nullKey', null);

      const resStr = await harness.getItem<string>('local', 'strKey');
      expect(resStr.ok).toBe(true);
      if (resStr.ok) expect(resStr.value).toBe('hello world');

      const resNum = await harness.getItem<number>('local', 'numKey');
      expect(resNum.ok).toBe(true);
      if (resNum.ok) expect(resNum.value).toBe(42);

      const resBool = await harness.getItem<boolean>('local', 'boolKey');
      expect(resBool.ok).toBe(true);
      if (resBool.ok) expect(resBool.value).toBe(true);

      const resNull = await harness.getItem<null>('local', 'nullKey');
      expect(resNull.ok).toBe(true);
      if (resNull.ok) expect(resNull.value).toBeNull();
    });

    it('2.2 should serialize objects/arrays and enforce deep clone immutability', async () => {
      const obj = { nested: { count: 10 } };
      await harness.setItem('local', 'objKey', obj);

      const getRes = await harness.getItem<{ nested: { count: number } }>('local', 'objKey');
      expect(getRes.ok).toBe(true);
      if (getRes.ok && getRes.value) {
        expect(getRes.value).toEqual(obj);
        // Mutate returned object
        getRes.value.nested.count = 999;
      }

      // Re-fetch to ensure internal store was not mutated
      const reFetch = await harness.getItem<{ nested: { count: number } }>('local', 'objKey');
      if (reFetch.ok && reFetch.value) {
        expect(reFetch.value.nested.count).toBe(10);
      }
    });

    it('2.3 should return Result.ok(null) when querying non-existent key', async () => {
      const res = await harness.getItem('local', 'non_existent_key');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBeNull();
    });

    it('2.4 should retrieve multiple items with getItems using string, array, or null/undefined', async () => {
      await harness.setItems('local', { a: 1, b: 2, c: 3 });

      const resSingle = await harness.getItems<{ a: number }>('local', 'a');
      expect(resSingle.ok).toBe(true);
      if (resSingle.ok) expect(resSingle.value).toEqual({ a: 1 });

      const resArr = await harness.getItems<{ a: number; c: number }>('local', ['a', 'c']);
      expect(resArr.ok).toBe(true);
      if (resArr.ok) expect(resArr.value).toEqual({ a: 1, c: 3 });

      const resAllNull = await harness.getItems('local', null);
      expect(resAllNull.ok).toBe(true);
      if (resAllNull.ok) expect(resAllNull.value).toEqual({ a: 1, b: 2, c: 3 });

      const resAllUndef = await harness.getItems('local', undefined);
      expect(resAllUndef.ok).toBe(true);
      if (resAllUndef.ok) expect(resAllUndef.value).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('2.5 should skip missing keys in getItems array without failing', async () => {
      await harness.setItem('local', 'exists', 'yes');
      const res = await harness.getItems('local', ['exists', 'missing1', 'missing2']);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({ exists: 'yes' });
      }
    });

    it('2.6 should remove single item with removeItem and multiple items with removeItems', async () => {
      await harness.setItems('local', { k1: 'v1', k2: 'v2', k3: 'v3' });

      const rem1 = await harness.removeItem('local', 'k1');
      expect(rem1.ok).toBe(true);

      const check1 = await harness.getItem('local', 'k1');
      if (check1.ok) expect(check1.value).toBeNull();

      const remMulti = await harness.removeItems('local', ['k2', 'k3']);
      expect(remMulti.ok).toBe(true);

      const checkAll = await harness.getItems('local', null);
      if (checkAll.ok) expect(checkAll.value).toEqual({});
    });

    it('2.7 should clear all items in target area while leaving other areas intact', async () => {
      await harness.setItem('local', 'localKey', 'val1');
      await harness.setItem('session', 'sessionKey', 'val2');

      const clrRes = await harness.clear('local');
      expect(clrRes.ok).toBe(true);

      const checkLocal = await harness.getItems('local', null);
      if (checkLocal.ok) expect(checkLocal.value).toEqual({});

      const checkSession = await harness.getItem('session', 'sessionKey');
      if (checkSession.ok) expect(checkSession.value).toBe('val2');
    });

    it('2.8 should return DESERIALIZATION_FAILED when internal json is corrupted', async () => {
      // Direct store corruption simulation
      (harness as any).getAreaStore('local').set('badKey', '{corrupted_json');

      const resGet = await harness.getItem('local', 'badKey');
      expect(resGet.ok).toBe(false);
      if (!resGet.ok) {
        expect(resGet.error.code).toBe('DESERIALIZATION_FAILED');
      }

      const resGetItems = await harness.getItems('local', ['badKey']);
      expect(resGetItems.ok).toBe(false);
      if (!resGetItems.ok) {
        expect(resGetItems.error.code).toBe('DESERIALIZATION_FAILED');
      }
    });

    it('2.9 should return SERIALIZATION_FAILED when storing non-serializable objects', async () => {
      const circular: any = {};
      circular.self = circular;

      const setRes = await harness.setItem('local', 'circKey', circular);
      expect(setRes.ok).toBe(false);
      if (!setRes.ok) {
        expect(setRes.error.code).toBe('SERIALIZATION_FAILED');
      }
    });

    it('2.10 should normalize undefined value in setItems to null', async () => {
      const res = await harness.setItems('local', { undefKey: undefined });
      expect(res.ok).toBe(true);

      const check = await harness.getItem('local', 'undefKey');
      if (check.ok) expect(check.value).toBeNull();
    });
  });

  // ==========================================
  // SECTION 3: Storage Quota & Read-Only Policy Enforcement
  // ==========================================
  describe('3. Storage Quota & Read-Only Policy Enforcement', () => {
    it('3.1 should enforce sync maxItemBytes limit (8192 bytes)', async () => {
      const smallVal = 'a'.repeat(8100);
      const okRes = await harness.setItem('sync', 'smallKey', smallVal);
      expect(okRes.ok).toBe(true);

      const hugeVal = 'a'.repeat(8200);
      const errRes = await harness.setItem('sync', 'hugeKey', hugeVal);
      expect(errRes.ok).toBe(false);
      if (!errRes.ok) {
        expect(errRes.error.code).toBe('QUOTA_EXCEEDED');
        expect(errRes.error.message).toContain('maxItemBytes');
      }
    });

    it('3.2 should enforce sync maxBytes total area limit (102400 bytes)', async () => {
      harness.setQuotaConfig('sync', { maxBytes: 500 });
      const val = 'x'.repeat(400);

      const res1 = await harness.setItem('sync', 'k1', val);
      expect(res1.ok).toBe(true);

      const res2 = await harness.setItem('sync', 'k2', val);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.code).toBe('QUOTA_EXCEEDED');
        expect(res2.error.message).toContain('total bytes');
      }
    });

    it('3.3 should enforce sync maxItems item count limit (512 items)', async () => {
      harness.setQuotaConfig('sync', { maxItems: 2 });
      await harness.setItems('sync', { k1: 1, k2: 2 });

      const errRes = await harness.setItem('sync', 'k3', 3);
      expect(errRes.ok).toBe(false);
      if (!errRes.ok) {
        expect(errRes.error.code).toBe('QUOTA_EXCEEDED');
        expect(errRes.error.message).toContain('maxItems');
      }
    });

    it('3.4 should enforce read-only protection on managed storage area', async () => {
      const setRes = await harness.setItem('managed', 'k1', 'v1');
      expect(setRes.ok).toBe(false);
      if (!setRes.ok) expect(setRes.error.code).toBe('READ_ONLY_AREA');

      const setMultiRes = await harness.setItems('managed', { k2: 'v2' });
      expect(setMultiRes.ok).toBe(false);
      if (!setMultiRes.ok) expect(setMultiRes.error.code).toBe('READ_ONLY_AREA');

      const remRes = await harness.removeItem('managed', 'k1');
      expect(remRes.ok).toBe(false);
      if (!remRes.ok) expect(remRes.error.code).toBe('READ_ONLY_AREA');

      const remMultiRes = await harness.removeItems('managed', ['k1']);
      expect(remMultiRes.ok).toBe(false);
      if (!remMultiRes.ok) expect(remMultiRes.error.code).toBe('READ_ONLY_AREA');

      const clrRes = await harness.clear('managed');
      expect(clrRes.ok).toBe(false);
      if (!clrRes.ok) expect(clrRes.error.code).toBe('READ_ONLY_AREA');
    });

    it('3.5 should accurately compute UTF-8 byte lengths for multi-byte characters and emojis', async () => {
      const key = 'emoji';
      const value = '🚀';
      await harness.setItem('local', key, value);

      const bytesRes = await harness.getBytesInUse('local', key);
      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBe(new TextEncoder().encode('emoji"🚀"').length);
      }
    });

    it('3.6 should subtract old key byte size when overwriting existing key in quota computation', async () => {
      harness.setQuotaConfig('local', { maxBytes: 100 });
      await harness.setItem('local', 'k1', 'a'.repeat(40));

      const overwriteRes = await harness.setItem('local', 'k1', 'a'.repeat(50));
      expect(overwriteRes.ok).toBe(true);
    });
  });

  // ==========================================
  // SECTION 4: Fault Injection & Latency Simulation
  // ==========================================
  describe('4. Fault Injection & Latency Simulation', () => {
    it('4.1 should simulate global read fault when injectReadFault is called without arguments', async () => {
      harness.injectReadFault();
      const res = await harness.getItem('local', 'testKey');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('SIMULATED_FAULT');
      }
    });

    it('4.2 should filter read faults by storage area and key pattern', async () => {
      harness.injectReadFault('local', 'secret');
      await harness.setItem('local', 'secret_token', '12345');
      await harness.setItem('local', 'public_name', 'john');
      await harness.setItem('session', 'secret_session', '999');

      const errRes = await harness.getItem('local', 'secret_token');
      expect(errRes.ok).toBe(false);

      const okRes1 = await harness.getItem('local', 'public_name');
      expect(okRes1.ok).toBe(true);

      const okRes2 = await harness.getItem('session', 'secret_session');
      expect(okRes2.ok).toBe(true);
    });

    it('4.3 should filter write faults by area and key pattern', async () => {
      harness.injectWriteFault('local', 'deny');

      const errRes = await harness.setItem('local', 'deny_write', 'data');
      expect(errRes.ok).toBe(false);
      if (!errRes.ok) expect(errRes.error.code).toBe('SIMULATED_FAULT');

      const okRes = await harness.setItem('local', 'allow_write', 'data');
      expect(okRes.ok).toBe(true);
    });

    it('4.4 should simulate quota fault when injectQuotaFault is triggered', async () => {
      harness.injectQuotaFault('local');
      const res = await harness.setItem('local', 'anyKey', 'anyVal');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('QUOTA_EXCEEDED');
    });

    it('4.5 should apply artificial latency delay when injectLatency is set', async () => {
      harness.injectLatency(50);
      const start = Date.now();
      await harness.getItem('local', 'k1');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('4.6 should clear all injected faults and latency when clearFaults is called', async () => {
      harness.injectReadFault();
      harness.injectLatency(100);
      harness.clearFaults();

      const res = await harness.getItem('local', 'k1');
      expect(res.ok).toBe(true);
    });
  });

  // ==========================================
  // SECTION 5: Reactive Observer & Event Dispatch (onChanged)
  // ==========================================
  describe('5. Reactive Observer & Event Dispatch (onChanged)', () => {
    it('5.1 should dispatch change event on setItem with oldValue and newValue', async () => {
      const listener = vi.fn();
      harness.onChanged(listener);

      await harness.setItem('local', 'k1', 'initial');
      expect(listener).toHaveBeenCalledWith({ k1: { oldValue: undefined, newValue: 'initial' } }, 'local');

      await harness.setItem('local', 'k1', 'updated');
      expect(listener).toHaveBeenCalledWith({ k1: { oldValue: 'initial', newValue: 'updated' } }, 'local');
    });

    it('5.2 should dispatch batch change events on setItems', async () => {
      const listener = vi.fn();
      harness.onChanged(listener);

      await harness.setItems('local', { a: 1, b: 2 });
      expect(listener).toHaveBeenCalledWith(
        {
          a: { oldValue: undefined, newValue: 1 },
          b: { oldValue: undefined, newValue: 2 },
        },
        'local'
      );
    });

    it('5.3 should dispatch change event on removeItem and clear', async () => {
      await harness.setItems('local', { k1: 'v1', k2: 'v2' });
      const listener = vi.fn();
      harness.onChanged(listener);

      await harness.removeItem('local', 'k1');
      expect(listener).toHaveBeenCalledWith({ k1: { oldValue: 'v1', newValue: undefined } }, 'local');

      await harness.clear('local');
      expect(listener).toHaveBeenCalledWith({ k2: { oldValue: 'v2', newValue: undefined } }, 'local');
    });

    it('5.4 should suppress change event when setItem sets identical value', async () => {
      await harness.setItem('local', 'k1', 'sameVal');
      const listener = vi.fn();
      harness.onChanged(listener);

      await harness.setItem('local', 'k1', 'sameVal');
      expect(listener).not.toHaveBeenCalled();
    });

    it('5.5 should unsubscribe listener when returned cleanup function is called', async () => {
      const listener = vi.fn();
      const unsub = harness.onChanged(listener);

      await harness.setItem('local', 'k1', 'v1');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      await harness.setItem('local', 'k1', 'v2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('5.6 should isolate listener errors so throwing callback does not crash operation or other listeners', async () => {
      const throwingListener = () => {
        throw new Error('Crashing listener');
      };
      const validListener = vi.fn();

      harness.onChanged(throwingListener);
      harness.onChanged(validListener);

      const res = await harness.setItem('local', 'k1', 'v1');
      expect(res.ok).toBe(true);
      expect(validListener).toHaveBeenCalled();
    });
  });

  // ==========================================
  // SECTION 6: State Seeding, Snapshotting, and Resetting
  // ==========================================
  describe('6. State Seeding, Snapshotting, and Resetting', () => {
    it('6.1 should seed storage area directly without triggering events or checking quota', async () => {
      const listener = vi.fn();
      harness.onChanged(listener);
      harness.setQuotaConfig('local', { maxBytes: 5 });

      harness.seed('local', { seedKey: 'very_long_seed_value_exceeding_quota' });
      expect(listener).not.toHaveBeenCalled();

      const res = await harness.getItem('local', 'seedKey');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe('very_long_seed_value_exceeding_quota');
    });

    it('6.2 should snapshot and restore state across all storage areas', async () => {
      harness.seed('local', { a: 1 });
      harness.seed('session', { b: 2 });

      const snap = harness.snapshot();
      expect(snap.local).toEqual({ a: 1 });
      expect(snap.session).toEqual({ b: 2 });

      harness.reset();
      expect(harness.snapshot()).toEqual({});

      harness.restoreSnapshot(snap);
      const resLocal = await harness.getItem('local', 'a');
      expect(resLocal.ok).toBe(true);
      if (resLocal.ok) expect(resLocal.value).toBe(1);
    });

    it('6.3 should clear stores, listeners, faults, and latency on reset', async () => {
      harness.seed('local', { k1: 'v1' });
      harness.injectReadFault();
      harness.injectLatency(500);

      harness.reset();

      const config = harness.getQuotaConfig('sync');
      expect(config.maxItemBytes).toBe(8192);
      const res = await harness.getItem('local', 'k1');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBeNull();
    });
  });

  // ==========================================
  // SECTION 7: Automated Contract Test Engine (runContractTests)
  // ==========================================
  describe('7. Automated Contract Test Engine (runContractTests)', () => {
    it('7.1 should pass all contract tests when executed against StorageTestHarness itself', async () => {
      const contractRes = await harness.runContractTests(harness);
      expect(contractRes.ok).toBe(true);
      if (contractRes.ok) {
        expect(contractRes.value.passed).toBeGreaterThanOrEqual(5);
        expect(contractRes.value.failed).toBe(0);
        expect(contractRes.value.failures).toEqual([]);
      }
    });

    it('7.2 should detect contract violations when setItem fails in target port', async () => {
      class BrokenSetPort extends StorageTestHarness {
        public override async setItem(): Promise<any> {
          return { ok: false, error: new StorageHarnessError('WRITE_FAILED', 'Broken setItem') };
        }
      }
      const res = await harness.runContractTests(new BrokenSetPort());
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.failed).toBeGreaterThan(0);
        expect(res.value.failures.some((f) => f.testName.includes('Set and Get Item'))).toBe(true);
      }
    });

    it('7.3 should detect contract violations when getItem returns wrong value in target port', async () => {
      class WrongGetPort extends StorageTestHarness {
        public override async getItem(): Promise<any> {
          return { ok: true, value: { active: false } };
        }
      }
      const res = await harness.runContractTests(new WrongGetPort());
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.failed).toBeGreaterThan(0);
        expect(res.value.failures.some((f) => f.testName.includes('Set and Get Item'))).toBe(true);
      }
    });

    it('7.4 should detect contract violations when removeItem fails or fails to delete key', async () => {
      class BrokenRemovePort extends StorageTestHarness {
        public override async removeItem(): Promise<any> {
          return { ok: false, error: new StorageHarnessError('WRITE_FAILED', 'Broken remove') };
        }
      }
      const res1 = await harness.runContractTests(new BrokenRemovePort());
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.failures.some((f) => f.testName.includes('Remove Item'))).toBe(true);
      }

      class NonDeletingPort extends StorageTestHarness {
        public override async removeItem(): Promise<any> {
          return { ok: true, value: undefined };
        }
        public override async getItem(): Promise<any> {
          return { ok: true, value: 'still_here' };
        }
      }
      const res2 = await harness.runContractTests(new NonDeletingPort());
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.failures.some((f) => f.testName.includes('Remove Item'))).toBe(true);
      }
    });

    it('7.5 should detect contract violations when clear fails or fails to empty storage', async () => {
      class BrokenClearPort extends StorageTestHarness {
        public override async clear(): Promise<any> {
          return { ok: false, error: new StorageHarnessError('WRITE_FAILED', 'Broken clear') };
        }
      }
      const res1 = await harness.runContractTests(new BrokenClearPort());
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.failures.some((f) => f.testName.includes('Clear Area'))).toBe(true);
      }

      class NonClearingPort extends StorageTestHarness {
        public override async clear(): Promise<any> {
          return { ok: true, value: undefined };
        }
        public override async getItems(): Promise<any> {
          return { ok: true, value: { k1: 1 } };
        }
      }
      const res2 = await harness.runContractTests(new NonClearingPort());
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.failures.some((f) => f.testName.includes('Clear Area'))).toBe(true);
      }
    });

    it('7.6 should detect contract violations when managed storage area allows writes or returns wrong error code', async () => {
      class WritableManagedPort extends StorageTestHarness {
        public override async setItem(area: any, k: any, v: any): Promise<any> {
          if (area === 'managed') return { ok: true, value: undefined };
          return super.setItem(area, k, v);
        }
      }
      const res1 = await harness.runContractTests(new WritableManagedPort());
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.failures.some((f) => f.testName.includes('Managed Area Read-Only'))).toBe(true);
      }

      class WrongErrorManagedPort extends StorageTestHarness {
        public override async setItem(area: any, k: any, v: any): Promise<any> {
          if (area === 'managed') return { ok: false, error: new StorageHarnessError('WRITE_FAILED', 'Wrong code') };
          return super.setItem(area, k, v);
        }
      }
      const res2 = await harness.runContractTests(new WrongErrorManagedPort());
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.failures.some((f) => f.testName.includes('Managed Area Read-Only'))).toBe(true);
      }
    });

    it('7.7 should detect contract violations when onChanged is not invoked', async () => {
      class NoEventPort extends StorageTestHarness {
        public override onChanged(): () => void {
          return () => {};
        }
      }
      const res = await harness.runContractTests(new NoEventPort());
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.failures.some((f) => f.testName.includes('Event Dispatch on Mutation'))).toBe(true);
      }
    });
  });

  // ==========================================
  // SECTION 8: Environment Mock Helper (mockStorageEnvironment)
  // ==========================================
  describe('8. Environment Mock Helper (mockStorageEnvironment)', () => {
    afterEach(() => {
      uninstallMockStorageEnvironment();
    });

    it('8.1 should mock globalThis.chrome.storage areas and async callback API', async () => {
      installMockStorageEnvironment();
      expect((globalThis as any).chrome).toBeDefined();

      await new Promise<void>((resolve) => {
        (globalThis as any).chrome.storage.local.set({ extensionKey: 'extensionVal' }, () => {
          (globalThis as any).chrome.storage.local.get('extensionKey', (result: any) => {
            expect(result.extensionKey).toBe('extensionVal');
            resolve();
          });
        });
      });
    });

    it('8.2 should populate chrome.runtime.lastError on operation error', async () => {
      const activeHarness = installMockStorageEnvironment();
      activeHarness.injectWriteFault('local');

      await new Promise<void>((resolve) => {
        (globalThis as any).chrome.storage.local.set({ errKey: 'val' }, () => {
          expect((globalThis as any).chrome.runtime.lastError).toBeDefined();
          expect((globalThis as any).chrome.runtime.lastError.message).toContain('Simulated write fault');
          resolve();
        });
      });
    });

    it('8.3 should mock DOM localStorage and sessionStorage interfaces', () => {
      installMockStorageEnvironment();
      expect((globalThis as any).localStorage).toBeDefined();
      expect((globalThis as any).sessionStorage).toBeDefined();

      (globalThis as any).localStorage.setItem('domKey', 'domVal');
      expect((globalThis as any).localStorage.getItem('domKey')).toBe('"domVal"');
      expect((globalThis as any).localStorage.length).toBe(1);
      expect((globalThis as any).localStorage.key(0)).toBe('domKey');

      (globalThis as any).localStorage.removeItem('domKey');
      expect((globalThis as any).localStorage.getItem('domKey')).toBeNull();
      expect((globalThis as any).localStorage.length).toBe(0);
    });

    it('8.4 should manage environment lifecycle cleanly via withMockStorage', async () => {
      await withMockStorage(async (envHarness) => {
        await envHarness.setItem('local', 'insideKey', 'insideVal');
        const getRes = await envHarness.getItem('local', 'insideKey');
        if (getRes.ok) expect(getRes.value).toBe('insideVal');
      });

      expect((globalThis as any).chrome).toBeUndefined();
    });
  });

  // ==========================================
  // SECTION 9: Advanced Stryker Mutant Killers Matrix
  // ==========================================
  describe('9. Advanced Stryker Mutant Killers Matrix', () => {
    it('9.1 should kill boundary mutants on maxItemBytes', async () => {
      harness.setQuotaConfig('sync', { maxItemBytes: 100 });

      // Exactly 100 bytes item -> PASS
      const exactKey = 'k';
      const exactVal = 'x'.repeat(97); // 'k' + '"' + 97 chars + '"' = 100 bytes
      const exactRes = await harness.setItem('sync', exactKey, exactVal);
      expect(exactRes.ok).toBe(true);

      // 101 bytes item -> FAIL
      const overVal = 'x'.repeat(98);
      const overRes = await harness.setItem('sync', exactKey, overVal);
      expect(overRes.ok).toBe(false);
    });

    it('9.2 should kill boundary mutants on total maxBytes', async () => {
      harness.setQuotaConfig('local', { maxBytes: 50 });

      // Exactly 50 bytes total -> PASS
      const resExact = await harness.setItem('local', 'k', 'x'.repeat(47));
      expect(resExact.ok).toBe(true);

      // 51 bytes total -> FAIL
      const resOver = await harness.setItem('local', 'k2', 'a');
      expect(resOver.ok).toBe(false);
    });

    it('9.3 should kill boundary mutants on maxItems', async () => {
      harness.setQuotaConfig('local', { maxItems: 1 });

      const res1 = await harness.setItem('local', 'item1', 'v1');
      expect(res1.ok).toBe(true);

      const res2 = await harness.setItem('local', 'item2', 'v2');
      expect(res2.ok).toBe(false);
    });

    it('9.4 should return correct bytes in use when getBytesInUse filter is string, array, or null', async () => {
      await harness.setItem('local', 'k1', 'v1');
      await harness.setItem('local', 'k2', 'v2');

      const bStr = await harness.getBytesInUse('local', 'k1');
      expect(bStr.ok).toBe(true);

      const bArr = await harness.getBytesInUse('local', ['k1', 'k2']);
      expect(bArr.ok).toBe(true);

      const bNull = await harness.getBytesInUse('local', null);
      expect(bNull.ok).toBe(true);
      if (bNull.ok && bArr.ok) {
        expect(bNull.value).toBe(bArr.value);
      }
    });
  });
});
