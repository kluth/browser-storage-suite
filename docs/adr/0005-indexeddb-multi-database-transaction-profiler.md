# ADR-0005: IndexedDB Multi-Database Transaction Profiler

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Browser applications increasingly rely on multiple IndexedDB databases and object stores for offline-first data management. Profiling transaction latency, lock contention, and object store write throughput across multiple databases is difficult using standard DevTools.

## Decision
Implement a native IndexedDB Multi-Database Transaction Profiler into `Browser Storage Suite`. The profiler monkey-patches `IDBDatabase.prototype.transaction` in page context to track transaction durations, active read/write locks, object store access frequency, and commit/abort ratios.

## Consequences
### Positive
- Live timeline of active IndexedDB transactions.
- Detection of deadlocks and long-running write transactions blocking object stores.
- Accurate metrics on write throughput per object store.

### Negative / Tradeoffs
- Minor CPU overhead during rapid batch writes when tracking transaction timestamps.
- Requires page-world content script injection to intercept native `IDBDatabase` calls.

## Security & Performance Considerations
- Interception hooks use `WeakMap` references to avoid leaking DOM memory.
- No sensitive transaction payload data is transmitted off-device.
