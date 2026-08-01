import { Result } from './result';
import {
  LockMode,
  LockWaiterInfo,
  parseLockPriority,
  StorageLockInfo,
  StorageLockRequestOptions,
  StorageMutexError,
  StorageMutexSnapshot,
} from '../src/domain/model/storageMutex';
import { StorageMutexPort } from '../src/domain/ports/primary/storageMutexPort';
import { StorageMutexRepositoryPort } from '../src/domain/ports/secondary/storageMutexRepositoryPort';
import { StorageMutexAdapter } from '../src/infrastructure/adapters/storageMutexAdapter';

export interface StorageMutexEngineOptions {
  clientId?: string;
  driverType?: 'auto' | 'web-locks' | 'broadcast-channel' | 'in-memory';
  repository?: StorageMutexRepositoryPort;
  heartbeatIntervalMs?: number;
  channelName?: string;
}

interface InternalPromiseWaiter {
  waiterInfo: LockWaiterInfo;
  resolve: (result: Result<StorageLockInfo, StorageMutexError>) => void;
  timerId?: any;
  abortListener?: () => void;
}

export class StorageMutexEngine implements StorageMutexPort {
  public readonly clientId: string;
  private readonly repository: StorageMutexRepositoryPort;
  private driverType: 'web-locks' | 'broadcast-channel' | 'in-memory';
  private channelName: string;

  private broadcastChannel: BroadcastChannel | null = null;
  private unsubscribeRepo: (() => void) | null = null;
  private internalWaiters = new Map<string, InternalPromiseWaiter>(); // requestId -> InternalPromiseWaiter
  private deadlocksDetectedCount = 0;

  private heartbeatIntervalMs: number;
  private heartbeatTimer: any = null;
  private isProcessingQueue = false;

