# 0020. Browser Storage Mocking and Contract Testing Harness

* **Status:** Accepted
* **Deciders:** Lead Architecture Engineer, Test Infrastructure Specialist
* **Date:** 2026-08-01

## Context and Problem Statement

Testing browser extension and web application storage layers in headless automated environments (Vitest/Node.js) faces several architectural challenges:

1. **API Namespace & Area Fragmentation:** Browser extensions utilize `chrome.storage.local`, `chrome.storage.sync`, `chrome.storage.session`, and `chrome.storage.managed`, while web applications rely on `window.localStorage`, `window.sessionStorage`, or `indexedDB`. Standard test mocks are often fragmented, inconsistent, and duplicated across test suites.
2. **Contract Violations:** Browser APIs enforce strict runtime constraints (e.g. `chrome.storage.sync` byte/item quotas, read-only guarantees on enterprise `managed` policy storage, JSON serialization/deserialization semantics). Naive JS object mocks ignore quota limits and mutate shared object references in memory.
3. **Fault & Anomaly Injection:** Testing error recovery (quota exceeded, read/write I/O errors, network latency, corrupt data) requires deterministic fault injection mechanisms.
4. **Contract Verification:** System adapters (`WxtBridgeAdapter`, `StorageRepositoryAdapter`) require automated contract testing to verify compliance against browser storage contracts without needing full browser automation for every unit test run.

The application requires an inbound/outbound Hexagonal secondary port (`MockStoragePort`), a concrete test harness utility (`StorageTestHarness`), a Vitest environment helper (`mockStorageEnvironment`), zero-throw `Result<T, StorageHarnessError>` handling, and an automated contract test runner.

## Decision Drivers

* **Hexagonal Decoupling:** Standardize mock storage interactions behind the secondary port `MockStoragePort`.
* **Multi-Area Emulation:** Support 7 storage areas (`local`, `sync`, `session`, `managed`, `localStorage`, `sessionStorage`, `indexedDB`).
* **Strict Quota & Read-Only Policy:** Enforce byte quotas (e.g., 8192 bytes per item for `sync`), max item counts, total area byte limits, and read-only protection for `managed`.
* **Zero-Throw Result Contract:** All storage I/O operations return `Result<T, StorageHarnessError>` objects.
* **Deterministic Fault & Latency Injection:** Support transient read/write fault matching, forced quota errors, and async latency simulation.
* **Automated Contract Suite:** Provide `runContractTests()` to validate adapter implementations against browser storage specifications.

## Considered Options

1. **Ad-hoc `vi.fn()` Spy Mocks in Individual Specs:** High code duplication, no quota enforcement, no read-only policy checks, fragile object mutation.
2. **Third-Party Browser Storage Polyfill Libraries:** External dependency violating zero-dependency domain principles, lacking custom fault injection and contract runner capabilities.
3. **Hexagonal Mock Storage Port, Concrete Test Harness Facade, and Automated Contract Testing Engine:** Pure TypeScript implementation of `MockStoragePort`, `StorageTestHarness`, `mockStorageEnvironment`, and `runContractTests` with Result pattern and fault injection.

## Decision Outcome

Chosen option: **Option 3 (Hexagonal Mock Storage Port, Concrete Test Harness Facade, and Automated Contract Testing Engine)**.

### Positives
* **Zero External Dependencies:** Built entirely with native TypeScript and project primitives (`utils/result.ts`).
* **Contract Compliance:** Guarantees consistent storage behavior across 7 browser storage areas.
* **Resilient Vitest Testing:** Global helper (`mockStorageEnvironment`) provides clean setup and teardown for unit & integration specs.
* **Automated Verification:** Standard contract runner `runContractTests()` ensures all adapters adhere to identical contract semantics.

### Tradeoffs
* Minor maintenance overhead for keeping storage quota definitions aligned with browser vendor updates.

## Security and Performance Considerations

* **Deep-Clone Immuntability:** Storage values are stored as JSON strings internally. Retrieving items parses new object references, preventing shared in-memory object mutation leaks during tests.
* **Fault Isolation:** Event listeners (`onChanged`) execute within error-boundary wrappers, preventing listener failures from breaking storage operations.
* **Zero Overhead:** Emulated storage is in-memory and lightweight, running Vitest test suites in sub-millisecond execution times per test case.

## Architecture & Component Design

* **Secondary Port:** `src/domain/ports/secondary/mockStoragePort.ts`
* **Test Harness Utility:** `utils/storageTestHarness.ts`
* **Vitest Environment Helper:** `tests/helpers/mockStorageEnvironment.ts`
* **Test Suite:** `tests/storageTestHarness.test.ts`
