# 0008. Multi-Tab Storage Mutex & Lock Manager

* **Status:** Accepted
* **Deciders:** Lead Security Architect, Infrastructure Team, Storage Suite Team
* **Date:** 2026-08-01

## Context and Problem Statement
In modern client-side web applications, browser extension components (background service workers, popups, options pages, offscreen documents, and content scripts across multiple active browser tabs) frequently access and mutate shared client-side storage layers (`localStorage`, `sessionStorage`, `IndexedDB`, and `chrome.storage.local`). Standard browser storage APIs do not provide native cross-tab mutex primitives or distributed lock management. Concurrent reads, writes, and transaction blocks executed simultaneously across multiple tabs result in critical race conditions, dirty reads, split-brain state mutations, and lost updates.

Key concurrency and architectural challenges include:
1. **Cross-Tab Race Conditions**: Simultaneous read-modify-write operations across independent browser tab execution threads lead to state corruption and lost writes.
2. **Tab Crash & Orphaning Risks**: If a tab holding a lock crashes, refreshes, or is killed by browser resource management, locks must auto-expire safely without causing permanent system deadlocks.
3. **Environment Heterogeneity**: While modern browsers support the native Web Locks API (`navigator.locks`), non-browser, worker, JSDOM, or legacy execution contexts require a robust fallback driver operating over inter-tab IPC (`BroadcastChannel`) and shared storage persistence.
4. **Re-entrancy & Priority Scheduling**: Complex workflows within a single thread require re-entrant lock requests, while resource contention requires priority queue ordering (Critical, High, Normal, Low) rather than arbitrary lock starvation.
5. **Deadlock Detection**: Circular lock dependency chains (e.g. Tab A holding Lock 1 requesting Lock 2, while Tab B holds Lock 2 requesting Lock 1) must be detected dynamically and broken cleanly with zero process crashes.
6. **Out-of-Order Execution & Fencing Tokens**: Distributed systems must guard against delayed execution by issuing monotonically increasing fencing tokens with every lock acquisition.

The system requires a Multi-Tab Storage Mutex & Lock Manager built with Hexagonal Architecture, zero-throw `Result<T, StorageMutexError>` monads, a dual-driver engine (Web Locks API + BroadcastChannel Heartbeat Fallback), lease TTL watchdog auto-expiration, priority queues, re-entrancy support, Tarjan DFS cycle deadlock detection, lock preemption, and fencing tokens.

## Decision Drivers
* **Dual-Driver Architecture**: Primary native Web Locks API (`navigator.locks`) driver for process-level locking efficiency, paired with a secondary `BroadcastChannel` heartbeat and shared storage table fallback driver for environments where Web Locks is unavailable.
* **Lease TTL Watchdog & Crash Recovery**: Holder heartbeats extend lease expiry (`expiresAt`). If heartbeats cease due to tab crashes or service worker termination, waiting tabs auto-expire and reclaim dead locks after TTL ($3000\text{ms}$).
* **Fencing Tokens**: Every granted lock receives a monotonically increasing integer fencing token (`fencingToken`), enabling storage operations to reject out-of-order stale requests.
* **Re-entrancy Support**: Safe nested acquisition of exclusive locks by the same client/tab thread with depth tracking (`reentrancyDepth`).
* **Priority Queue Scheduling**: Pending waiters sorted by priority level (`CRITICAL=3 > HIGH=2 > NORMAL=1 > LOW=0`) and timestamp to prevent lock starvation.
* **Cycle Deadlock Detection**: Graph cycle evaluation (Tarjan DFS) rejecting circular dependencies with explicit `DEADLOCK_DETECTED` errors.
* **Lock Stealing & Preemption**: Administrative lock preemption (`steal: true`) for emergency recovery operations.
* **Hexagonal Decoupling & Monad Standard**: Domain entities, primary ports, secondary repository ports, infrastructure adapters, and utility engines utilizing `Result<T, StorageMutexError>` monads for zero uncaught runtime exceptions.
* **Multi-Browser Quality Gates**: TypeScript zero errors (`npx tsc --noEmit`), Vitest 100% pass (`npx vitest run`), extension production builds clean for Chrome MV3, Firefox MV2, and Edge MV3, and Stryker mutation score $\ge 75\%$.

## Considered Options
1. **Naive Spin-Locking over localStorage**: Poll shared storage keys continuously using `setInterval`. High CPU usage, poor performance, vulnerable to race conditions during atomic lock acquisition, and lacks priority queues or deadlock detection.
2. **Native Web Locks API Only**: Rely exclusively on `navigator.locks`. Highly performant in modern browser main threads, but completely fails in test runners (Vitest/JSDOM), web workers without locks API, or environments lacking full native support.
3. **Hybrid Dual-Driver Engine (Web Locks API + BroadcastChannel Heartbeat Fallback)**: Intelligent dual-driver engine detecting `navigator.locks` availability dynamically. Uses Web Locks API where supported, and seamlessly falls back to inter-tab `BroadcastChannel` messaging, shared lock table persistence, heartbeat lease watchdogs, priority queue scheduling, re-entrancy depth tracking, Tarjan cycle deadlock detection, and fencing tokens.

