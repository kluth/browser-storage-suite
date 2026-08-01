# 0015. Storage Event Bus and Reactive Observer

* **Status:** Accepted
* **Deciders:** Lead Architecture Engineer, Reactive Systems Specialist
* **Date:** 2026-08-01

## Context and Problem Statement
Browser storage suite modules and React UI components require real-time updates when storage keys, sessions, cookies, or IndexedDB records undergo mutation. Directly coupling components to browser APIs (`chrome.storage.onChanged` or window `storage` events) introduces severe architectural liabilities:
1. **API Namespace & Platform Fragmentation:** Extension contexts use `chrome.storage.onChanged` (with differing area names like `local`, `sync`, `session`), while standard web apps use `window.addEventListener('storage', ...)` or custom events.
2. **Lack of Granular Wildcard Filtering:** Components often only care about specific key prefixes (e.g. `user_*` or `cart:*`) or specific targets (`indexedDB` vs `cookie`). Filtering manually inside every component creates code duplication and performance bottlenecks.
3. **Execution Bursting & React Re-render Thrashing:** High-frequency storage writes cause rapid listener execution. Without debouncing options at the pub/sub layer, UI components experience re-render thrashing.
4. **Exception Escalation:** Uncaught errors inside a single UI listener can break the entire notification pipeline.

The system requires an inbound Hexagonal primary port (`StorageEventPort`), an event bus application service (`StorageEventBus`), and a domain utility facade (`ReactiveStorageObserver`) with zero-throw monadic error handling and debouncing support.

## Decision Drivers
* **Hexagonal Architecture:** Decouple domain storage observers from browser runtime extension APIs.
* **Granular Wildcard Matching:** Support exact topic matching (`localStorage:user_id`), prefix globs (`localStorage:user_*`), and global wildcards (`*`).
* **Debouncing & Filtering Controls:** Allow subscribers to configure `debounceMs`, custom predicate filters, and `once` auto-unsubscriptions.
* **Zero-Throw Fault Isolation:** Wrap listener execution to ensure errors in one callback never prevent delivery to other listeners or throw unhandled exceptions.
* **Extension Bridge Autowiring:** Seamlessly translate extension `onStorageChanged` events from `CrossBrowserBridge` into domain `StorageEvent` publish actions.

## Considered Options
1. **Direct `chrome.storage.onChanged` Bindings in React Components:** High coupling, no non-extension/Vitest support, no debouncing.
2. **RxJS Event Stream:** Heavy third-party dependency violating zero-dependency domain constraints.
3. **Custom Hexagonal Storage Event Bus & Reactive Observer Facade:** Pure TypeScript implementation of `StorageEventPort`, `StorageEventBus`, and `ReactiveStorageObserver` with Result pattern, glob matching, and debouncing.

## Decision Outcome
Chosen option: **Option 3 (Custom Hexagonal Storage Event Bus & Reactive Observer Facade)**.

### Positives
* Zero external dependencies.
* Isolated listener error handling ensures high stability.
* Ergonomic reactive observer API (`observeKey`, `observePrefix`, `observeTarget`, `observeAll`).
* Complete Vitest unit testability without browser mocks.

### Tradeoffs
* Small memory overhead for internal subscription maps and timer handles.

## Architecture & Component Design
* **Primary Port:** `src/domain/ports/primary/storageEventPort.ts`
* **Application Service:** `src/application/storageEventBus.ts`
* **Utility Facade:** `utils/reactiveStorageObserver.ts`
* **Test Suite:** `tests/storageEventBus.test.ts`
