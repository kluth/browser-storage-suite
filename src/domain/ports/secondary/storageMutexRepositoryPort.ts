import { Result } from '../../../../utils/result';
import {
  StorageLockInfo,
  LockWaiterInfo,
  StorageMutexError,
} from '../../model/storageMutex';

export interface StorageMutexRepositoryPort {
  saveLock(lock: StorageLockInfo): Promise<Result<void, StorageMutexError>>;
  removeLock(lockId: string): Promise<Result<void, StorageMutexError>>;
  loadLock(lockId: string): Promise<Result<StorageLockInfo | null, StorageMutexError>>;
  loadLockByName(name: string): Promise<Result<StorageLockInfo | null, StorageMutexError>>;
  loadAllLocks(): Promise<Result<StorageLockInfo[], StorageMutexError>>;
  saveWaiter(waiter: LockWaiterInfo): Promise<Result<void, StorageMutexError>>;
  removeWaiter(requestId: string): Promise<Result<boolean, StorageMutexError>>;
  loadWaiters(): Promise<Result<LockWaiterInfo[], StorageMutexError>>;
  getFencingToken(name: string): Promise<Result<number, StorageMutexError>>;
  incrementFencingToken(name: string): Promise<Result<number, StorageMutexError>>;
  clearAll(): Promise<Result<void, StorageMutexError>>;
  subscribe?(listener: (event: { type: string; payload: any }) => void): () => void;
  notify?(type: string, payload: any): void;
}
