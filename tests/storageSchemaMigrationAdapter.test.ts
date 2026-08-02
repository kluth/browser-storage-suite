import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StorageSchemaMigrationAdapter,
  DefaultStorageDriver,
  StorageDriver,
  computeChecksum,
} from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import { SchemaVersionHeader } from '../src/domain/model/storageSchemaMigration';

describe('StorageSchemaMigrationAdapter Unit Tests', () => {
  let adapter: StorageSchemaMigrationAdapter;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
  });

  it('test_adapter_01: localStorage driver active writes to and reads from driver', async () => {
    const mockStore = new Map<string, string>();
    const mockDriver: StorageDriver = {
      getItem: (target, key) => (target === 'localStorage' ? mockStore.get(key) ?? null : null),
      setItem: (target, key, val) => {
        if (target === 'localStorage') mockStore.set(key, val);
      },
      removeItem: (target, key) => {
        if (target === 'localStorage') mockStore.delete(key);
      },
    };

    const driverAdapter = new StorageSchemaMigrationAdapter(undefined, mockDriver);
    const header: SchemaVersionHeader = {
      namespace: 'user',
      version: 1,
      updatedAt: 1000,
      appliedMigrations: [],
    };

    const saveRes = await driverAdapter.saveHeader('localStorage', 'k1', 'user', header);
    expect(saveRes.ok).toBe(true);

    const loadRes = await driverAdapter.loadHeader('localStorage', 'k1', 'user');
    expect(loadRes.ok).toBe(true);
    if (loadRes.ok) {
      expect(loadRes.value?.version).toBe(1);
      expect(loadRes.value?.namespace).toBe('user');
    }
  });

  it('test_adapter_02: sessionStorage driver active writes to and reads from driver', async () => {
    const mockStore = new Map<string, string>();
    const mockDriver: StorageDriver = {
      getItem: (target, key) => (target === 'sessionStorage' ? mockStore.get(key) ?? null : null),
      setItem: (target, key, val) => {
        if (target === 'sessionStorage') mockStore.set(key, val);
      },
      removeItem: (target, key) => {
        if (target === 'sessionStorage') mockStore.delete(key);
      },
    };

    const driverAdapter = new StorageSchemaMigrationAdapter(undefined, mockDriver);
    const payload = { token: 'abc123' };

    const saveRes = await driverAdapter.savePayload('sessionStorage', 'session_key', payload);
    expect(saveRes.ok).toBe(true);

    const loadRes = await driverAdapter.loadPayload('sessionStorage', 'session_key');
    expect(loadRes.ok).toBe(true);
    if (loadRes.ok) {
      expect(loadRes.value).toEqual(payload);
    }
  });

  it('test_adapter_03: storage driver returns null on getItem, falls back to in-memory map', async () => {
    const mockDriver: StorageDriver = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

    const driverAdapter = new StorageSchemaMigrationAdapter(undefined, mockDriver);
    const payload = { fallback: true };

    await driverAdapter.savePayload('localStorage', 'k_fallback', payload);
    const loadRes = await driverAdapter.loadPayload('localStorage', 'k_fallback');
    expect(loadRes.ok).toBe(true);
    if (loadRes.ok) {
      expect(loadRes.value).toEqual(payload);
    }
  });

  it('test_adapter_04: storage driver throws exception on setItem, cleanly catches and uses in-memory map', async () => {
    const mockDriver: StorageDriver = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };

    const driverAdapter = new StorageSchemaMigrationAdapter(undefined, mockDriver);
    const payload = { memoryOnly: true };

    const saveRes = await driverAdapter.savePayload('localStorage', 'k_quota', payload);
    expect(saveRes.ok).toBe(true);

    const loadRes = await driverAdapter.loadPayload('localStorage', 'k_quota');
    expect(loadRes.ok).toBe(true);
    if (loadRes.ok) {
      expect(loadRes.value).toEqual(payload);
    }
  });

  it('test_adapter_05: storage driver throws exception on removeItem, cleanly deletes from in-memory map', async () => {
    const mockDriver: StorageDriver = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    const driverAdapter = new StorageSchemaMigrationAdapter(undefined, mockDriver);
    await driverAdapter.savePayload('localStorage', 'k_del', { a: 1 });
    const delRes = await driverAdapter.deletePayload('localStorage', 'k_del');
    expect(delRes.ok).toBe(true);

    const loadRes = await driverAdapter.loadPayload('localStorage', 'k_del');
    expect(loadRes.ok).toBe(true);
    if (loadRes.ok) {
      expect(loadRes.value).toBeNull();
    }
  });

  it('test_adapter_06: non-browser storage targets (indexedDB, cookie, cacheAPI, opfs) use in-memory map', async () => {
    const targets = ['indexedDB', 'cookie', 'cacheAPI', 'opfs'] as const;

    for (const target of targets) {
      const header: SchemaVersionHeader = {
        namespace: 'ns',
        version: 2,
        updatedAt: 2000,
        appliedMigrations: [2],
      };
      const saveHeaderRes = await adapter.saveHeader(target, 'meta_key', 'ns', header);
      expect(saveHeaderRes.ok).toBe(true);

      const loadHeaderRes = await adapter.loadHeader(target, 'meta_key', 'ns');
      expect(loadHeaderRes.ok).toBe(true);
      if (loadHeaderRes.ok) {
        expect(loadHeaderRes.value?.version).toBe(2);
        expect(loadHeaderRes.value?.namespace).toBe('ns');
      }

      const payload = { targetName: target };
      const savePayloadRes = await adapter.savePayload(target, 'data_key', payload);
      expect(savePayloadRes.ok).toBe(true);

      const loadPayloadRes = await adapter.loadPayload(target, 'data_key');
      expect(loadPayloadRes.ok).toBe(true);
      if (loadPayloadRes.ok) {
        expect(loadPayloadRes.value).toEqual(payload);
      }

      const backupRes = await adapter.backupPayload(target, 'data_key', 'ns', payload);
      expect(backupRes.ok).toBe(true);
      if (backupRes.ok) {
        expect(backupRes.value).toContain('__backup__:ns:data_key:');
      }

      const delHeaderRes = await adapter.deleteHeader(target, 'meta_key', 'ns');
      expect(delHeaderRes.ok).toBe(true);

      const delPayloadRes = await adapter.deletePayload(target, 'data_key');
      expect(delPayloadRes.ok).toBe(true);
    }
  });

  it('test_adapter_07: loadHeader returns CHECKSUM_MISMATCH for malformed JSON header', async () => {
    // Manually inject malformed json into adapter in-memory store
    const headerKey = '__schema_meta__:ns:malformed_hdr';
    (adapter as any).setRaw('localStorage', headerKey, '{ invalid json');

    const res = await adapter.loadHeader('localStorage', 'malformed_hdr', 'ns');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('CHECKSUM_MISMATCH');
      expect(res.error.message).toBe("Malformed JSON schema header for key 'malformed_hdr'");
    }
  });

  it('test_adapter_08: loadHeader returns INVALID_SCHEMA_VERSION for primitive JSON header', async () => {
    const headerKey = '__schema_meta__:ns:prim_hdr';
    (adapter as any).setRaw('localStorage', headerKey, '12345');

    const res = await adapter.loadHeader('localStorage', 'prim_hdr', 'ns');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('INVALID_SCHEMA_VERSION');
      expect(res.error.message).toBe("Invalid schema header object for key 'prim_hdr'");
    }
  });

  it('test_adapter_09: loadHeader returns INVALID_SCHEMA_VERSION when version or namespace fields missing', async () => {
    const headerKey = '__schema_meta__:ns:missing_fields';
    (adapter as any).setRaw('localStorage', headerKey, JSON.stringify({ version: 1 })); // missing namespace

    const res = await adapter.loadHeader('localStorage', 'missing_fields', 'ns');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('INVALID_SCHEMA_VERSION');
      expect(res.error.message).toBe(
        "Schema header missing required version or namespace fields for key 'missing_fields'"
      );
    }
  });

  it('test_adapter_10: loadHeader returns CHECKSUM_MISMATCH for tampered checksum', async () => {
    const headerKey = '__schema_meta__:ns:tampered';
    const badHeader = {
      namespace: 'ns',
      version: 1,
      updatedAt: 1000,
      checksum: 'bad_checksum_hash',
      appliedMigrations: [],
    };
    (adapter as any).setRaw('localStorage', headerKey, JSON.stringify(badHeader));

    const expectedChecksum = computeChecksum('ns', 'tampered', 1);
    const res = await adapter.loadHeader('localStorage', 'tampered', 'ns');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('CHECKSUM_MISMATCH');
      expect(res.error.message).toBe(
        `Checksum mismatch for header of key 'tampered'. Expected ${expectedChecksum}, got bad_checksum_hash`
      );
      expect(res.error.version).toBe(1);
    }
  });

  it('test_adapter_11: loadHeader fills default updatedAt and appliedMigrations if omitted', async () => {
    const headerKey = '__schema_meta__:ns:defaults';
    const minimalHeader = {
      namespace: 'ns',
      version: 1,
    };
    (adapter as any).setRaw('localStorage', headerKey, JSON.stringify(minimalHeader));

    const res = await adapter.loadHeader('localStorage', 'defaults', 'ns');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value?.updatedAt).toBeTypeOf('number');
      expect(res.value?.appliedMigrations).toEqual([]);
    }
  });

  it('test_adapter_12: loadPayload returns STORAGE_ADAPTER_ERROR for malformed JSON payload', async () => {
    (adapter as any).setRaw('localStorage', 'bad_json_payload', '{ not json');

    const res = await adapter.loadPayload('localStorage', 'bad_json_payload');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(res.error.message).toBe("Malformed JSON payload for key 'bad_json_payload'");
    }
  });

  it('test_adapter_13: loadPayload returns STORAGE_ADAPTER_ERROR for primitive JSON payload', async () => {
    (adapter as any).setRaw('localStorage', 'prim_payload', '"just a string"');

    const res = await adapter.loadPayload('localStorage', 'prim_payload');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(res.error.message).toBe("Payload for key 'prim_payload' is not a JSON object");
    }
  });

  it('test_adapter_14: adapter error handling when driver/accessor throws unexpected exceptions', async () => {
    const throwingDriver: StorageDriver = {
      getItem: () => {
        throw new Error('Fatal storage read error');
      },
      setItem: () => {
        throw new Error('Fatal storage write error');
      },
      removeItem: () => {
        throw new Error('Fatal storage delete error');
      },
    };

    // Override adapter getRaw to throw directly to test outer try/catch blocks
    const errAdapter = new StorageSchemaMigrationAdapter(undefined, throwingDriver);
    (errAdapter as any).getRaw = () => {
      throw new Error('Uncaught getRaw error');
    };
    (errAdapter as any).setRaw = () => {
      throw new Error('Uncaught setRaw error');
    };
    (errAdapter as any).removeRaw = () => {
      throw new Error('Uncaught removeRaw error');
    };

    const loadHdrRes = await errAdapter.loadHeader('localStorage', 'k', 'ns');
    expect(loadHdrRes.ok).toBe(false);
    if (!loadHdrRes.ok) {
      expect(loadHdrRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(loadHdrRes.error.message).toBe('Failed to load schema header: Uncaught getRaw error');
    }

    const saveHdrRes = await errAdapter.saveHeader('localStorage', 'k', 'ns', {
      namespace: 'ns',
      version: 1,
      updatedAt: 1,
      appliedMigrations: [],
    });
    expect(saveHdrRes.ok).toBe(false);
    if (!saveHdrRes.ok) {
      expect(saveHdrRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(saveHdrRes.error.message).toBe('Failed to save schema header: Uncaught setRaw error');
    }

    const delHdrRes = await errAdapter.deleteHeader('localStorage', 'k', 'ns');
    expect(delHdrRes.ok).toBe(false);
    if (!delHdrRes.ok) {
      expect(delHdrRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(delHdrRes.error.message).toBe('Failed to delete schema header: Uncaught removeRaw error');
    }

    const loadPayloadRes = await errAdapter.loadPayload('localStorage', 'k');
    expect(loadPayloadRes.ok).toBe(false);
    if (!loadPayloadRes.ok) {
      expect(loadPayloadRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(loadPayloadRes.error.message).toBe('Failed to load payload: Uncaught getRaw error');
    }

    const savePayloadRes = await errAdapter.savePayload('localStorage', 'k', {});
    expect(savePayloadRes.ok).toBe(false);
    if (!savePayloadRes.ok) {
      expect(savePayloadRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(savePayloadRes.error.message).toBe('Failed to save payload: Uncaught setRaw error');
    }

    const delPayloadRes = await errAdapter.deletePayload('localStorage', 'k');
    expect(delPayloadRes.ok).toBe(false);
    if (!delPayloadRes.ok) {
      expect(delPayloadRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(delPayloadRes.error.message).toBe('Failed to delete payload: Uncaught removeRaw error');
    }

    const backupRes = await errAdapter.backupPayload('localStorage', 'k', 'ns', {});
    expect(backupRes.ok).toBe(false);
    if (!backupRes.ok) {
      expect(backupRes.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      expect(backupRes.error.message).toBe('Failed to backup payload: Uncaught setRaw error');
    }
  });

  describe('DefaultStorageDriver Direct Browser Simulation Tests', () => {
    it('covers DefaultStorageDriver when window and localStorage/sessionStorage are active or restricted', () => {
      const driver = new DefaultStorageDriver();

      // Test with window defined in test runner or mocked
      const originalWindow = (global as any).window;

      try {
        const mockLocalStorage = {
          getItem: vi.fn((key: string) => (key === 'hit' ? 'stored_val' : null)),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        };

        const mockSessionStorage = {
          getItem: vi.fn((key: string) => (key === 'sess_hit' ? 'sess_val' : null)),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        };

        (global as any).window = {
          localStorage: mockLocalStorage,
          sessionStorage: mockSessionStorage,
        };

        // getItem localStorage hit & miss
        expect(driver.getItem('localStorage', 'hit')).toBe('stored_val');
        expect(driver.getItem('localStorage', 'miss')).toBeNull();

        // getItem sessionStorage hit & miss
        expect(driver.getItem('sessionStorage', 'sess_hit')).toBe('sess_val');
        expect(driver.getItem('sessionStorage', 'miss')).toBeNull();

        // getItem non-browser target
        expect(driver.getItem('indexedDB', 'hit')).toBeNull();

        // setItem localStorage & sessionStorage & indexedDB
        driver.setItem('localStorage', 'k1', 'v1');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('k1', 'v1');

        driver.setItem('sessionStorage', 'k2', 'v2');
        expect(mockSessionStorage.setItem).toHaveBeenCalledWith('k2', 'v2');

        driver.setItem('indexedDB', 'k3', 'v3'); // no-op for driver

        // removeItem localStorage & sessionStorage & indexedDB
        driver.removeItem('localStorage', 'k1');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('k1');

        driver.removeItem('sessionStorage', 'k2');
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('k2');

        driver.removeItem('indexedDB', 'k3'); // no-op for driver

        // Test try/catch inside DefaultStorageDriver when storage methods throw
        mockLocalStorage.getItem.mockImplementation(() => {
          throw new Error('Access denied');
        });
        mockLocalStorage.setItem.mockImplementation(() => {
          throw new Error('Access denied');
        });
        mockLocalStorage.removeItem.mockImplementation(() => {
          throw new Error('Access denied');
        });

        expect(driver.getItem('localStorage', 'hit')).toBeNull();
        expect(() => driver.setItem('localStorage', 'k1', 'v1')).not.toThrow();
        expect(() => driver.removeItem('localStorage', 'k1')).not.toThrow();
      } finally {
        (global as any).window = originalWindow;
      }
    });

    it('test_adapter_15: computeChecksum produces exact deterministic hex hash string', () => {
      const hash1 = computeChecksum('user_ns', 'key1', 1);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBeGreaterThan(0);
      expect(computeChecksum('user_ns', 'key1', 1)).toBe(hash1);
      expect(computeChecksum('user_ns', 'key1', 2)).not.toBe(hash1);
      expect(computeChecksum('user_ns', 'key1', 1)).toBe(computeChecksum('user_ns', 'key1', 1));
    });
  });
});
