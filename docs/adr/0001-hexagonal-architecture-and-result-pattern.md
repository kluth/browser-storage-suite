# 1. Hexagonal Architecture and Result-Pattern Error Handling

* **Status:** Accepted
* **Deciders:** Lead Architect
* **Date:** 2026-07-28

## Context and Problem Statement
The extension must support multiple target environments (Chrome MV3, Firefox Gecko MV3/MV2, Microsoft Edge) and diverse storage mechanisms (LocalStorage, SessionStorage, Cookies, IndexedDB, CacheAPI, OPFS). Coupling business logic directly to `chrome.*` or `window.*` APIs leads to untestable code and high maintenance friction.

## Decision Drivers
* Strict decoupling of core domain logic from browser APIs.
* Testability using pure unit tests without DOM/Extension mocks.
* Explicit error handling across layer boundaries without thrown exceptions.

## Considered Options
1. Direct API integration in React components (Tightly coupled).
2. Layered Architecture with global state singletons.
3. Hexagonal Architecture (Ports and Adapters) with Result Pattern.

## Decision Outcome
Chosen option: **Option 3 (Hexagonal Architecture with Result Pattern)**.

### Positives
* **Domain Purity:** Domain model (`src/domain`) has zero dependencies on external libraries or browser globals.
* **Contract-First:** Inbound (Primary) and Outbound (Secondary) ports strictly define system behavior.
* **Functional Error Handling:** Errors are returned as `Result<T, E>` types, ensuring zero uncaught exceptions cross layer boundaries.
