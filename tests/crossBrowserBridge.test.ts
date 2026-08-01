import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Result } from '../utils/result';
import {
  ExtensionBridgeError,
  ExtensionBridgeErrorCode,
  ExtensionStorageArea,
  BridgeMessagePayload,
  ExtensionBridgePort,
} from '../src/domain/ports/secondary/extensionBridgePort';
import { WxtBridgeAdapter } from '../src/infrastructure/adapters/wxtBridgeAdapter';
import { CrossBrowserBridge } from '../utils/crossBrowserBridge';

describe('Cross-Browser Storage Bridge & WXT Adapter (ADR-0014)', () => {
  let originalChrome: any;
  let originalBrowser: any;
  let originalNavigator: any;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    originalBrowser = (globalThis as any).browser;
    originalNavigator = globalThis.navigator;

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

  // --- Helper to mock Chrome Extension environment ---
  function setupMockExtension(options?: {
    vendor?: 'chrome' | 'firefox' | 'edge';
    manifestVersion?: 2 | 3;
    lastError?: { message: string } | null;
    storageFailures?: { get?: boolean; set?: boolean; remove?: boolean; clear?: boolean; quota?: boolean; permission?: boolean; getBytesInUse?: boolean };
    messagingFailures?: { disconnect?: boolean; timeout?: boolean; tabNotFound?: boolean };
    hasSessionStorage?: boolean;
    missingGetBytesInUse?: boolean;
  }) {
    const localMap = new Map<string, any>();
    const syncMap = new Map<string, any>();
    const sessionMap = new Map<string, any>();
    const managedMap = new Map<string, any>();

    const storageChangedListeners: Array<(changes: Record<string, any>, area: string) => void> = [];

    const createStorageArea = (storeMap: Map<string, any>, areaName: string) => {
      const areaObj: any = {
        get: (keys: any, cb: (res: any) => void) => {
          if (options?.storageFailures?.get) {
            mockChrome.runtime.lastError = options?.lastError || { message: 'Storage read failure' };
            cb({});
            return;
          }
          mockChrome.runtime.lastError = null;

          const res: Record<string, any> = {};
          if (!keys) {
            storeMap.forEach((v, k) => (res[k] = v));
          } else if (typeof keys === 'string') {
            if (storeMap.has(keys)) res[keys] = storeMap.get(keys);
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => {
              if (storeMap.has(k)) res[k] = storeMap.get(k);
            });
          }
          cb(res);
        },
        set: (items: Record<string, any>, cb: () => void) => {
          if (options?.storageFailures?.quota) {
            mockChrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
            cb();
            return;
          }
          if (options?.storageFailures?.permission) {
            mockChrome.runtime.lastError = { message: 'Permission denied for storage write' };
            cb();
            return;
          }
          if (options?.storageFailures?.set) {
            mockChrome.runtime.lastError = { message: 'Storage write failure' };
            cb();
            return;
          }
          mockChrome.runtime.lastError = null;

          const changes: Record<string, any> = {};
          Object.entries(items).forEach(([k, v]) => {
            const oldVal = storeMap.get(k);
            storeMap.set(k, v);
            changes[k] = { oldValue: oldVal, newValue: v };
          });

          storageChangedListeners.forEach((l) => l(changes, areaName));
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          if (options?.storageFailures?.remove) {
            mockChrome.runtime.lastError = { message: 'Storage delete failure' };
            cb();
            return;
          }
          mockChrome.runtime.lastError = null;

          const keyArr = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, any> = {};
          keyArr.forEach((k) => {
            if (storeMap.has(k)) {
              const oldVal = storeMap.get(k);
              storeMap.delete(k);
              changes[k] = { oldValue: oldVal, newValue: undefined };
            }
          });
          storageChangedListeners.forEach((l) => l(changes, areaName));
          cb();
        },
        clear: (cb: () => void) => {
          if (options?.storageFailures?.clear) {
            mockChrome.runtime.lastError = { message: 'Storage clear failure' };
            cb();
            return;
          }
          mockChrome.runtime.lastError = null;
          storeMap.clear();
          cb();
        },
      };

      if (!options?.missingGetBytesInUse) {
        areaObj.getBytesInUse = (keys: any, cb: (b: number) => void) => {
          if (options?.storageFailures?.getBytesInUse) {
            mockChrome.runtime.lastError = { message: 'getBytesInUse failure' };
            cb(0);
            return;
          }
          mockChrome.runtime.lastError = null;
          let total = 0;
          storeMap.forEach((val, k) => {
            if (!keys || (Array.isArray(keys) ? keys.includes(k) : keys === k)) {
              total += new Blob([JSON.stringify(val)]).size;
            }
          });
          cb(total);
        };
      }

      return areaObj;
    };

    const mockChrome: any = {
      runtime: {
        id: 'mock-extension-id-12345',
        lastError: options?.lastError || null,
        getManifest: () => ({
          manifest_version: options?.manifestVersion ?? 3,
          name: 'Browser Storage Suite Test',
          version: '1.0.0',
        }),
        sendMessage: (msg: any, cb: (res: any) => void) => {
          if (options?.messagingFailures?.disconnect) {
            mockChrome.runtime.lastError = {
              message: 'Could not establish connection. Receiving end does not exist.',
            };
            cb(undefined);
            return;
          }
          if (options?.messagingFailures?.timeout) {
            return; // Do not call callback to simulate timeout
          }
          mockChrome.runtime.lastError = null;
          cb({ echo: msg, status: 'ok' });
        },
      },
      tabs: {
        sendMessage: (tabId: number, msg: any, cb: (res: any) => void) => {
          if (options?.messagingFailures?.tabNotFound || tabId === 999) {
            mockChrome.runtime.lastError = {
              message: `Could not establish connection to tab ${tabId}.`,
            };
            cb(undefined);
            return;
          }
          if (options?.messagingFailures?.timeout) {
            return;
          }
          mockChrome.runtime.lastError = null;
          cb({ tabId, echo: msg, status: 'ok' });
        },
      },
      storage: {
        local: createStorageArea(localMap, 'local'),
        sync: createStorageArea(syncMap, 'sync'),
        managed: createStorageArea(managedMap, 'managed'),
        ...(options?.hasSessionStorage !== false ? { session: createStorageArea(sessionMap, 'session') } : {}),
        onChanged: {
          addListener: (fn: any) => storageChangedListeners.push(fn),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    return { mockChrome, localMap, syncMap, sessionMap, managedMap, storageChangedListeners };
  }

  describe('1. Context Detection & Environment Inspection', () => {
    it('1.1 should identify non-extension (web/Node) context when global chrome/browser are absent', () => {
      const adapter = new WxtBridgeAdapter();
      const ctx = adapter.getBrowserContext();

      expect(ctx.isExtensionContext).toBe(false);
      expect(ctx.manifestVersion).toBe('web');
      expect(ctx.supportedStorageAreas).toContain('local');
      expect(ctx.supportedStorageAreas).toContain('session');
    });

    it('1.2 should detect Chrome MV3 extension environment when chrome.runtime is present', () => {
      setupMockExtension({ manifestVersion: 3 });
      const adapter = new WxtBridgeAdapter();
      const ctx = adapter.getBrowserContext();

      expect(ctx.isExtensionContext).toBe(true);
      expect(ctx.manifestVersion).toBe('mv3');
      expect(ctx.hasSessionStorage).toBe(true);
      expect(ctx.supportedStorageAreas).toContain('session');
    });

    it('1.3 should detect MV2 environment when manifest_version is 2', () => {
      setupMockExtension({ manifestVersion: 2, hasSessionStorage: false });
      const adapter = new WxtBridgeAdapter();
      const ctx = adapter.getBrowserContext();

      expect(ctx.isExtensionContext).toBe(true);
      expect(ctx.manifestVersion).toBe('mv2');
      expect(ctx.hasSessionStorage).toBe(false);
      expect(ctx.supportedStorageAreas).not.toContain('session');
    });
  });

  describe('2. In-Memory Fallback Storage Operations (Non-Extension Environment)', () => {
    it('2.1 should set, get, and remove item in local in-memory store', async () => {
      const adapter = new WxtBridgeAdapter();

      const setRes = await adapter.setItem('testKey', { foo: 'bar' });
      expect(setRes.ok).toBe(true);

      const getRes = await adapter.getItem<{ foo: string }>('testKey');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toEqual({ foo: 'bar' });
      }

      const removeRes = await adapter.removeItem('testKey');
      expect(removeRes.ok).toBe(true);

      const getAfter = await adapter.getItem('testKey');
      expect(getAfter.ok).toBe(true);
      if (getAfter.ok) {
        expect(getAfter.value).toBeNull();
      }
    });

    it('2.2 should setMultiple and getItems for multiple keys', async () => {
      const adapter = new WxtBridgeAdapter();

      await adapter.setItems({ a: 1, b: 2, c: 3 });
      const res = await adapter.getItems<Record<string, number>>(['a', 'c']);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({ a: 1, c: 3 });
      }
    });

    it('2.3 should clear storage area cleanly', async () => {
      const adapter = new WxtBridgeAdapter();

      await adapter.setItems({ k1: 'v1', k2: 'v2' }, 'sync');
      await adapter.clear('sync');

      const res = await adapter.getItems(null, 'sync');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({});
      }
    });

    it('2.4 should calculate getBytesInUse correctly in memory', async () => {
      const adapter = new WxtBridgeAdapter();

      await adapter.setItem('key1', 'hello');
      const bytesRes = await adapter.getBytesInUse('key1');
      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBeGreaterThan(0);
      }
    });
  });

  describe('3. Native Extension Storage Operations (Mocked Chrome Runtime)', () => {
    it('3.1 should write and read items using chrome.storage.local', async () => {
      const { localMap } = setupMockExtension();
      const adapter = new WxtBridgeAdapter();

      const setRes = await adapter.setItem('extKey', 'extValue', 'local');
      expect(setRes.ok).toBe(true);
      expect(localMap.get('extKey')).toBe('extValue');

      const getRes = await adapter.getItem<string>('extKey', 'local');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toBe('extValue');
      }
    });

    it('3.2 should transparently fall back session storage to in-memory store if session API missing in MV2', async () => {
      setupMockExtension({ manifestVersion: 2, hasSessionStorage: false });
      const adapter = new WxtBridgeAdapter();

      const setRes = await adapter.setItem('sessKey', 'sessVal', 'session');
      expect(setRes.ok).toBe(true);

      const getRes = await adapter.getItem<string>('sessKey', 'session');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toBe('sessVal');
      }
    });

    it('3.3 should fall back getBytesInUse if getBytesInUse function is missing on storageApi', async () => {
      setupMockExtension({ missingGetBytesInUse: true });
      const adapter = new WxtBridgeAdapter();

      await adapter.setItem('fbKey', { data: 123 });
      const bytesRes = await adapter.getBytesInUse('fbKey', 'local');

      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBeGreaterThan(0);
      }
    });

    it('3.4 should return QUOTA_EXCEEDED error when chrome.storage quota is exceeded', async () => {
      setupMockExtension({ storageFailures: { quota: true } });
      const adapter = new WxtBridgeAdapter();

      const res = await adapter.setItem('largeKey', 'X'.repeat(10000), 'sync');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(ExtensionBridgeError);
        expect(res.error.code).toBe('QUOTA_EXCEEDED');
      }
    });

    it('3.5 should return PERMISSION_DENIED error when permission is denied', async () => {
      setupMockExtension({ storageFailures: { permission: true } });
      const adapter = new WxtBridgeAdapter();

      const res = await adapter.setItem('permKey', 'val');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('3.6 should return READ_FAILED / WRITE_FAILED / DELETE_FAILED / CLEAR_FAILED on runtime error', async () => {
      setupMockExtension({
        storageFailures: { get: true, set: true, remove: true, clear: true, getBytesInUse: true },
      });
      const adapter = new WxtBridgeAdapter();

      const getRes = await adapter.getItem('k');
      expect(getRes.ok).toBe(false);
      if (!getRes.ok) expect(getRes.error.code).toBe('READ_FAILED');

      const setRes = await adapter.setItem('k', 'v');
      expect(setRes.ok).toBe(false);
      if (!setRes.ok) expect(setRes.error.code).toBe('WRITE_FAILED');

      const remRes = await adapter.removeItem('k');
      expect(remRes.ok).toBe(false);
      if (!remRes.ok) expect(remRes.error.code).toBe('DELETE_FAILED');

      const clrRes = await adapter.clear();
      expect(clrRes.ok).toBe(false);
      if (!clrRes.ok) expect(clrRes.error.code).toBe('CLEAR_FAILED');
    });
  });

  describe('4. Messaging & RPC Port Operations', () => {
    it('4.1 should return UNSUPPORTED_ENVIRONMENT when sending message in web environment', async () => {
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'PING',
        payload: null,
        timestamp: Date.now(),
        correlationId: 'cor_123',
      };

      const res = await adapter.sendMessage(msg);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
      }
    });

    it('4.2 should send and receive RPC runtime message in extension environment', async () => {
      setupMockExtension();
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'PING',
        payload: { test: true },
        timestamp: Date.now(),
        correlationId: 'cor_456',
      };

      const res = await adapter.sendMessage<any>(msg);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('ok');
        expect(res.value.echo.type).toBe('PING');
      }
    });

    it('4.3 should return PORT_DISCONNECTED when background receiver is disconnected', async () => {
      setupMockExtension({ messagingFailures: { disconnect: true } });
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'GET_DATA',
        payload: null,
        timestamp: Date.now(),
        correlationId: 'cor_disc',
      };

      const res = await adapter.sendMessage(msg);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('PORT_DISCONNECTED');
      }
    });

    it('4.4 should send message to specific tab via sendMessageToTab', async () => {
      setupMockExtension();
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'TAB_PING',
        payload: { tabData: 123 },
        timestamp: Date.now(),
        correlationId: 'cor_tab',
      };

      const res = await adapter.sendMessageToTab<any>(10, msg);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.tabId).toBe(10);
      }
    });

    it('4.5 should return TAB_NOT_FOUND when sending to non-existent tab', async () => {
      setupMockExtension({ messagingFailures: { tabNotFound: true } });
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'TAB_PING',
        payload: null,
        timestamp: Date.now(),
        correlationId: 'cor_notab',
      };

      const res = await adapter.sendMessageToTab(999, msg);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TAB_NOT_FOUND');
      }
    });

    it('4.6 should return TIMEOUT error if message callback does not resolve within timeout window', async () => {
      vi.useFakeTimers();
      setupMockExtension({ messagingFailures: { timeout: true } });
      const adapter = new WxtBridgeAdapter();

      const msg: BridgeMessagePayload = {
        type: 'SLOW_RPC',
        payload: null,
        timestamp: Date.now(),
        correlationId: 'cor_timeout',
      };

      const sendPromise = adapter.sendMessage(msg);
      vi.advanceTimersByTime(5001);
      const res = await sendPromise;

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TIMEOUT');
      }

      vi.useRealTimers();
    });
  });

  describe('5. Storage Event Synchronization', () => {
    it('5.1 should trigger storage change listener when setItem or removeItem is invoked', async () => {
      const adapter = new WxtBridgeAdapter();
      const listenerSpy = vi.fn();

      const unsubscribe = adapter.onStorageChanged(listenerSpy);

      await adapter.setItem('syncKey', 'val1', 'local');
      expect(listenerSpy).toHaveBeenCalledWith(
        { syncKey: { oldValue: undefined, newValue: 'val1' } },
        'local'
      );

      await adapter.removeItem('syncKey', 'local');
      expect(listenerSpy).toHaveBeenCalledWith(
        { syncKey: { oldValue: 'val1', newValue: undefined } },
        'local'
      );

      unsubscribe();
      await adapter.setItem('syncKey2', 'val2', 'local');
      expect(listenerSpy).toHaveBeenCalledTimes(2);
    });

    it('5.2 should attach to chrome.storage.onChanged in extension environment', () => {
      const { storageChangedListeners } = setupMockExtension();
      const adapter = new WxtBridgeAdapter();
      const listenerSpy = vi.fn();

      adapter.onStorageChanged(listenerSpy);
      expect(storageChangedListeners.length).toBe(1);

      storageChangedListeners[0]({ k: { oldValue: 'a', newValue: 'b' } }, 'local');
      expect(listenerSpy).toHaveBeenCalledWith({ k: { oldValue: 'a', newValue: 'b' } }, 'local');
    });
  });

  describe('6. Domain Facade Utility (CrossBrowserBridge)', () => {
    it('6.1 should operate as a singleton facade delegating to default WxtBridgeAdapter', async () => {
      const bridge = CrossBrowserBridge.getInstance();
      expect(bridge).toBeDefined();

      const setRes = await bridge.set('facadeKey', 'facadeValue');
      expect(setRes.ok).toBe(true);

      const getRes = await bridge.get<string>('facadeKey');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toBe('facadeValue');
      }
    });

    it('6.2 should support setAdapter / configure with custom mock adapter', async () => {
      const mockPort: ExtensionBridgePort = {
        getBrowserContext: () => ({
          vendor: 'firefox',
          manifestVersion: 'mv3',
          isExtensionContext: true,
          supportedStorageAreas: ['local'],
          hasSessionStorage: false,
        }),
        getItem: async (k) => Result.ok((k === 'custom' ? 'mockedValue' : null) as any),
        getItems: async () => Result.ok({} as any),
        setItem: async () => Result.ok(undefined),
        setItems: async () => Result.ok(undefined),
        removeItem: async () => Result.ok(undefined),
        removeItems: async () => Result.ok(undefined),
        clear: async () => Result.ok(undefined),
        getBytesInUse: async () => Result.ok(42),
        sendMessage: async () => Result.ok('mockResp' as any),
        sendMessageToTab: async () => Result.ok('mockTabResp' as any),
        onStorageChanged: () => () => {},
      };

      CrossBrowserBridge.setAdapter(mockPort);
      const bridge = CrossBrowserBridge.getInstance();

      const ctx = bridge.getContext();
      expect(ctx.vendor).toBe('firefox');

      const getRes = await bridge.get('custom');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toBe('mockedValue');
      }

      const bytesRes = await bridge.getBytesInUse();
      expect(bytesRes.ok).toBe(true);
      if (bytesRes.ok) {
        expect(bytesRes.value).toBe(42);
      }
    });

    it('6.3 should send RPC message with correlationId and timestamp via send / sendRPC', async () => {
      setupMockExtension();
      const bridge = CrossBrowserBridge.getInstance();

      const sendRes = await bridge.sendRPC<any, any>('RPC_ACTION', { foo: 'bar' });
      expect(sendRes.ok).toBe(true);
      if (sendRes.ok) {
        expect(sendRes.value.echo.type).toBe('RPC_ACTION');
        expect(sendRes.value.echo.correlationId).toMatch(/^rpc_\d+_[a-z0-9]+$/);
      }
    });

    it('6.4 should delegate all storage methods (getMultiple, setMultiple, removeMultiple, clear, listen)', async () => {
      const bridge = CrossBrowserBridge.getInstance();

      await bridge.setMultiple({ m1: 10, m2: 20 });
      const getMulti = await bridge.getMultiple(['m1', 'm2']);
      expect(getMulti.ok).toBe(true);
      if (getMulti.ok) expect(getMulti.value).toEqual({ m1: 10, m2: 20 });

      await bridge.removeMultiple(['m1']);
      const getAfter = await bridge.getMultiple(['m1', 'm2']);
      expect(getAfter.ok).toBe(true);
      if (getAfter.ok) expect(getAfter.value).toEqual({ m2: 20 });

      const spy = vi.fn();
      const unsub = bridge.listen(spy);
      await bridge.set('lKey', 'lVal');
      expect(spy).toHaveBeenCalled();
      unsub();

      await bridge.clear();
      const getCleared = await bridge.getMultiple(null);
      expect(getCleared.ok).toBe(true);
      if (getCleared.ok) expect(getCleared.value).toEqual({});
    });
  });

  describe('7. Edge Cases & Mutant Defense Matrix', () => {
    it('7.1 should handle non-Error exceptions in catch blocks gracefully', async () => {
      (globalThis as any).chrome = {
        runtime: {
          id: 'mock-id',
          getManifest: () => ({ manifest_version: 3 }),
        },
        storage: {
          local: {
            get: () => {
              throw 'String exception thrown';
            },
          },
        },
      };

      const adapter = new WxtBridgeAdapter();
      const res = await adapter.getItem('key');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(ExtensionBridgeError);
        expect(res.error.message).toContain('String exception thrown');
      }
    });

    it('7.2 should handle empty string keys and complex JSON objects safely', async () => {
      const adapter = new WxtBridgeAdapter();

      const complexPayload = {
        nested: { array: [1, 2, 'three', null, true, { inner: 'deep' }] },
        unicode: '🚀 Browser Storage Suite 🦄',
      };

      await adapter.setItem('', complexPayload);
      const getRes = await adapter.getItem('');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toEqual(complexPayload);
      }
    });

    it('7.3 should handle Promise returns from browser API polyfills', async () => {
      (globalThis as any).browser = {
        runtime: {
          id: 'polyfilled-id',
          getManifest: () => ({ manifest_version: 3 }),
        },
        storage: {
          local: {
            get: async (key: string) => ({ [key]: 'promiseVal' }),
          },
        },
      };

      const adapter = new WxtBridgeAdapter();
      const res = await adapter.getItem<string>('polyKey');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('promiseVal');
      }
    });
  });
});
