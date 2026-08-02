import { Result } from '../../../utils/result';
import {
  StorageLockInfo,
  LockWaiterInfo,
  StorageMutexError,
} from '../../domain/model/storageMutex';
import { StorageMutexRepositoryPort } from '../../domain/ports/secondary/storageMutexRepositoryPort';

export interface StorageBackend {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export class InMemoryStorageBackend implements StorageBackend {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

export class StorageMutexAdapter implements StorageMutexRepositoryPort {
  private static readonly LOCKS_KEY = 'bsse_storage_mutex_locks';
  private static readonly WAITERS_KEY = 'bsse_storage_mutex_waiters';
  private static readonly FENCING_KEY = 'bsse_storage_mutex_fencing';

  private storage: StorageBackend;
  private listeners = new Set<(event: { type: string; payload: any }) => void>();

  private locksCache = new Map<string, StorageLockInfo>();
  private waitersCache: LockWaiterInfo[] = [];
  private fencingCache: Record<string, number> = {};
  private waiterSequence = 0;

  constructor(customStorage?: StorageBackend) {
    if (customStorage) {
      this.storage = customStorage;
    } else if (typeof localStorage !== 'undefined') {
      this.storage = {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
      };
    } else {
      this.storage = new InMemoryStorageBackend();
    }
  }

  public subscribe(listener: (event: { type: string; payload: any }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(type: string, payload: any): void {
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      try {
        listener({ type, payload });
      } catch {
        // ignore listener errors
      }
    }
  }

  private async readLocksMap(): Promise<Map<string, StorageLockInfo>> {
    if (!(this.storage instanceof InMemoryStorageBackend)) {
      try {
        const json = await Promise.resolve(this.storage.getItem(StorageMutexAdapter.LOCKS_KEY));
        if (json && typeof json === 'string') {
          const list = JSON.parse(json) as StorageLockInfo[];
          this.locksCache.clear();
          for (const item of list) {
            this.locksCache.set(item.lockId, item);
          }
        }
      } catch {}
    }
    const now = Date.now();
    for (const item of this.locksCache.values()) {
      if (item.state === 'ACQUIRED' && item.expiresAt > 0 && item.expiresAt <= now) {
        item.state = 'EXPIRED';
      }
    }
    return new Map(this.locksCache);
  }

  private async writeLocksMap(map: Map<string, StorageLockInfo>): Promise<void> {
    if (this.storage instanceof InMemoryStorageBackend) return;
    try {
      const list = Array.from(this.locksCache.values());
      this.storage.setItem(StorageMutexAdapter.LOCKS_KEY, JSON.stringify(list));
    } catch {}
  }

  private async readWaitersList(): Promise<LockWaiterInfo[]> {
    if (!(this.storage instanceof InMemoryStorageBackend)) {
      try {
        const json = await Promise.resolve(this.storage.getItem(StorageMutexAdapter.WAITERS_KEY));
        if (json && typeof json === 'string') {
          this.waitersCache = JSON.parse(json) as LockWaiterInfo[];
        }
      } catch {}
    }
    return [...this.waitersCache];
  }

  private async writeWaitersList(list: LockWaiterInfo[]): Promise<void> {
    if (this.storage instanceof InMemoryStorageBackend) return;
    try {
      this.storage.setItem(StorageMutexAdapter.WAITERS_KEY, JSON.stringify(this.waitersCache));
    } catch {}
  }

  private async readFencingMap(): Promise<Record<string, number>> {
    if (!(this.storage instanceof InMemoryStorageBackend)) {
      try {
        const json = await Promise.resolve(this.storage.getItem(StorageMutexAdapter.FENCING_KEY));
        if (json && typeof json === 'string') {
          this.fencingCache = JSON.parse(json);
        }
      } catch {}
    }
    return this.fencingCache;
  }

  private async writeFencingMap(map: Record<string, number>): Promise<void> {
    if (this.storage instanceof InMemoryStorageBackend) return;
    try {
      this.storage.setItem(StorageMutexAdapter.FENCING_KEY, JSON.stringify(this.fencingCache));
    } catch {}
  }

  async saveLock(lock: StorageLockInfo): Promise<Result<void, StorageMutexError>> {
    try {
      this.locksCache.set(lock.lockId, { ...lock });
      this.writeLocksMap(this.locksCache).catch(() => {});
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to save lock', lock.name, lock.holderId, err)
      );
    }
  }