  constructor(options: StorageMutexEngineOptions = {}) {
    this.clientId = options.clientId || `client_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    this.repository = options.repository || new StorageMutexAdapter();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 500;
    this.channelName = options.channelName || 'bsse_storage_mutex_channel';

    const requestedDriver = options.driverType || 'auto';
    if (requestedDriver === 'web-locks') {
      this.driverType = 'web-locks';
    } else if (requestedDriver === 'broadcast-channel') {
      this.driverType = 'broadcast-channel';
    } else if (requestedDriver === 'in-memory') {
      this.driverType = 'in-memory';
    } else {
      if (
        typeof navigator !== 'undefined' &&
        'locks' in navigator &&
        typeof (navigator as any).locks?.request === 'function'
      ) {
        this.driverType = 'web-locks';
      } else if (typeof BroadcastChannel !== 'undefined') {
        this.driverType = 'broadcast-channel';
      } else {
        this.driverType = 'in-memory';
      }
    }

    this.initChannel();
    this.initRepoSubscription();
    this.startHeartbeat();
  }

  private initChannel(): void {
    if (typeof BroadcastChannel !== 'undefined' && this.driverType !== 'in-memory') {
      try {
        this.broadcastChannel = new BroadcastChannel(this.channelName);
        this.broadcastChannel.onmessage = (event) => this.handleChannelMessage(event.data);
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  private initRepoSubscription(): void {
    if (this.repository.subscribe) {
      this.unsubscribeRepo = this.repository.subscribe((data) => this.handleChannelMessage(data));
    }
  }

  private handleChannelMessage(data: any): void {
    if (!data || typeof data !== 'object') return;
    const { type } = data;
    if (
      type === 'LOCK_RELEASED' ||
      type === 'LOCK_GRANTED' ||
      type === 'LOCK_STOLEN' ||
      type === 'LOCK_REQUESTED'
    ) {
      this.processQueue();
    }
  }

  private postMessage(type: string, payload: any): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload, senderId: this.clientId });
      } catch {
        // ignore channel send errors
      }
    }
    if (this.repository.notify) {
      try {
        this.repository.notify(type, payload);
      } catch {
        // ignore repo notify errors
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.pulseHeartbeat();
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private async pulseHeartbeat(): Promise<void> {
    const now = Date.now();
    const locksRes = await this.repository.loadAllLocks();
    if (!locksRes.ok) return;

    for (const lock of locksRes.value) {
      if (lock.holderId === this.clientId && lock.state === 'ACQUIRED') {
        lock.expiresAt = now + lock.leaseDurationMs;
        await this.repository.saveLock(lock);
        this.postMessage('LOCK_HEARTBEAT', {
          lockId: lock.lockId,
          holderId: lock.holderId,
          expiresAt: lock.expiresAt,
        });
      }
    }

    await this.purgeExpiredLocks();
    await this.processQueue();
  }

  private async purgeExpiredLocks(): Promise<void> {
    const locksRes = await this.repository.loadAllLocks();
    if (!locksRes.ok) return;
    const now = Date.now();

    for (const lock of locksRes.value) {
      if (lock.state === 'ACQUIRED' && lock.expiresAt > 0 && lock.expiresAt <= now) {
        lock.state = 'EXPIRED';
        await this.repository.saveLock(lock);
      }
    }
  }

  public async acquire<T>(
    name: string,
    callback: (lock: StorageLockInfo) => Promise<T> | T,
    options?: StorageLockRequestOptions
  ): Promise<Result<T, StorageMutexError>> {
    return this.withLock(name, callback, options);
  }

  public async withLock<T>(
    name: string,
    callback: (lock: StorageLockInfo) => Promise<T> | T,
    options?: StorageLockRequestOptions
  ): Promise<Result<T, StorageMutexError>> {
    const lockResult = await this.acquireLock(name, options);
    if (!lockResult.ok) {
      return Result.err(lockResult.error);
    }

    const lockHandle = lockResult.value;
    try {
      const result = await callback(lockHandle);
      await this.releaseLock(lockHandle.lockId);
      return Result.ok(result);
    } catch (err) {
      await this.releaseLock(lockHandle.lockId);
      if (err instanceof StorageMutexError) {
        return Result.err(err);
      }
      return Result.err(
        new StorageMutexError('ADAPTER_ERROR', 'Callback execution failed under lock', name, lockHandle.holderId, err)
      );
    }
  }

  public async acquireLock(
    name: string,
    options: StorageLockRequestOptions = {}
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return Result.err(new StorageMutexError('INVALID_LOCK_NAME', 'Lock name must be a non-empty string', name));
    }

    const mode: LockMode = options.mode || 'exclusive';
    const timeoutMs = options.timeoutMs ?? 5000;
    const leaseDurationMs = options.leaseDurationMs ?? 3000;
    const priority = parseLockPriority(options.priority);
    const steal = options.steal ?? false;
    const reentrant = options.reentrant ?? true;

    if (timeoutMs < 0 || leaseDurationMs <= 0) {
      return Result.err(new StorageMutexError('INVALID_OPTIONS', 'Invalid timeout or lease duration', name));
    }

    await this.purgeExpiredLocks();

    // Check active locks in repository
    const locksRes = await this.repository.loadAllLocks();
    const allLocks = locksRes.ok ? locksRes.value : [];
    let activeLockList = allLocks.filter((l) => l.name === name && l.state === 'ACQUIRED');

    // 1. Check lock stealing FIRST before re-entrancy
    if (steal && activeLockList.length > 0) {
      for (const oldLock of activeLockList) {
        oldLock.state = 'STOLEN';
        await this.repository.saveLock(oldLock);
      }
      this.postMessage('LOCK_STOLEN', { name, stolenBy: this.clientId });
      activeLockList = [];
    }

    // 2. Re-entrancy check
    const existingSelfLock = activeLockList.find((l) => l.holderId === this.clientId);
    if (existingSelfLock) {
      if (mode === 'exclusive' && existingSelfLock.mode === 'exclusive') {
        if (!reentrant) {
          return Result.err(
            new StorageMutexError('REENTRANT_LOCK_FORBIDDEN', 'Re-entrant lock acquisition disabled', name, this.clientId)
          );
        }
        existingSelfLock.reentrancyDepth += 1;
        existingSelfLock.expiresAt = Date.now() + leaseDurationMs;
        await this.repository.saveLock(existingSelfLock);
        return Result.ok({ ...existingSelfLock });
      }
    }

    // Evaluate immediate availability
    const refreshedLocksRes = await this.repository.loadAllLocks();
    const refreshedActive = (refreshedLocksRes.ok ? refreshedLocksRes.value : []).filter(
      (l) => l.name === name && l.state === 'ACQUIRED'
    );

    let canGrant = false;
    if (refreshedActive.length === 0) {
      canGrant = true;
    } else if (mode === 'shared' && refreshedActive.every((l) => l.mode === 'shared')) {
      canGrant = true;
    }

    if (canGrant) {
      return this.grantNewLock(name, mode, leaseDurationMs, priority);
    }

    if (options.ifAvailable) {
      return Result.err(
        new StorageMutexError('LOCK_CONTENTION', `Lock '${name}' is currently held and non-blocking was requested`, name)
      );
    }

    // Deadlock detection before queueing
    if (await this.detectDeadlock(this.clientId, name)) {
      this.deadlocksDetectedCount += 1;
      return Result.err(
        new StorageMutexError('DEADLOCK_DETECTED', `Deadlock cycle detected for requester '${this.clientId}' on lock '${name}'`, name, this.clientId)
      );
    }

    // Prepare waiter info
    const requestId = `req_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    const waiterInfo: LockWaiterInfo = {
      requestId,
      lockName: name,
      requesterId: this.clientId,
      mode,
      priority,
      requestedAt: Date.now(),
      timeoutMs,
    };

    // Save waiter to repository first so other threads/engines can see it immediately
    await this.repository.saveWaiter(waiterInfo);
    this.postMessage('LOCK_REQUESTED', { requestId, name });

    // Queue request promise
    return this.enqueueWaiter(waiterInfo, timeoutMs, options.signal);
  }