## Decision Outcome
Chosen option: **Option 3 (Hybrid Dual-Driver Engine)**.

### Positives
* **Universal Operating Environment Coverage**: Natively fast process-level locking in supported browser tabs, paired with robust fallback in JSDOM, web workers, or isolated extension contexts.
* **Deterministic Crash Recovery**: Lease heartbeats every $500\text{ms}$ with auto-expiration watchdog ensures tab crashes never leave orphaned permanent locks.
* **Zero Exception Overhead**: Monadic `Result<T, StorageMutexError>` pattern prevents unhandled promise rejections and process crashes.
* **Fencing Token Security**: Monotonic fencing tokens prevent stale, delayed lock holders from writing out-of-order state.
* **Deadlock Immunisation**: Dependency graph cycle checks prevent circular lock deadlocks.

### Negatives / Tradeoffs
* **Fallback Storage Latency**: BroadcastChannel fallback incurs minor IPC latency and shared storage serialization overhead; mitigated by fast-path in-memory lock table checking.
* **Service Worker Lifecycle Limits**: MV3 Service Worker idle termination requires short lease TTLs ($2000\text{ms}$–$5000\text{ms}$) and active heartbeat updates.

## Implementation Details

### Domain Data Structures (`src/domain/model/storageMutex.ts`)
- **`LockMode`**: `'exclusive' | 'shared'`
- **`LockState`**: `'FREE' | 'ACQUIRED' | 'WAITING' | 'RELEASED' | 'EXPIRED' | 'STOLEN'`
- **`LockPriority`**: `'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'`
- **`StorageLockRequestOptions`**: `{ mode?: LockMode; timeoutMs?: number; leaseDurationMs?: number; priority?: LockPriority | number; ifAvailable?: boolean; steal?: boolean; reentrant?: boolean; signal?: AbortSignal }`
- **`StorageLockInfo`**: `{ lockId: string; name: string; holderId: string; mode: LockMode; acquiredAt: number; expiresAt: number; leaseDurationMs: number; reentrancyDepth: number; priority: number; state: LockState; fencingToken: number }`
- **`LockWaiterInfo`**: `{ requestId: string; lockName: string; requesterId: string; mode: LockMode; priority: number; requestedAt: number; timeoutMs: number }`
- **`StorageMutexSnapshot`**: `{ activeLocks: StorageLockInfo[]; waitingQueue: LockWaiterInfo[]; deadlocksDetected: number; adapterType: 'web-locks' | 'broadcast-channel' | 'in-memory' }`
- **`StorageMutexErrorKind`**: `'ACQUISITION_TIMEOUT' | 'DEADLOCK_DETECTED' | 'LOCK_NOT_HELD' | 'LOCK_EXPIRED' | 'INVALID_LOCK_NAME' | 'REENTRANT_LOCK_FORBIDDEN' | 'ABORTED' | 'INVALID_OPTIONS' | 'ADAPTER_ERROR'`
- **`StorageMutexError`**: Monadic domain error class extending `Error` with `kind`, `message`, `lockName`, `holderId`, and `cause`.

### Architecture & Port Definitions
- **Primary Port (`src/domain/ports/primary/storageMutexPort.ts`)**: Inbound interface defining `acquire`, `acquireLock`, `releaseLock`, `isLocked`, `getLockInfo`, `getSnapshot`, and `forceReleaseAll`.
- **Secondary Repository Port (`src/domain/ports/secondary/storageMutexRepositoryPort.ts`)**: Persistence interface defining `saveLock`, `removeLock`, `loadLock`, `loadLockByName`, `loadAllLocks`, `saveWaiter`, `removeWaiter`, `loadWaiters`, and `clearAll`.
- **Infrastructure Adapter (`src/infrastructure/adapters/storageMutexAdapter.ts`)**: Storage adapter supporting persistence and synchronization across shared storage backends.
- **Utility Engine (`utils/storageMutexEngine.ts`)**: Dual-driver lock engine implementing `StorageMutexPort` with dynamic driver selection (`WebLocksDriver` / `BroadcastChannelLeaseDriver`), priority queues, re-entrancy tracking, Tarjan DFS cycle deadlock detection, fencing tokens, and zero-throw `Result` monads.

### File Inventory
- **ADR Document**: `docs/adr/0008-storage-mutex-and-lock-manager.md`
- **Domain Models**: `src/domain/model/storageMutex.ts`
- **Primary Port**: `src/domain/ports/primary/storageMutexPort.ts`
- **Secondary Port**: `src/domain/ports/secondary/storageMutexRepositoryPort.ts`
- **Infrastructure Adapter**: `src/infrastructure/adapters/storageMutexAdapter.ts`
- **Utility Engine**: `utils/storageMutexEngine.ts`
- **Tests**:
  - `tests/storageMutex.test.ts`
  - `tests/storageMutexEngine.test.ts`
  - `tests/feature_08_storage_mutex.test.ts`
  - `tests/storageMutexEngine.stress.test.ts`
