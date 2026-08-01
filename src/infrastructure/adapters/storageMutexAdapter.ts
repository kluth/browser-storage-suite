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
    for (const listener of Array.from(this.listeners)) {
      try {
        listener({ type, payload });
      } catch {
        // ignore listener errors
      }
    }
  }

  private async readLocksMap(): Promise<Map<string, StorageLockInfo>> {
    try {
      const raw = await this.storage.getItem(StorageMutexAdapter.LOCKS_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as StorageLockInfo[];
      const map = new Map<string, StorageLockInfo>();
      const now = Date.now();
      for (const item of parsed) {
        if (item.state === 'ACQUIRED' && item.expiresAt > 0 && item.expiresAt <= now) {
          item.state = 'EXPIRED';
        }
        map.set(item.lockId, item);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private async writeLocksMap(map: Map<string, StorageLockInfo>): Promise<void> {
    const list = Array.from(map.values());
    await this.storage.setItem(StorageMutexAdapter.LOCKS_KEY, JSON.stringify(list));
  }

  private async readWaitersList(): Promise<LockWaiterInfo[]> {
    try {
      const raw = await this.storage.getItem(StorageMutexAdapter.WAITERS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as LockWaiterInfo[];
    } catch {
      return [];
    }
  }

  private async writeWaitersList(list: LockWaiterInfo[]): Promise<void> {
    await this.storage.setItem(StorageMutexAdapter.WAITERS_KEY, JSON.stringify(list));
  }

  private async readFencingMap(): Promise<Record<string, number>> {
    try {
      const raw = await this.storage.getItem(StorageMutexAdapter.FENCING_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }

  private async writeFencingMap(map: Record<string, number>): Promise<void> {
    await this.storage.setItem(StorageMutexAdapter.FENCING_KEY, JSON.stringify(map));
  }

  async saveLock(lock: StorageLockInfo): Promise<Result<void, StorageMutexError>> {
    try {
      const map = await this.readLocksMap();
      map.set(lock.lockId, { ...lock });
      await this.writeLocksMap(map);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to save lock', lock.name, lock.holderId, err)
      );
    }
  }

  async removeLock(lockId: string): Promise<Result<void, StorageMutexError>> {
    try {
      const map = await this.readLocksMap();
      map.delete(lockId);
      await this.writeLocksMap(map);
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
      const waiters = await this.readWaitersList();
      const idx = waiters.findIndex((w) => w.requestId === waiter.requestId);
      if (idx >= 0) {
        waiters[idx] = waiter;
      } else {
        waiters.push(waiter);
      }
      await this.writeWaitersList(waiters);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to save waiter', waiter.lockName, waiter.requesterId, err)
      );
    }
  }

  async removeWaiter(requestId: string): Promise<Result<void, StorageMutexError>> {
    try {
      let waiters = await this.readWaitersList();
      waiters = waiters.filter((w) => w.requestId !== requestId);
      await this.writeWaitersList(waiters);
      return Result.ok(undefined);
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
      const map = await this.readFencingMap();
      const next = (map[name] || 0) + 1;
      map[name] = next;
      await this.writeFencingMap(map);
      return Result.ok(next);
    } catch (err) {
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Failed to increment fencing token', name, undefined, err)
      );
    }
  }

  async clearAll(): Promise<Result<void, StorageMutexError>> {
    try {
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