  private async grantNewLock(
    name: string,
    mode: LockMode,
    leaseDurationMs: number,
    priority: number
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    const now = Date.now();
    const lockId = `lock_${Math.random().toString(36).substring(2, 9)}_${now}`;

    const fencingRes = await this.repository.incrementFencingToken(name);
    const fencingToken = fencingRes.ok ? fencingRes.value : 1;

    const lockInfo: StorageLockInfo = {
      lockId,
      name,
      holderId: this.clientId,
      mode,
      acquiredAt: now,
      expiresAt: now + leaseDurationMs,
      leaseDurationMs,
      reentrancyDepth: 1,
      priority,
      state: 'ACQUIRED',
      fencingToken,
    };

    await this.repository.saveLock(lockInfo);
    this.postMessage('LOCK_GRANTED', { lockId, name, holderId: this.clientId });

    return Result.ok({ ...lockInfo });
  }

  private enqueueWaiter(
    waiterInfo: LockWaiterInfo,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    return new Promise((resolve) => {
      const name = waiterInfo.lockName;
      const requestId = waiterInfo.requestId;

      if (signal?.aborted) {
        this.removeWaiterInternal(requestId);
        return resolve(
          Result.err(new StorageMutexError('ABORTED', 'Lock request aborted before queueing', name, this.clientId))
        );
      }

      const internalWaiter: InternalPromiseWaiter = {
        waiterInfo,
        resolve,
      };

      if (timeoutMs > 0 && timeoutMs < Infinity) {
        internalWaiter.timerId = setTimeout(async () => {
          await this.removeWaiterInternal(requestId);
          resolve(
            Result.err(
              new StorageMutexError(
                'ACQUISITION_TIMEOUT',
                `Lock acquisition timed out after ${timeoutMs}ms`,
                name,
                this.clientId
              )
            )
          );
        }, timeoutMs);
        if (internalWaiter.timerId && typeof internalWaiter.timerId.unref === 'function') {
          internalWaiter.timerId.unref();
        }
      }

      if (signal) {
        const abortListener = async () => {
          await this.removeWaiterInternal(requestId);
          if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
          resolve(
            Result.err(new StorageMutexError('ABORTED', 'Lock request aborted while waiting in queue', name, this.clientId))
          );
        };
        signal.addEventListener('abort', abortListener, { once: true });
        internalWaiter.abortListener = abortListener;
      }

      this.internalWaiters.set(requestId, internalWaiter);

      // Trigger queue processing
      this.processQueue();
    });
  }

