# 0011. Time-Series Storage Snapshot & Time Travel Debugger

* **Status:** Accepted
* **Deciders:** Lead Architect, Core Storage Team
* **Date:** 2026-08-02

## Context and Problem Statement
Browser storage state mutations across `localStorage`, `sessionStorage`, `IndexedDB`, `cookies`, `cacheAPI`, and `OPFS` can introduce race conditions, state corruptions, and hard-to-reproduce regressions during complex application workflows or database schema migrations. Standard browser developer tools only expose current active state, lacking historical provenance, temporal diffing, and bidirectional time-travel debugging capabilities.

To diagnose state bugs, perform zero-downtime state rollbacks, and isolate branch mutations, the Browser Storage Suite requires a comprehensive time-series storage snapshot engine and time travel debugger. The engine must support continuous low-overhead RFC 6902 delta recording, point-in-time timestamp seeking, timeline DAG branching, interactive step-by-step replay sessions, auto-pruning policies, and zero-throw monadic error handling (`Result<T, E>`).

## Decision Drivers
* **Hexagonal Decoupling & DDD:** Enforce clear separation between core domain models (`StorageSnapshot`, `StateDelta`, `TimelineBranch`, `TimeTravelDiff`), primary use-case ports, secondary persistence repository ports, and infrastructure adapters.
* **Monadic Zero-Throw Error Handling:** Standardize all time-series storage operations using `Result<T, TimeSeriesSnapshotError>` from `utils/result.ts` without throwing unhandled exceptions.
* **RFC 6902 Delta Compression & Checksum Integrity:** Record lightweight state changes using forward/reverse RFC 6902 JSON Patches, optionally LZ-compressed, and verified via SHA-256 state checksums.
* **Timeline DAG Branching & Merging:** Support isolated timeline branching (forking from historical points) and merging using Last-Write-Wins (LWW) conflict resolution.
* **Strict Performance & Memory SLAs:** Sub-5ms seek latency across 5,000 deltas, processing 1,000 rapid mutations in under 100ms, and enforcing ring-buffer auto-pruning to keep timeline memory under 500 KB.
* **Zero Third-Party Dependencies:** Build entirely on native TypeScript, RFC 6902 engine (`utils/realtimeDiffEngine.ts`), and browser storage primitives.

## Considered Options
1. **Full-State In-Memory Snapshots on Every Mutation:** Simple to implement, but causes exponential memory growth (MB/GB) and storage quota exhaustion in high-mutation scenarios.
2. **Third-Party Time Travel Libraries (Redux DevTools / Immer Patches):** Introduces external runtime dependencies, fails to handle multi-engine browser storage backends (`IndexedDB`, `OPFS`), and violates project dependency isolation constraints.
3. **Hexagonal Time-Series Engine with Checkpoint Baselines & Lightweight Patch Deltas:** Native custom implementation utilizing periodic full-state checkpoints coupled with incremental RFC 6902 patch streams, DAG branch topologies, and ring-buffer retention pruning.

## Decision Outcome
Chosen option: **Option 3 (Hexagonal Time-Series Engine with Checkpoint Baselines & Lightweight Patch Deltas)**.

### Positives
* **Storage Efficiency:** Baseline checkpoints combined with compressed JSON patch deltas reduce timeline storage size by up to 90%.
* **Deterministic Time Travel:** Exact state reconstruction at any arbitrary timestamp by applying forward/reverse patch chains from closest checkpoint baselines.
* **Branch Isolation:** Isolated branch timelines permit sandbox debugging and trial state mutations without corrupting main timeline execution.
* **High Performance:** Ring-buffer auto-pruning maintains memory boundary under 500 KB with sub-5ms seek latency.

### Negatives / Tradeoffs
* Seeking across long delta chains requires sequential patch application. Mitigated by periodic auto-checkpoint baselines (every $N$ deltas).

## Implementation Details

### Component Architecture
* **Domain Model (`src/domain/model/timeSeriesSnapshot.ts`):** Defines `StorageSnapshot`, `SnapshotHeader`, `StateDelta`, `TimelineBranch`, `TimeTravelDiff`, `AutoPrunePolicy`, `PruneResult`, and `TimeSeriesSnapshotError`.
* **Primary Port (`src/domain/ports/primary/timeSeriesSnapshotPort.ts`):** Defines use cases (`takeSnapshot`, `recordChangeDelta`, `seekToPointInTime`, `forkTimeline`, `switchBranch`, `listBranches`, `replayTimeline`, `compareSnapshots`, `pruneTimeline`).
* **Secondary Port (`src/domain/ports/secondary/timeSeriesSnapshotRepositoryPort.ts`):** Defines persistence contract for snapshot, delta, and branch entities.
* **Infrastructure Adapter (`src/infrastructure/adapters/timeSeriesSnapshotAdapter.ts`):** Implements repository port with IndexedDB persistence and fallback to in-memory maps / storage APIs.
* **Core Utility Engine (`utils/timeSeriesSnapshotEngine.ts`):** Implements primary port and orchestrates delta diffing, patch replay, timeline branching, auto-pruning, and integrity checksum verification.

### Verification & Quality Standards
* TypeScript compilation: `npx tsc --noEmit` returns 0 errors.
* Unit tests: 100% pass rate in `tests/timeSeriesSnapshotEngine.test.ts` (16 scenarios).
* Adapter tests: 100% pass rate in `tests/timeSeriesSnapshotAdapter.test.ts` (16 mock scenarios).
* Integration tests: 100% pass rate in `tests/feature_11_time_series_snapshot.test.ts` (12 scenarios).
* Stress & Performance tests: 100% pass rate in `tests/timeSeriesSnapshotEngine.stress.test.ts` (12 scenarios).
* Cross-browser builds: Clean output across Chrome MV3, Firefox MV2, Edge MV3.
* Stryker mutation test: Score $\ge 75\%$ on target engine and adapter modules.
