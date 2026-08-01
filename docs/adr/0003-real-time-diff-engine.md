# 0003. Real-Time Diff Engine

* **Status:** Accepted
* **Deciders:** Lead Architect, Core Storage Team
* **Date:** 2026-08-01

## Context and Problem Statement
Browser storage mutations (LocalStorage, SessionStorage, Cookies, IndexedDB) occur continuously across browser tabs, background workers, and UI controls. Debugging storage mutations, detecting unintended state regressions, and supporting granular rollback/time-travel reversion require a lightweight, zero-dependency real-time diff engine compliant with W3C standard RFC 6902 (JSON Patch) and RFC 6901 (JSON Pointer).

## Decision Drivers
* **RFC 6902 Standard Compliance:** Standardize state deltas using RFC 6902 JSON Patch operations (`add`, `remove`, `replace`, `move`, `copy`, `test`).
* **Bidirectional Time-Travel & Rollback:** Automatically compute forward and inverse patch sets to enable instant single-click state restoration.
* **Zero External Dependencies:** Built without bloated third-party libraries (e.g. `fast-json-patch`), keeping extension payload compact.
* **Hexagonal Decoupling & Immutability:** Enforce immutable state transitions returning `Result<T, StorageDiffError>` without throwing unhandled runtime exceptions.
* **Interactive UI Visualizer:** Provide a multi-view React component (`DiffViewerModal.tsx`) for side-by-side visual diffing, raw JSON inspection, and selective patch execution.

## Considered Options
1. **Myers String Diffing:** Comparing serialized JSON strings. Fails to understand object/array semantic structures or support target patch application.
2. **Third-Party Libraries (`fast-json-patch` / `jsondiffpatch`):** Adds unnecessary external dependency overhead and security audit surface area.
3. **Native Custom RFC 6902 & RFC 6901 Engine with Bidirectional Inversion:** Fully controlled, zero-dependency implementation natively integrated into the storage application service.

## Decision Outcome
Chosen option: **Option 3 (Native Custom RFC 6902 Engine)**.

### Positives
* **Standards Compliance:** Full adherence to RFC 6901 JSON Pointer escaping (`~0` and `~1`) and RFC 6902 operations.
* **100% Immutability:** `applyPatch` creates zero-mutation state clones via `structuredClone`.
* **Zero Bundle Overhead:** Fully self-contained inside `utils/realtimeDiffEngine.ts`.
* **Rich UI Visualizer:** Seamless modal interface with visual diffs, patch filtering, search, and rollback triggers.

### Negatives / Tradeoffs
* Deep nested object diffing has linear time complexity O(N) with respect to key count.

## Implementation Details

### File Structure
* Domain Value Objects: `src/domain/model/storageDiff.ts`
* Engine Utility: `utils/realtimeDiffEngine.ts`
* React Visualizer Component: `components/DiffViewerModal.tsx`
* Test Suite: `tests/realtimeDiffEngine.test.ts`
* ADR Document: `docs/adr/0003-real-time-diff-engine.md`

### Verification Standards
* Vitest coverage: 100% test pass rate (`npx vitest run tests/realtimeDiffEngine.test.ts`).
* TypeScript compilation: `npx tsc --noEmit` returns 0 errors.