  async removeLock(lockId: string): Promise<Result<void, StorageMutexError>> {
    try {
      this.locksCache.delete(lockId);
      this.writeLocksMap(this.locksCache).catch(() => {});
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to remove lock', undefined, undefined, err)
      );
    }
  }

  async loadLock(lockId: string): Promise<Result<StorageLockInfo | null, StorageMutexError>> {
    try {
      const map = await this.readLocksMap();
      const lock = map.get(lockId) ?? null;
      return Result.ok(lock);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to load lock', undefined, undefined, err)
      );
    }
  }

  async loadLockByName(name: string): Promise<Result<StorageLockInfo | null, StorageMutexError>> {
    try {
      const map = await this.readLocksMap();
      const active = Array.from(map.values()).find(
        (l) => l.name === name && l.state === 'ACQUIRED'
      );
      return Result.ok(active ?? null);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to load lock by name', name, undefined, err)
      );
    }
  }

  async loadAllLocks(): Promise<Result<StorageLockInfo[], StorageMutexError>> {
    try {
      const map = await this.readLocksMap();
      return Result.ok(Array.from(map.values()));
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to load all locks', undefined, undefined, err)
      );
    }
  }

  async saveWaiter(waiter: LockWaiterInfo): Promise<Result<void, StorageMutexError>> {
    try {
      if (!waiter.sequenceNumber) {
        this.waiterSequence += 1;
        waiter.sequenceNumber = this.waiterSequence;
      }
      const idx = this.waitersCache.findIndex((w) => w.requestId === waiter.requestId);
      if (idx >= 0) {
        this.waitersCache[idx] = { ...waiter };
      } else {
        this.waitersCache.push({ ...waiter });
      }
      this.writeWaitersList(this.waitersCache).catch(() => {});
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to save waiter', waiter.lockName, waiter.requesterId, err)
      );
    }
  }

  async removeWaiter(requestId: string): Promise<Result<boolean, StorageMutexError>> {
    try {
      const initialLen = this.waitersCache.length;
      this.waitersCache = this.waitersCache.filter((w) => w.requestId !== requestId);
      const removed = this.waitersCache.length < initialLen;
      this.writeWaitersList(this.waitersCache).catch(() => {});
      return Result.ok(removed);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to remove waiter', undefined, undefined, err)
      );
    }
  }

  async loadWaiters(): Promise<Result<LockWaiterInfo[], StorageMutexError>> {
    try {
      const waiters = await this.readWaitersList();
      return Result.ok(waiters);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to load waiters', undefined, undefined, err)
      );
    }
  }

  async getFencingToken(name: string): Promise<Result<number, StorageMutexError>> {
    try {
      const map = await this.readFencingMap();
      return Result.ok(map[name] || 0);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to get fencing token', name, undefined, err)
      );
    }
  }

  async incrementFencingToken(name: string): Promise<Result<number, StorageMutexError>> {
    try {
      const next = (this.fencingCache[name] || 0) + 1;
      this.fencingCache[name] = next;
      this.writeFencingMap(this.fencingCache).catch(() => {});
      return Result.ok(next);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to increment fencing token', name, undefined, err)
      );
    }
  }

  async clearAll(): Promise<Result<void, StorageMutexError>> {
    try {
      this.locksCache.clear();
      this.waitersCache = [];
      this.fencingCache = {};
      this.waiterSequence = 0;
      await this.storage.removeItem(StorageMutexAdapter.LOCKS_KEY);
      await this.storage.removeItem(StorageMutexAdapter.WAITERS_KEY);
      await this.storage.removeItem(StorageMutexAdapter.FENCING_KEY);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to clear mutex storage', undefined, undefined, err)
      );
    }
  }
}
