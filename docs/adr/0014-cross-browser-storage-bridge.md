# 0014. Cross-Browser Storage Bridge

* **Status:** Accepted
* **Deciders:** Lead Architecture Engineer, Extension Security Architect
* **Date:** 2026-08-01

## Context and Problem Statement
Developing a multi-browser WebExtension (Chrome MV3, Firefox MV2/MV3, Edge MV3) exposes significant storage API and message passing fragmentation:
1. **API Namespace & Async Models:** Chrome uses `chrome.storage` (historically callback-based), while Firefox native extensions use `browser.storage` (Promise-based).
2. **Storage Area Support Differences:** Chrome MV3 supports `storage.local`, `storage.sync`, `storage.managed`, and `storage.session` in service worker contexts. Firefox MV2 supports `local`, `sync`, `managed`, but lacks `storage.session` API support.
3. **Context Message Passing:** Communication between background service workers, content scripts, and popups requires tab-specific messaging (`sendMessageToTab`) or runtime messaging (`sendMessage`). Standard callback implementations leak unhandled promise rejections or runtime error exceptions.
4. **Testing Environments:** Unit testing in Vitest/Node environments fails if code relies directly on unmocked browser/chrome globals.

The application requires a unified, zero-dependency, Hexagonal secondary port abstraction to transparently unify extension storage access, RPC message passing, and environment detection without runtime exceptions.

## Decision Drivers
* **Hexagonal Decoupling:** Decouple domain storage and RPC operations from browser-specific extension APIs via `ExtensionBridgePort`.
* **Cross-Browser Compatibility:** Support Chrome MV3, Firefox MV2/MV3, Edge MV3, and Safari WebExtensions via WXT framework abstractions (`WxtBridgeAdapter`).
* **Zero-Throw Result Contract:** All storage and messaging operations return functional `Result<T, ExtensionBridgeError>` objects.
* **Resilient Environment Fallback:** Gracefully fall back to internal in-memory storage maps when running in non-extension environments (e.g., Vitest test suites or web preview contexts) or when unsupported storage areas (`session`) are targeted.
* **Correlation-Tracked RPC Messaging:** Attach unique correlation IDs (`correlationId`) and timeout guards (5000ms) to all cross-context RPC messages.

## Considered Options
1. **Direct Chrome Extension API Calls:** Invoke `chrome.storage.local` directly in application logic. (Fails in Firefox/Vitest).
2. **Direct webextension-polyfill Global:** Rely solely on global `browser` object without Hexagonal port encapsulation. (Lacks zero-throw `Result` contract and in-memory test fallback).
3. **WXT Storage Module Only:** Use standard WXT `storage` without correlation-tracked RPC message routing or Hexagonal decoupling.
4. **Hexagonal Extension Bridge with WXT Adapter & In-Memory Fallback:** Implement `ExtensionBridgePort` secondary port, `WxtBridgeAdapter` infrastructure adapter, `CrossBrowserBridge` domain facade, zero-throw `Result<T, ExtensionBridgeError>` pattern, and automatic in-memory fallback.

## Decision Outcome
Chosen option: **Option 4 (Hexagonal Extension Bridge with WXT Adapter & In-Memory Fallback)**.

### Positives
* **Universal Compatibility:** Transparently handles Chrome MV3, Firefox MV2/MV3, Edge MV3, and test environments.
* **Zero-Throw Resilience:** Eliminates uncaught runtime errors during extension storage or messaging failures.
* **Seamless Vitest Testing:** In-memory fallback ensures unit tests run without complex browser mocks.
* **Clean Facade Access:** `CrossBrowserBridge` simplifies storage and RPC interaction for UI components and domain services.

### Tradeoffs
* Minor abstraction layer overhead over raw `chrome.storage` API calls.
* In-memory storage fallback data is non-persistent across page reloads in pure web/test contexts.

## Implementation Details

### File Inventory
* Secondary Port Interface: `src/domain/ports/secondary/extensionBridgePort.ts`
* Infrastructure Adapter: `src/infrastructure/adapters/wxtBridgeAdapter.ts`
* Domain Facade Utility: `utils/crossBrowserBridge.ts`
* Test Suite: `tests/crossBrowserBridge.test.ts`
