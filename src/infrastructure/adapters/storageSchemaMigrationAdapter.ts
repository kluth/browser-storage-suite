import { Result } from '../../../utils/result';
import { StorageTarget } from '../../domain/model/valueObjects';
import {
  SchemaVersionHeader,
  StorageSchemaMigrationError,
} from '../../domain/model/storageSchemaMigration';
import { StorageSchemaMigrationRepositoryPort } from '../../domain/ports/secondary/storageSchemaMigrationRepositoryPort';
import { StorageRepositoryPort } from '../../domain/ports/secondary/storageRepositoryPort';

export function computeChecksum(namespace: string, key: string, version: number): string {
  const input = `${namespace}:${key}:${version}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export interface StorageDriver {
  getItem(target: StorageTarget, key: string): string | null;
  setItem(target: StorageTarget, key: string, value: string): void;
  removeItem(target: StorageTarget, key: string): void;
}

export class DefaultStorageDriver implements StorageDriver {
  public getItem(target: StorageTarget, key: string): string | null {
    if (typeof window !== 'undefined') {
      try {
        if (target === 'localStorage' && window.localStorage) {
          const val = window.localStorage.getItem(key);
          if (val !== null) return val;
        } else if (target === 'sessionStorage' && window.sessionStorage) {
          const val = window.sessionStorage.getItem(key);
          if (val !== null) return val;
        }
      } catch {
        // Fall back to in-memory store on storage access restriction
      }
    }
    return null;
  }

  public setItem(target: StorageTarget, key: string, value: string): void {
    if (typeof window !== 'undefined') {
      try {
        if (target === 'localStorage' && window.localStorage) {
          window.localStorage.setItem(key, value);
        } else if (target === 'sessionStorage' && window.sessionStorage) {
          window.sessionStorage.setItem(key, value);
        }
      } catch {
        // Fall back to in-memory store on storage failure
      }
    }
  }

  public removeItem(target: StorageTarget, key: string): void {
    if (typeof window !== 'undefined') {
      try {
        if (target === 'localStorage' && window.localStorage) {
          window.localStorage.removeItem(key);
        } else if (target === 'sessionStorage' && window.sessionStorage) {
          window.sessionStorage.removeItem(key);
        }
      } catch {
        // Fall back to in-memory store on storage failure
      }
    }
  }
}

export class StorageSchemaMigrationAdapter implements StorageSchemaMigrationRepositoryPort {
  private inMemoryStores: Map<StorageTarget, Map<string, string>> = new Map();
  private storageRepo?: StorageRepositoryPort;
  private driver: StorageDriver;

  constructor(storageRepo?: StorageRepositoryPort, driver?: StorageDriver) {
    this.storageRepo = storageRepo;
    this.driver = driver ?? new DefaultStorageDriver();
  }

  private getStore(target: StorageTarget): Map<string, string> {
    let store = this.inMemoryStores.get(target);
    if (!store) {
      store = new Map<string, string>();
      this.inMemoryStores.set(target, store);
    }
    return store;
  }

  private getRaw(target: StorageTarget, key: string): string | null {
    try {
      const driverVal = this.driver.getItem(target, key);
      if (driverVal !== null) return driverVal;
    } catch {
      // Fall back to in-memory store on storage access restriction
    }
    const store = this.getStore(target);
    return store.get(key) ?? null;
  }

  private setRaw(target: StorageTarget, key: string, value: string): void {
    const store = this.getStore(target);
    store.set(key, value);
    try {
      this.driver.setItem(target, key, value);
    } catch {
      // Fall back to in-memory store on storage failure
    }
  }

  private removeRaw(target: StorageTarget, key: string): void {
    const store = this.getStore(target);
    store.delete(key);
    try {
      this.driver.removeItem(target, key);
    } catch {
      // Fall back to in-memory store on storage failure
    }
  }

  public async loadHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<SchemaVersionHeader | null, StorageSchemaMigrationError>> {
    try {
      const headerKey = `__schema_meta__:${namespace}:${key}`;
      const raw = this.getRaw(target, headerKey);
      if (raw === null) {
        return Result.ok(null);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return Result.err(
          new StorageSchemaMigrationError(
            'CHECKSUM_MISMATCH',
            `Malformed JSON schema header for key '${key}'`,
            undefined,
            undefined,
            e
          )
        );
      }

      if (typeof parsed !== 'object' || parsed === null) {
        return Result.err(
          new StorageSchemaMigrationError(
            'INVALID_SCHEMA_VERSION',
            `Invalid schema header object for key '${key}'`
          )
        );
      }

      const h = parsed as Partial<SchemaVersionHeader>;
      if (typeof h.version !== 'number' || typeof h.namespace !== 'string') {
        return Result.err(
          new StorageSchemaMigrationError(
            'INVALID_SCHEMA_VERSION',
            `Schema header missing required version or namespace fields for key '${key}'`
          )
        );
      }

      if (h.checksum) {
        const expectedChecksum = computeChecksum(namespace, key, h.version);
        if (h.checksum !== expectedChecksum) {
          return Result.err(
            new StorageSchemaMigrationError(
              'CHECKSUM_MISMATCH',
              `Checksum mismatch for header of key '${key}'. Expected ${expectedChecksum}, got ${h.checksum}`,
              h.version
            )
          );
        }
      }

      const header: SchemaVersionHeader = {
        namespace: h.namespace,
        version: h.version,
        updatedAt: typeof h.updatedAt === 'number' ? h.updatedAt : Date.now(),
        checksum: h.checksum,
        appliedMigrations: Array.isArray(h.appliedMigrations) ? h.appliedMigrations : [],
      };

      return Result.ok(header);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to load schema header: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async saveHeader(
    target: StorageTarget,
    key: string,
    namespace: string,
    header: SchemaVersionHeader
  ): Promise<Result<void, StorageSchemaMigrationError>> {
    try {
      const headerKey = `__schema_meta__:${namespace}:${key}`;
      const headerToSave: SchemaVersionHeader = {
        ...header,
        checksum: header.checksum ?? computeChecksum(namespace, key, header.version),
      };
      this.setRaw(target, headerKey, JSON.stringify(headerToSave));
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to save schema header: ${err instanceof Error ? err.message : String(err)}`,
          header.version,
          undefined,
          err
        )
      );
    }
  }

  public async deleteHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<void, StorageSchemaMigrationError>> {
    try {
      const headerKey = `__schema_meta__:${namespace}:${key}`;
      this.removeRaw(target, headerKey);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to delete schema header: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async loadPayload(
    target: StorageTarget,
    key: string
  ): Promise<Result<Record<string, unknown> | null, StorageSchemaMigrationError>> {
    try {
      const raw = this.getRaw(target, key);
      if (raw === null) {
        return Result.ok(null);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return Result.err(
          new StorageSchemaMigrationError(
            'STORAGE_ADAPTER_ERROR',
            `Malformed JSON payload for key '${key}'`,
            undefined,
            undefined,
            e
          )
        );
      }

      if (typeof parsed !== 'object' || parsed === null) {
        return Result.err(
          new StorageSchemaMigrationError(
            'STORAGE_ADAPTER_ERROR',
            `Payload for key '${key}' is not a JSON object`
          )
        );
      }

      return Result.ok(parsed as Record<string, unknown>);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to load payload: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async savePayload(
    target: StorageTarget,
    key: string,
    payload: Record<string, unknown>
  ): Promise<Result<void, StorageSchemaMigrationError>> {
    try {
      this.setRaw(target, key, JSON.stringify(payload));
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to save payload: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async deletePayload(
    target: StorageTarget,
    key: string
  ): Promise<Result<void, StorageSchemaMigrationError>> {
    try {
      this.removeRaw(target, key);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to delete payload: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async backupPayload(
    target: StorageTarget,
    key: string,
    namespace: string,
    payload: Record<string, unknown>
  ): Promise<Result<string, StorageSchemaMigrationError>> {
    try {
      const backupKey = `__backup__:${namespace}:${key}:${Date.now()}`;
      this.setRaw(target, backupKey, JSON.stringify(payload));
      return Result.ok(backupKey);
    } catch (err) {
      return Result.err(
        new StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          `Failed to backup payload: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }
}
