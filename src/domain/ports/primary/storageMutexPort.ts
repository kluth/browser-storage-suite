import { Result } from '../../../../utils/result';
import {
  StorageLockInfo,
  StorageLockRequestOptions,
  StorageMutexSnapshot,
  StorageMutexError,
} from '../../model/storageMutex';

export interface StorageMutexPort {
  /**
   * Execute callback within acquired lock scope, ensuring auto-release upon completion or error.
   */
  acquire<T>(
    name: string,
    callback: (lock: StorageLockInfo) => Promise<T> | T,
    options?: StorageLockRequestOptions
  ): Promise<Result<T, StorageMutexError>>;

  /**
   * Alias for acquire
   */
  withLock<T>(
    name: string,
    callback: (lock: StorageLockInfo) => Promise<T> | T,
    options?: StorageLockRequestOptions
  ): Promise<Result<T, StorageMutexError>>;

  /**
   * Explicitly acquire a lock handle.
   */
  acquireLock(
    name: string,
    options?: StorageLockRequestOptions
  ): Promise<Result<StorageLockInfo, StorageMutexError>>;

  /**
   * Release a previously acquired lock by lockId or handle.
   */
  releaseLock(lockId: string): Promise<Result<void, StorageMutexError>>;

  /**
   * Refresh lease TTL for an actively held lock handle.
   */
  refreshLock(lockId: string): Promise<Result<StorageLockInfo, StorageMutexError>>;

  /**
   * Forcibly steal lock on resource key, invalidating current holder.
   */
  stealLock(
    name: string,
    options?: StorageLockRequestOptions
  ): Promise<Result<StorageLockInfo, StorageMutexError>>;

  /**
   * Check if lock is currently held.
   */
  isLocked(name: string): Promise<Result<boolean, StorageMutexError>>;

  /**
   * Query metadata for active lock on key.
   */
  getLockInfo(name: string): Promise<Result<StorageLockInfo | null, StorageMutexError>>;

  /**
   * Obtain full diagnostics snapshot (locks, queue, deadlock counter, active adapter).
   */
  getSnapshot(): Promise<Result<StorageMutexSnapshot, StorageMutexError>>;

  /**
   * Force release all active locks (administrative recovery).
   */
  forceReleaseAll(): Promise<Result<number, StorageMutexError>>;
}
