import { StorageTestHarness } from '../../utils/storageTestHarness';
import { MockStorageArea } from '../../src/domain/ports/secondary/mockStoragePort';

let globalHarness: StorageTestHarness | null = null;

let originalChrome: unknown = undefined;
let originalLocalStorage: unknown = undefined;
let originalSessionStorage: unknown = undefined;

export function getGlobalMockHarness(): StorageTestHarness {
  if (!globalHarness) {
    globalHarness = new StorageTestHarness();
  }
  return globalHarness;
}

export function installMockStorageEnvironment(harness?: StorageTestHarness): StorageTestHarness {
  const activeHarness = harness || getGlobalMockHarness();

  originalChrome = (globalThis as any).chrome;
  originalLocalStorage = (globalThis as any).localStorage;
  originalSessionStorage = (globalThis as any).sessionStorage;

  const createChromeArea = (area: MockStorageArea) => ({
    get: (keys: any, cb: (res: any) => void) => {
      activeHarness.getItems(area, keys).then((res) => {
        (globalThis as any).chrome.runtime.lastError = res.ok ? null : { message: res.error.message };
        cb(res.ok ? res.value : {});
      });
    },
    set: (items: Record<string, unknown>, cb?: () => void) => {
      activeHarness.setItems(area, items).then((res) => {
        (globalThis as any).chrome.runtime.lastError = res.ok ? null : { message: res.error.message };
        if (cb) cb();
      });
    },
    remove: (keys: string | string[], cb?: () => void) => {
      const keyArr = Array.isArray(keys) ? keys : [keys];
      activeHarness.removeItems(area, keyArr).then((res) => {
        (globalThis as any).chrome.runtime.lastError = res.ok ? null : { message: res.error.message };
        if (cb) cb();
      });
    },
    clear: (cb?: () => void) => {
      activeHarness.clear(area).then((res) => {
        (globalThis as any).chrome.runtime.lastError = res.ok ? null : { message: res.error.message };
        if (cb) cb();
      });
    },
    getBytesInUse: (keys: any, cb: (bytes: number) => void) => {
      activeHarness.getBytesInUse(area, keys).then((res) => {
        (globalThis as any).chrome.runtime.lastError = res.ok ? null : { message: res.error.message };
        cb(res.ok ? res.value : 0);
      });
    },
  });

  const mockChrome: any = {
    runtime: {
      id: 'mock-harness-extension-id',
      lastError: null,
      getManifest: () => ({ manifest_version: 3, name: 'Mock Storage Harness', version: '1.0.0' }),
    },
    storage: {
      local: createChromeArea('local'),
      sync: createChromeArea('sync'),
      session: createChromeArea('session'),
      managed: createChromeArea('managed'),
      onChanged: {
        addListener: (fn: any) => activeHarness.onChanged(fn),
      },
    },
  };

  (globalThis as any).chrome = mockChrome;

  const createDomStorage = (area: 'localStorage' | 'sessionStorage') => {
    return {
      getItem: (key: string): string | null => {
        const store = activeHarness.snapshot()[area];
        return store && key in store ? JSON.stringify(store[key]) : null;
      },
      setItem: (key: string, value: string): void => {
        let parsed: unknown = value;
        try { parsed = JSON.parse(value); } catch { /* text fallback */ }
        activeHarness.seed(area, { [key]: parsed });
      },
      removeItem: (key: string): void => {
        const store = activeHarness.snapshot()[area] || {};
        const next = { ...store };
        delete next[key];
        const fullSnap = activeHarness.snapshot();
        fullSnap[area] = next;
        activeHarness.restoreSnapshot(fullSnap);
      },
      clear: (): void => {
        const fullSnap = activeHarness.snapshot();
        fullSnap[area] = {};
        activeHarness.restoreSnapshot(fullSnap);
      },
      key: (index: number): string | null => {
        const keys = Object.keys(activeHarness.snapshot()[area] || {});
        return keys[index] ?? null;
      },
      get length(): number {
        return Object.keys(activeHarness.snapshot()[area] || {}).length;
      },
    };
  };

  (globalThis as any).localStorage = createDomStorage('localStorage');
  (globalThis as any).sessionStorage = createDomStorage('sessionStorage');

  return activeHarness;
}

export function uninstallMockStorageEnvironment(): void {
  if (originalChrome !== undefined) (globalThis as any).chrome = originalChrome;
  else delete (globalThis as any).chrome;

  if (originalLocalStorage !== undefined) (globalThis as any).localStorage = originalLocalStorage;
  else delete (globalThis as any).localStorage;

  if (originalSessionStorage !== undefined) (globalThis as any).sessionStorage = originalSessionStorage;
  else delete (globalThis as any).sessionStorage;

  if (globalHarness) {
    globalHarness.reset();
    globalHarness = null;
  }
}

export async function withMockStorage<T>(fn: (harness: StorageTestHarness) => Promise<T>): Promise<T> {
  const harness = installMockStorageEnvironment();
  try {
    return await fn(harness);
  } finally {
    uninstallMockStorageEnvironment();
  }
}
