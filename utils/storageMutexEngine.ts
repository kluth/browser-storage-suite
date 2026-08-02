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
  resolved?: boolean;
}

export class StorageMutexEngine implements StorageMutexPort {
  public readonly clientId: string;
  private readonly repository: StorageMutexRepositoryPort;
  private driverType: 'web-locks' | 'broadcast-channel' | 'in-memory';
  private channelName: string;

  private broadcastChannel: BroadcastChannel | null = null;
  private unsubscribeRepo: (() => void) | null = null;
  private internalWaiters = new Map<string, InternalPromiseWaiter>(); // requestId -> InternalPromiseWaiter
  private activeWebLocks = new Map<
    string,
    { lockId: string; name: string; releaseResolver: () => void; lockInfo: StorageLockInfo }
  >();
  private activeWatchdogs = new Map<string, any>();
  private deadlocksDetectedCount = 0;

  private heartbeatIntervalMs: number;
  private heartbeatTimer: any = null;
  private isProcessingQueue = false;
  private hasPendingQueueWork = false;
  private seenMessages = new Set<string>();

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

  private async handleChannelMessage(data: any): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const type = data.type;
    const payload = data.payload || data;
    const senderId = data.senderId || payload.senderId;

    const msgId = `${type}_${payload?.requestId || ''}_${payload?.lockId || ''}_${payload?.holderId || ''}`;
    if (msgId.length > 10 && this.seenMessages.has(msgId)) return;
    if (msgId.length > 10) {
      this.seenMessages.add(msgId);
      if (this.seenMessages.size > 500) {
        const first = this.seenMessages.values().next().value;
        if (first) this.seenMessages.delete(first);
      }
    }