  private async removeWaiterInternal(requestId: string): Promise<void> {
    const internal = this.internalWaiters.get(requestId);
    if (internal) {
      if (internal.timerId) clearTimeout(internal.timerId);
      this.internalWaiters.delete(requestId);
    }
    await this.repository.removeWaiter(requestId);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      await this.purgeExpiredLocks();

      const waitersRes = await this.repository.loadWaiters();
      const waiters = waitersRes.ok ? waitersRes.value : [];
      if (waiters.length === 0) return;

      // Sort waiters by priority (descending) and requestedAt (ascending)
      waiters.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.requestedAt - b.requestedAt;
      });

      const locksRes = await this.repository.loadAllLocks();
      const allLocks = locksRes.ok ? locksRes.value : [];

      for (const waiter of waiters) {
        const name = waiter.lockName;
        const mode = waiter.mode;

        const activeList = allLocks.filter(
          (l) => l.name === name && l.state === 'ACQUIRED'
        );

        let canGrant = false;
        if (activeList.length === 0) {
          canGrant = true;
        } else if (mode === 'shared' && activeList.every((l) => l.mode === 'shared')) {
          canGrant = true;
        }

        if (canGrant) {
          await this.repository.removeWaiter(waiter.requestId);

          const now = Date.now();
          const lockId = `lock_${Math.random().toString(36).substring(2, 9)}_${now}`;

          const fencingRes = await this.repository.incrementFencingToken(name);
          const fencingToken = fencingRes.ok ? fencingRes.value : 1;

          const lockInfo: StorageLockInfo = {
            lockId,
            name,
            holderId: waiter.requesterId,
            mode,
            acquiredAt: now,
            expiresAt: now + 3000,
            leaseDurationMs: 3000,
            reentrancyDepth: 1,
            priority: waiter.priority,
            state: 'ACQUIRED',
            fencingToken,
          };

          await this.repository.saveLock(lockInfo);
          allLocks.push(lockInfo);

          this.postMessage('LOCK_GRANTED', { lockId, name, holderId: waiter.requesterId });

          const internal = this.internalWaiters.get(waiter.requestId);
          if (internal) {
            if (internal.timerId) clearTimeout(internal.timerId);
            this.internalWaiters.delete(waiter.requestId);
            internal.resolve(Result.ok({ ...lockInfo }));
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async detectDeadlock(requesterId: string, requestedLockName: string): Promise<boolean> {
    const locksRes = await this.repository.loadAllLocks();
    const waitersRes = await this.repository.loadWaiters();

    const allLocks = locksRes.ok ? locksRes.value : [];
    const allWaiters = waitersRes.ok ? waitersRes.value : [];

    const visited = new Set<string>();
    const stack = new Set<string>();

    const checkCycle = (currHolderId: string): boolean => {
      if (currHolderId === requesterId) return true;
      if (visited.has(currHolderId)) return false;

      visited.add(currHolderId);
      stack.add(currHolderId);

      const waitingLocks = allWaiters
        .filter((w) => w.requesterId === currHolderId)
        .map((w) => w.lockName);

      for (const targetLockName of waitingLocks) {
        const targetHolders = allLocks
          .filter((l) => l.name === targetLockName && l.state === 'ACQUIRED')
          .map((l) => l.holderId);

        for (const nextHolder of targetHolders) {
          if (stack.has(nextHolder) || checkCycle(nextHolder)) {
            return true;
          }
        }
      }

      stack.delete(currHolderId);
      return false;
    };

    const directHolders = allLocks
      .filter((l) => l.name === requestedLockName && l.state === 'ACQUIRED')
      .map((l) => l.holderId);

    for (const holder of directHolders) {
      if (checkCycle(holder)) {
        return true;
      }
    }

    return false;
  }

  public async releaseLock(lockId: string): Promise<Result<void, StorageMutexError>> {
    await this.purgeExpiredLocks();

    const locksRes = await this.repository.loadAllLocks();
    const allLocks = locksRes.ok ? locksRes.value : [];

    let lock = allLocks.find((l) => l.lockId === lockId || (l.name === lockId && l.holderId === this.clientId));

    if (!lock) {
      return Result.err(new StorageMutexError('LOCK_NOT_HELD', `Lock '${lockId}' is not active or held`, lockId));
    }

    if (lock.state === 'EXPIRED') {
      await this.repository.removeLock(lock.lockId);
      return Result.err(new StorageMutexError('LOCK_EXPIRED', `Lock '${lock.name}' has expired`, lock.name, lock.holderId));
    }

    if (lock.state === 'STOLEN') {
      await this.repository.removeLock(lock.lockId);
      return Result.err(new StorageMutexError('LOCK_NOT_HELD', `Lock '${lock.name}' was preempted / stolen`, lock.name, lock.holderId));
    }

    if (lock.reentrancyDepth > 1) {
      lock.reentrancyDepth -= 1;
      await this.repository.saveLock(lock);
      return Result.ok(undefined);
    }

    lock.state = 'RELEASED';
    await this.repository.removeLock(lock.lockId);
    this.postMessage('LOCK_RELEASED', { lockId: lock.lockId, name: lock.name, holderId: this.clientId });

    await this.processQueue();
    return Result.ok(undefined);
  }

  public async refreshLock(lockId: string): Promise<Result<StorageLockInfo, StorageMutexError>> {
    const lockRes = await this.repository.loadLock(lockId);
    let lock = lockRes.ok ? lockRes.value : null;

    if (!lock) {
      const locksRes = await this.repository.loadAllLocks();
      const found = (locksRes.ok ? locksRes.value : []).find(
        (l) => (l.lockId === lockId || l.name === lockId) && l.holderId === this.clientId
      );
      if (found) lock = found;
    }

    if (!lock || lock.state !== 'ACQUIRED') {
      return Result.err(new StorageMutexError('LOCK_NOT_HELD', `Lock '${lockId}' is not active or held`, lockId));
    }

    lock.expiresAt = Date.now() + lock.leaseDurationMs;
    await this.repository.saveLock(lock);
    this.postMessage('LOCK_HEARTBEAT', {
      lockId: lock.lockId,
      holderId: lock.holderId,
      expiresAt: lock.expiresAt,
    });

    return Result.ok({ ...lock });
  }

  public async stealLock(
    name: string,
    options?: StorageLockRequestOptions
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    return this.acquireLock(name, { ...options, steal: true });
  }

  public async isLocked(name: string): Promise<Result<boolean, StorageMutexError>> {
    await this.purgeExpiredLocks();
    const locksRes = await this.repository.loadAllLocks();
    const active = (locksRes.ok ? locksRes.value : []).some(
      (l) => l.name === name && l.state === 'ACQUIRED'
    );
    return Result.ok(active);
  }

  public async getLockInfo(name: string): Promise<Result<StorageLockInfo | null, StorageMutexError>> {
    await this.purgeExpiredLocks();
    const locksRes = await this.repository.loadAllLocks();
    const active = (locksRes.ok ? locksRes.value : []).find(
      (l) => l.name === name && l.state === 'ACQUIRED'
    );
    return Result.ok(active ? { ...active } : null);
  }

  public async getSnapshot(): Promise<Result<StorageMutexSnapshot, StorageMutexError>> {
    await this.purgeExpiredLocks();
    const locksRes = await this.repository.loadAllLocks();
    const waitersRes = await this.repository.loadWaiters();

    const activeLocks = (locksRes.ok ? locksRes.value : [])
      .filter((l) => l.state === 'ACQUIRED')
      .map((l) => ({ ...l }));

    const waitingQueue = (waitersRes.ok ? waitersRes.value : []).map((w) => ({ ...w }));

    return Result.ok({
      activeLocks,
      waitingQueue,
      deadlocksDetected: this.deadlocksDetectedCount,
      adapterType: this.driverType,
    });
  }

  public async forceReleaseAll(): Promise<Result<number, StorageMutexError>> {
    const locksRes = await this.repository.loadAllLocks();
    const activeCount = (locksRes.ok ? locksRes.value : []).length;

    for (const internal of this.internalWaiters.values()) {
      if (internal.timerId) clearTimeout(internal.timerId);
      internal.resolve(
        Result.err(new StorageMutexError('ABORTED', 'Forced release of all active locks', internal.waiterInfo.lockName))
      );
    }
    this.internalWaiters.clear();

    await this.repository.clearAll();
    this.postMessage('LOCK_RELEASED', { all: true });

    return Result.ok(activeCount);
  }

  public destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.unsubscribeRepo) {
      this.unsubscribeRepo();
      this.unsubscribeRepo = null;
    }
  }
}
