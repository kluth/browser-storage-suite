export type LockMode = 'exclusive' | 'shared';

export type LockState = 'FREE' | 'ACQUIRED' | 'WAITING' | 'RELEASED' | 'EXPIRED' | 'STOLEN';

export type LockPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface StorageLockRequestOptions {
  mode?: LockMode;
  timeoutMs?: number;
  leaseDurationMs?: number;
  priority?: LockPriority | number;
  ifAvailable?: boolean;
  steal?: boolean;
  reentrant?: boolean;
  signal?: AbortSignal;
  driverType?: 'auto' | 'web-locks' | 'broadcast-channel' | 'in-memory';
}

export interface StorageLockInfo {
  lockId: string;
  name: string;
  holderId: string;
  mode: LockMode;
  acquiredAt: number;
  expiresAt: number;
  leaseDurationMs: number;
  reentrancyDepth: number;
  priority: number;
  state: LockState;
  fencingToken: number;
}

export interface LockWaiterInfo {
  requestId: string;
  lockName: string;
  requesterId: string;
  mode: LockMode;
  priority: number;
  requestedAt: number;
  timeoutMs: number;
  leaseDurationMs: number;
  sequenceNumber?: number;
}

export interface StorageMutexSnapshot {
  activeLocks: StorageLockInfo[];
  waitingQueue: LockWaiterInfo[];
  deadlocksDetected: number;
  adapterType: 'web-locks' | 'broadcast-channel' | 'in-memory';
}

export type StorageMutexErrorKind =
  | 'ACQUISITION_TIMEOUT'
  | 'LOCK_TIMEOUT'
  | 'DEADLOCK_DETECTED'
  | 'LOCK_NOT_HELD'
  | 'LOCK_EXPIRED'
  | 'INVALID_LOCK_NAME'
  | 'REENTRANT_LOCK_FORBIDDEN'
  | 'ABORTED'
  | 'INVALID_OPTIONS'
  | 'LOCK_CONTENTION'
  | 'ADAPTER_ERROR';

export class StorageMutexError extends Error {
  constructor(
    public readonly kind: StorageMutexErrorKind,
    message: string,
    public readonly lockName?: string,
    public readonly holderId?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageMutexError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function parseLockPriority(priority: LockPriority | number | undefined): number {
  if (priority === undefined) return 1; // Default NORMAL
  if (typeof priority === 'number') {
    if (isNaN(priority) || priority < 0) return 0;
    return Math.floor(priority);
  }
  switch (priority.toUpperCase()) {
    case 'LOW':
      return 0;
    case 'NORMAL':
      return 1;
    case 'HIGH':
      return 2;
    case 'CRITICAL':
      return 3;
    default:
      return 1;
  }
}