    if (type === 'LOCK_GRANTED' && payload) {
      const requesterId = payload.requesterId || payload.holderId;
      const reqId = payload.requestId;
      const lockName = payload.lockName || payload.name || payload.key;

      if (requesterId === this.clientId || (reqId && this.internalWaiters.has(reqId))) {
        let internal: InternalPromiseWaiter | undefined = reqId ? this.internalWaiters.get(reqId) : undefined;
        if (!internal && lockName) {
          const matching = Array.from(this.internalWaiters.values())
            .filter((w) => w.waiterInfo.lockName === lockName && w.waiterInfo.requesterId === requesterId)
            .sort((a, b) => b.waiterInfo.priority - a.waiterInfo.priority);
          if (matching.length > 0) {
            internal = matching[0];
          }
        }

        if (internal) {
          if (internal.timerId) clearTimeout(internal.timerId);
          this.internalWaiters.delete(internal.waiterInfo.requestId);
          await this.repository.removeWaiter(internal.waiterInfo.requestId);
          const lockInfo: StorageLockInfo = payload.lockInfo || {
            lockId: payload.lockId || `lock_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
            name: lockName,
            holderId: requesterId,
            mode: internal.waiterInfo.mode,
            acquiredAt: payload.acquiredAt || Date.now(),
            expiresAt: payload.expiresAt || Date.now() + internal.waiterInfo.leaseDurationMs,
            leaseDurationMs: internal.waiterInfo.leaseDurationMs,
            reentrancyDepth: 1,
            priority: internal.waiterInfo.priority,
            state: 'ACQUIRED',
            fencingToken: payload.fencingToken || 1,
          };
          internal.resolve(Result.ok(lockInfo));
        }
      }
    }

    if (type === 'DEADLOCK_DETECTED' && payload) {
      const requesterId = payload.requesterId || payload.holderId;
      const reqId = payload.requestId;
      const lockName = payload.lockName || payload.name || payload.key;

      if (requesterId === this.clientId || (reqId && this.internalWaiters.has(reqId))) {
        let internal: InternalPromiseWaiter | undefined = reqId ? this.internalWaiters.get(reqId) : undefined;
        if (!internal && lockName) {
          const matching = Array.from(this.internalWaiters.values())
            .filter((w) => w.waiterInfo.lockName === lockName && w.waiterInfo.requesterId === requesterId)
            .sort((a, b) => b.waiterInfo.priority - a.waiterInfo.priority);
          if (matching.length > 0) {
            internal = matching[0];
          }
        }

        if (internal) {
          this.deadlocksDetectedCount += 1;
          if (internal.timerId) clearTimeout(internal.timerId);
          this.internalWaiters.delete(internal.waiterInfo.requestId);
          await this.repository.removeWaiter(internal.waiterInfo.requestId);
          internal.resolve(
            Result.err(
              new StorageMutexError(
                'DEADLOCK_DETECTED',
                payload.error?.message || `Deadlock cycle detected for requester '${requesterId}' on lock '${lockName}'`,
                lockName,
                requesterId
              )
            )
          );
        }
      }
    }

    if (senderId && senderId === this.clientId) return;

    if (
      type === 'LOCK_RELEASED' ||
      type === 'LOCK_STOLEN' ||
      type === 'LOCK_REQUESTED' ||
      (type === 'LOCK_GRANTED' && (payload?.requesterId === this.clientId || payload?.holderId === this.clientId))
    ) {
      queueMicrotask(() => this.processQueue());
    }
  }

  private postMessage(type: string, payload: any): void {
    const fullPayload = { ...payload, senderId: this.clientId };
    if (this.repository.notify) {
      try {
        this.repository.notify(type, fullPayload);
      } catch {
        // ignore repo notify errors
      }
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload: fullPayload, senderId: this.clientId });
      } catch {
        // ignore channel send errors
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

    let holdsAny = false;
    for (const lock of locksRes.value) {
      if (lock.holderId === this.clientId && lock.state === 'ACQUIRED') {
        holdsAny = true;
        lock.expiresAt = now + lock.leaseDurationMs;
        await this.repository.saveLock(lock);
        this.postMessage('LOCK_HEARTBEAT', {
          lockId: lock.lockId,
          holderId: lock.holderId,
          expiresAt: lock.expiresAt,
        });
      }
    }

    const hasExpired = locksRes.value.some(
      (l) => l.state === 'ACQUIRED' && l.expiresAt > 0 && l.expiresAt <= now
    );

    if (hasExpired) {
      await this.purgeExpiredLocks();
      await this.processQueue();
    } else if (holdsAny || this.internalWaiters.size > 0) {
      await this.processQueue();
    }
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

    if (this.driverType === 'web-locks') {
      if (
        typeof navigator !== 'undefined' &&
        'locks' in navigator &&
        typeof (navigator as any).locks?.request === 'function'
      ) {
        return this.acquireLockWebLocks(name, options);
      } else if (options.driverType === 'web-locks') {
        return Result.err(
          new StorageMutexError(
            'ADAPTER_ERROR',
            'Native Web Locks API navigator.locks is unavailable in this environment',
            name,
            this.clientId
          )
        );
      }
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

    if (options.signal?.aborted) {
      return Result.err(
        new StorageMutexError('ABORTED', 'Lock request aborted before queueing', name, this.clientId)
      );
    }

    // Register internal waiter promise synchronously BEFORE any async calls
    const requestId = `req_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    const waiterInfo: LockWaiterInfo = {
      requestId,
      lockName: name,
      requesterId: this.clientId,
      mode,
      priority,
      requestedAt: this.getMonotonicTimestamp(),
      timeoutMs,
      leaseDurationMs,
    };

    let resolveWaiter!: (res: Result<StorageLockInfo, StorageMutexError>) => void;
    const waiterPromise = new Promise<Result<StorageLockInfo, StorageMutexError>>((res) => {
      resolveWaiter = res;
    });

    const internalWaiter: InternalPromiseWaiter = {
      waiterInfo,
      resolve: resolveWaiter,
    };

    this.internalWaiters.set(requestId, internalWaiter);

    if (timeoutMs > 0 && timeoutMs < Infinity) {
      internalWaiter.timerId = setTimeout(async () => {
        await this.removeWaiterInternal(requestId);
        resolveWaiter(
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

    if (options.signal) {
      const abortListener = async () => {
        await this.removeWaiterInternal(requestId);
        if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
        resolveWaiter(
          Result.err(new StorageMutexError('ABORTED', 'Lock request aborted while waiting in queue', name, this.clientId))
        );
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
      internalWaiter.abortListener = abortListener;
    }

    await this.purgeExpiredLocks();

    const locksRes = await this.repository.loadAllLocks();
    const allLocks = locksRes.ok ? locksRes.value : [];
    let activeLockList = allLocks.filter((l) => l.name === name && l.state === 'ACQUIRED');

    // 1. Lock stealing check
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
          if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
          this.internalWaiters.delete(requestId);
          return Result.err(
            new StorageMutexError(
              'REENTRANT_LOCK_FORBIDDEN',
              `Re-entrant lock acquisition forbidden for '${name}'`,
              name,
              this.clientId
            )
          );
        }
        existingSelfLock.reentrancyDepth += 1;
        existingSelfLock.expiresAt = Date.now() + leaseDurationMs;
        await this.repository.saveLock(existingSelfLock);
        if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
        this.internalWaiters.delete(requestId);
        return Result.ok({ ...existingSelfLock });
      }
    }



    const waitersRes = await this.repository.loadWaiters();
    const existingWaiters = (waitersRes.ok ? waitersRes.value : []).filter((w) => w.lockName === name);

    let canGrant = false;
    if (activeLockList.length === 0 && existingWaiters.length === 0) {
      canGrant = true;
    } else if (
      mode === 'shared' &&
      activeLockList.every((l) => l.mode === 'shared') &&
      existingWaiters.every((w) => w.mode === 'shared')
    ) {
      canGrant = true;
    }

    if (canGrant) {
      const grantRes = await this.grantNewLock(name, mode, leaseDurationMs, priority, requestId);
      if (grantRes.ok) {
        this.internalWaiters.delete(requestId);
        if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
        return grantRes;
      }
    }

    if (options.ifAvailable) {
      this.internalWaiters.delete(requestId);
      if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
      return Result.err(
        new StorageMutexError('LOCK_CONTENTION', `Lock '${name}' is currently held and non-blocking was requested`, name)
      );
    }

    await this.repository.saveWaiter(waiterInfo);
    this.postMessage('LOCK_REQUESTED', { requestId, name });

    // Deadlock detection after queueing waiter info — reload fresh locks snapshot to capture concurrent tab state
    const freshLocksRes = await this.repository.loadAllLocks();
    const freshLocks = freshLocksRes.ok ? freshLocksRes.value : [];

    const holdsAnyLock = freshLocks.some((l) => l.holderId === this.clientId && l.state === 'ACQUIRED');
    if (holdsAnyLock) {
      const waitersRes = await this.repository.loadWaiters();
      const currentWaiters = waitersRes.ok ? waitersRes.value : [];
      if (this.detectDeadlockWithData(this.clientId, name, freshLocks, currentWaiters)) {
        this.deadlocksDetectedCount += 1;
        await this.removeWaiterInternal(requestId);
        if (internalWaiter.timerId) clearTimeout(internalWaiter.timerId);
        this.postMessage('DEADLOCK_DETECTED', {
          requestId,
          lockName: name,
          name,
          requesterId: this.clientId,
          holderId: this.clientId,
          error: {
            kind: 'DEADLOCK_DETECTED',
            message: `Deadlock cycle detected for requester '${this.clientId}' on lock '${name}'`,
          },
        });
        return Result.err(
          new StorageMutexError(
            'DEADLOCK_DETECTED',
            `Deadlock cycle detected for requester '${this.clientId}' on lock '${name}'`,
            name,
            this.clientId
          )
        );
      }
    }

    // Trigger queue processing
    this.processQueue();

    return waiterPromise;
  }

  private async acquireLockWebLocks(
    name: string,
    options: StorageLockRequestOptions = {}
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    const mode: LockMode = options.mode || 'exclusive';
    const timeoutMs = options.timeoutMs ?? 5000;
    const leaseDurationMs = options.leaseDurationMs ?? 3000;
    const priority = parseLockPriority(options.priority);
    const steal = options.steal ?? false;
    const reentrant = options.reentrant ?? true;

    if (timeoutMs < 0 || leaseDurationMs <= 0) {
      return Result.err(new StorageMutexError('INVALID_OPTIONS', 'Invalid timeout or lease duration', name));
    }

    // Check re-entrancy in activeWebLocks
    const existingWebLock = Array.from(this.activeWebLocks.values()).find(
      (e) => e.name === name && e.lockInfo.holderId === this.clientId && e.lockInfo.state === 'ACQUIRED'
    );
    if (existingWebLock) {
      if (mode === 'exclusive' && existingWebLock.lockInfo.mode === 'exclusive') {
        if (!reentrant) {
          return Result.err(
            new StorageMutexError('REENTRANT_LOCK_FORBIDDEN', 'Re-entrant lock acquisition disabled', name, this.clientId)
          );
        }
        existingWebLock.lockInfo.reentrancyDepth += 1;
        existingWebLock.lockInfo.expiresAt = Date.now() + leaseDurationMs;
        await this.repository.saveLock(existingWebLock.lockInfo);
        return Result.ok({ ...existingWebLock.lockInfo });
      }
    }

    const lockId = `lock_wl_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    const fencingRes = await this.repository.incrementFencingToken(name);
    const fencingToken = fencingRes.ok ? fencingRes.value : 1;

    let resolveAcquire!: (res: Result<StorageLockInfo, StorageMutexError>) => void;
    const acquirePromise = new Promise<Result<StorageLockInfo, StorageMutexError>>((res) => {
      resolveAcquire = res;
    });

    let resolveRelease!: () => void;
    const releasePromise = new Promise<void>((res) => {
      resolveRelease = res;
    });

    let timeoutTimer: any = null;
    let abortController: AbortController | null = null;
    let signalToUse = options.signal;

    if (timeoutMs > 0 && timeoutMs < Infinity && !options.ifAvailable) {
      abortController = new AbortController();
      if (!signalToUse) {
        signalToUse = abortController.signal;
      }
      timeoutTimer = setTimeout(() => {
        if (abortController) abortController.abort();
      }, timeoutMs);
    }

    const webLocksOptions: any = {
      mode: mode === 'shared' ? 'shared' : 'exclusive',
      ifAvailable: options.ifAvailable,
      steal,
      signal: signalToUse,
    };

    (navigator as any).locks
      .request(name, webLocksOptions, async (webLock: any) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);

        if (!webLock && options.ifAvailable) {
          resolveAcquire(
            Result.err(
              new StorageMutexError('LOCK_CONTENTION', `Lock '${name}' is currently held (WebLocks non-blocking)`, name)
            )
          );
          return;
        }

        const now = Date.now();
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

        this.activeWebLocks.set(lockId, { lockId, name, releaseResolver: resolveRelease, lockInfo });
        await this.repository.saveLock(lockInfo);
        this.postMessage('LOCK_GRANTED', {
          lockId,
          lockName: name,
          name,
          key: name,
          requesterId: this.clientId,
          holderId: this.clientId,
          fencingToken,
          acquiredAt: now,
          expiresAt: now + leaseDurationMs,
          lockInfo,
        });

        resolveAcquire(Result.ok({ ...lockInfo }));

        await releasePromise;

        lockInfo.state = 'RELEASED';
        await this.repository.removeLock(lockId);
        this.postMessage('LOCK_RELEASED', { lockId, name, holderId: this.clientId });
      })
      .catch((err: any) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (err?.name === 'AbortError') {
          if (options.signal?.aborted) {
            resolveAcquire(Result.err(new StorageMutexError('ABORTED', 'Lock request aborted', name, this.clientId)));
          } else {
            resolveAcquire(
              Result.err(
                new StorageMutexError(
                  'ACQUISITION_TIMEOUT',
                  `Lock acquisition timed out after ${timeoutMs}ms`,
                  name,
                  this.clientId
                )
              )
            );
          }
        } else {
          resolveAcquire(
            Result.err(
              new StorageMutexError('ADAPTER_ERROR', err?.message || 'WebLocks request failed', name, this.clientId, err)
            )
          );
        }
      });

    return acquirePromise;
  }

  private async grantNewLock(
    name: string,
    mode: LockMode,
    leaseDurationMs: number,
    priority: number,
    requestId?: string,
    targetHolderId?: string
  ): Promise<Result<StorageLockInfo, StorageMutexError>> {
    const holderId = targetHolderId || this.clientId;

    // Verify if another lock for this name was saved concurrently before saving our lock
    const freshLocksRes = await this.repository.loadAllLocks();
    const freshActive = (freshLocksRes.ok ? freshLocksRes.value : []).filter(
      (l) => l.name === name && l.state === 'ACQUIRED'
    );

    if (freshActive.length > 0 && mode === 'exclusive') {
      const existingSelf = freshActive.find((l) => l.holderId === holderId);
      if (existingSelf) {
        return Result.ok({ ...existingSelf });
      }
      return Result.err(
        new StorageMutexError('LOCK_CONTENTION', `Lock '${name}' is held by another process`, name, holderId)
      );
    }

    const fencingRes = await this.repository.incrementFencingToken(name);
    const fencingToken = fencingRes.ok ? fencingRes.value : 1;

    const now = Date.now();
    const lockId = `lock_${Math.random().toString(36).substring(2, 9)}_${now}`;

    const lockInfo: StorageLockInfo = {
      lockId,
      name,
      holderId,
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

    // Leader Election Verification: verify if a concurrent process acquired a lock with a lower fencing token
    const verifyLocksRes = await this.repository.loadAllLocks();
    const activeExclusive = (verifyLocksRes.ok ? verifyLocksRes.value : []).filter(
      (l) => l.name === name && l.state === 'ACQUIRED' && l.mode === 'exclusive'
    );
    if (activeExclusive.length > 1 && mode === 'exclusive') {
      const minToken = Math.min(...activeExclusive.map((l) => l.fencingToken));
      if (fencingToken > minToken) {
        lockInfo.state = 'RELEASED';
        await this.repository.removeLock(lockId);
        return Result.err(new StorageMutexError('LOCK_CONTENTION', 'Concurrency contention in grantNewLock', name));
      }
    }

    this.postMessage('LOCK_GRANTED', {
      lockId,
      lockName: name,
      name,
      key: name,
      requesterId: holderId,
      holderId,
      fencingToken,
      acquiredAt: now,
      expiresAt: now + leaseDurationMs,
      requestId,
      lockInfo,
    });

    return Result.ok({ ...lockInfo });
  }

  private async removeWaiterInternal(requestId: string): Promise<void> {
    const internal = this.internalWaiters.get(requestId);
    if (internal) {
      if (internal.timerId) clearTimeout(internal.timerId);
      this.internalWaiters.delete(requestId);
    }
    await this.repository.removeWaiter(requestId);
  }

  private scheduleExpirationWatchdog(name: string, delayMs: number): void {
    if (this.activeWatchdogs.has(name)) {
      clearTimeout(this.activeWatchdogs.get(name));
    }
    const timer = setTimeout(() => {
      this.activeWatchdogs.delete(name);
      this.pulseHeartbeat();
    }, delayMs);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    this.activeWatchdogs.set(name, timer);
  }

  private static lastRequestTimestamp = 0;

  private getMonotonicTimestamp(): number {
    const now = Date.now();
    if (now > StorageMutexEngine.lastRequestTimestamp) {
      StorageMutexEngine.lastRequestTimestamp = now;
    } else {
      StorageMutexEngine.lastRequestTimestamp += 0.001;
    }
    return StorageMutexEngine.lastRequestTimestamp;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      this.hasPendingQueueWork = true;
      return;
    }

    this.isProcessingQueue = true;
    try {
      do {
        this.hasPendingQueueWork = false;
        await this.runQueueProcessing();
      } while (this.hasPendingQueueWork);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async runQueueProcessing(): Promise<void> {
    await Promise.resolve();
    await this.purgeExpiredLocks();

    // Dual-defense active lock scan: check if active lock in repository belongs to this.clientId
    const locksRes = await this.repository.loadAllLocks();
    const allLocks = locksRes.ok ? locksRes.value : [];

    const grantedLockNames = new Set<string>();
    for (const lock of allLocks) {
      if (lock.state === 'ACQUIRED' && lock.mode === 'exclusive') {
        grantedLockNames.add(lock.name);
      }
    }

    for (const lock of allLocks) {
      if (lock.holderId === this.clientId && lock.state === 'ACQUIRED') {
        const matchingWaiters = Array.from(this.internalWaiters.values())
          .filter((w) => w.waiterInfo.lockName === lock.name && !w.resolved)
          .sort((a, b) => b.waiterInfo.priority - a.waiterInfo.priority);

        if (matchingWaiters.length > 0) {
          const winner = matchingWaiters[0];
          winner.resolved = true;
          this.internalWaiters.delete(winner.waiterInfo.requestId);
          if (winner.timerId) clearTimeout(winner.timerId);
          await this.repository.removeWaiter(winner.waiterInfo.requestId);
          winner.resolve(Result.ok({ ...lock }));
        }
      }
    }

    const waitersRes = await this.repository.loadWaiters();
    const waiters = waitersRes.ok ? waitersRes.value : [];
    if (waiters.length === 0) return;

    // Sort waiters by priority (descending), requestedAt (ascending), and sequenceNumber (ascending)
    waiters.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      if (a.requestedAt !== b.requestedAt) {
        return a.requestedAt - b.requestedAt;
      }
      return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
    });

    // Build O(1) indexes for active locks to prevent O(N^2) array scanning under high contention
    const locksByNameMap = new Map<string, StorageLockInfo[]>();
    const activeHoldersSet = new Set<string>();
    for (const l of allLocks) {
      if (l.state === 'ACQUIRED') {
        activeHoldersSet.add(l.holderId);
        let list = locksByNameMap.get(l.name);
        if (!list) {
          list = [];
          locksByNameMap.set(l.name, list);
        }
        list.push(l);
      }
    }

    let grantsInThisPass = 0;
    for (const waiter of waiters) {
      if (grantsInThisPass >= 100) {
        this.hasPendingQueueWork = true;
        break;
      }

      const name = waiter.lockName;
      const mode: LockMode = waiter.mode || 'exclusive';

      if (grantedLockNames.has(name) && mode === 'exclusive') {
        continue;
      }

      const currentHolders = locksByNameMap.get(name) || [];
      const heldByOther = currentHolders.some((l) => l.holderId !== waiter.requesterId);
      if (heldByOther && mode === 'exclusive') {
        continue;
      }

      // Deadlock check for queued waiter (only if requester currently holds at least one active lock)
      const requesterHoldsLock = activeHoldersSet.has(waiter.requesterId);
      if (requesterHoldsLock && this.detectDeadlockWithData(waiter.requesterId, name, allLocks, waiters)) {
        this.deadlocksDetectedCount += 1;
        await this.repository.removeWaiter(waiter.requestId);
        this.postMessage('DEADLOCK_DETECTED', {
          requestId: waiter.requestId,
          lockName: name,
          name,
          requesterId: waiter.requesterId,
          holderId: waiter.requesterId,
          error: {
            kind: 'DEADLOCK_DETECTED',
            message: `Deadlock cycle detected for requester '${waiter.requesterId}' on lock '${name}'`,
          },
        });
        const internal = this.internalWaiters.get(waiter.requestId);
        if (internal) {
          if (internal.timerId) clearTimeout(internal.timerId);
          this.internalWaiters.delete(waiter.requestId);
          internal.resolve(
            Result.err(
              new StorageMutexError(
                'DEADLOCK_DETECTED',
                `Deadlock cycle detected for requester '${waiter.requesterId}' on lock '${name}'`,
                name,
                waiter.requesterId
              )
            )
          );
        }
        continue;
      }

      const activeList = locksByNameMap.get(name) || [];

      // Deduplicate: If an active lock already exists for waiter.requesterId, remove stale waiter!
      if (activeList.length > 0 && (mode === 'exclusive' || activeList.some((l) => l.mode === 'exclusive'))) {
        const existingSelf = activeList.find((l) => l.holderId === waiter.requesterId);
        if (existingSelf) {
          await this.repository.removeWaiter(waiter.requestId);
          if (waiter.requesterId === this.clientId) {
            existingSelf.reentrancyDepth += 1;
            await this.repository.saveLock(existingSelf);
            this.postMessage('LOCK_GRANTED', {
              lockId: existingSelf.lockId,
              lockName: name,
              name,
              key: name,
              requesterId: waiter.requesterId,
              holderId: waiter.requesterId,
              fencingToken: existingSelf.fencingToken,
              acquiredAt: existingSelf.acquiredAt,
              expiresAt: existingSelf.expiresAt,
              requestId: waiter.requestId,
              lockInfo: existingSelf,
            });
            const internal = this.internalWaiters.get(waiter.requestId);
            if (internal) {
              if (internal.timerId) clearTimeout(internal.timerId);
              this.internalWaiters.delete(waiter.requestId);
              internal.resolve(Result.ok({ ...existingSelf }));
            }
          }
        }
        continue;
      }

      let canGrant = false;

      if (activeList.length === 0) {
        canGrant = true;
      } else if (mode === 'shared' && activeList.every((l) => l.mode === 'shared')) {
        canGrant = true;
      }

      if (canGrant) {
        // Atomic claim: Remove waiter FIRST before saving lock; if false, another worker already claimed it!
        const removeRes = await this.repository.removeWaiter(waiter.requestId);
        if (!removeRes.ok || !removeRes.value) {
          if (mode === 'exclusive') {
            grantedLockNames.add(name);
          }
          continue;
        }

        const now = Date.now();
        const lockId = `lock_${Math.random().toString(36).substring(2, 9)}_${now}`;

        const fencingRes = await this.repository.incrementFencingToken(name);
        const fencingToken = fencingRes.ok ? fencingRes.value : 1;
        const leaseDurationMs = waiter.leaseDurationMs || 3000;

        const lockInfo: StorageLockInfo = {
          lockId,
          name,
          holderId: waiter.requesterId,
          mode,
          acquiredAt: now,
          expiresAt: now + leaseDurationMs,
          leaseDurationMs,
          reentrancyDepth: 1,
          priority: waiter.priority,
          state: 'ACQUIRED',
          fencingToken,
        };

        await this.repository.saveLock(lockInfo);
        allLocks.push(lockInfo);
        grantedLockNames.add(name);
        activeHoldersSet.add(waiter.requesterId);
        let nameList = locksByNameMap.get(name);
        if (!nameList) {
          nameList = [];
          locksByNameMap.set(name, nameList);
        }
        nameList.push(lockInfo);

        this.postMessage('LOCK_GRANTED', {
          lockId,
          lockName: name,
          name,
          key: name,
          requesterId: waiter.requesterId,
          holderId: waiter.requesterId,
          fencingToken,
          acquiredAt: now,
          expiresAt: now + leaseDurationMs,
          requestId: waiter.requestId,
          lockInfo,
        });

        const internal = this.internalWaiters.get(waiter.requestId);
        if (internal) {
          if (internal.timerId) clearTimeout(internal.timerId);
          this.internalWaiters.delete(waiter.requestId);
          internal.resolve(Result.ok({ ...lockInfo }));
        }

        if (mode === 'exclusive') {
          grantedLockNames.add(name);
        }
        grantsInThisPass += 1;
      } else if (activeList.length > 0) {
        const minExpiresAt = Math.min(...activeList.map((l) => l.expiresAt));
        if (minExpiresAt > 0) {
          const delay = Math.max(5, minExpiresAt - Date.now() + 5);
          this.scheduleExpirationWatchdog(name, delay);
        }
      }
    }

    if (grantsInThisPass >= 10) {
      queueMicrotask(() => {
        this.processQueue();
      });
    }
  }

  private detectDeadlockWithData(
    requesterId: string,
    requestedLockName: string,
    allLocks: StorageLockInfo[],
    allWaiters: LockWaiterInfo[]
  ): boolean {
    const holdsAnyLock = allLocks.some((l) => l.holderId === requesterId && l.state === 'ACQUIRED');
    if (!holdsAnyLock) {
      return false;
    }

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
          if (nextHolder === currHolderId) continue;
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
      if (holder === requesterId) continue;
      if (checkCycle(holder)) {
        return true;
      }
    }

    return false;
  }

  private async detectDeadlock(requesterId: string, requestedLockName: string): Promise<boolean> {
    const locksRes = await this.repository.loadAllLocks();
    if (!locksRes.ok) return false;
    const allLocks = locksRes.value;
    const holdsAnyLock = allLocks.some((l) => l.holderId === requesterId && l.state === 'ACQUIRED');
    if (!holdsAnyLock) return false;

    const waitersRes = await this.repository.loadWaiters();
    const allWaiters = waitersRes.ok ? waitersRes.value : [];

    return this.detectDeadlockWithData(requesterId, requestedLockName, allLocks, allWaiters);
  }

  public async releaseLock(lockId: string): Promise<Result<void, StorageMutexError>> {
    if (this.driverType === 'web-locks') {
      const webEntry =
        this.activeWebLocks.get(lockId) ||
        Array.from(this.activeWebLocks.values()).find(
          (e) => (e.lockId === lockId || e.name === lockId) && e.lockInfo.holderId === this.clientId
        );
      if (webEntry) {
        if (webEntry.lockInfo.reentrancyDepth > 1) {
          webEntry.lockInfo.reentrancyDepth -= 1;
          await this.repository.saveLock(webEntry.lockInfo);
          return Result.ok(undefined);
        }
        this.activeWebLocks.delete(webEntry.lockId);
        webEntry.releaseResolver();
        return Result.ok(undefined);
      }
    }

    await this.purgeExpiredLocks();

    const locksRes = await this.repository.loadAllLocks();
    const allLocks = locksRes.ok ? locksRes.value : [];

    let lock = allLocks.find((l) => l.lockId === lockId);
    if (!lock) {
      lock = allLocks.find((l) => l.name === lockId && l.holderId === this.clientId && l.state === 'ACQUIRED');
    }

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
    for (const timer of this.activeWatchdogs.values()) {
      clearTimeout(timer);
    }
    this.activeWatchdogs.clear();
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
