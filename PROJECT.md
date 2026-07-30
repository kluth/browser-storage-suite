# Project: Browser Storage Suite

## Architecture
- Framework: WXT 0.19.16 + Vite 6.4.3 + React 19 + TypeScript 5.7.3 + Vitest
- Architecture: Hexagonal Architecture (Ports & Adapters), Domain-Driven Design (Value Objects: StorageKey, StorageValue, StorageTarget).
- Error Handling: Pure Result<T, E> functional error handling (utils/result.ts) with zero unhandled throws/exceptions.
- Constraints: Cyclomatic complexity < 10 McCabe, micro-increments <= 150 LOC per step.
- Browser Compatibility: Chrome Manifest V3 (.output/chrome-mv3) and Firefox Manifest V2 (.output/firefox-mv2).
- Key Capabilities: Real Storage Inspection, Data Blame callstack tracking, Backend Discovery, OpenTelemetry tracing.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Real Callstack Data Blamer | Dynamic origin & callstack tracking using Error().stack & interceptor | M1 | audit/survey |
| 2 | Native Storage Interceptor Adapter | Real Storage.prototype proxying (__STORAGE_SUITE_INTERCEPT__) | M1 | audit/survey |
| 3 | Production 3D Spatial Layout Worker | Real 3D graph layout calculation off-main-thread via spatialLayoutWorker.ts | M2 | audit/survey |
| 4 | Accurate SQL-to-IDBCursor Translator | True IDB cursor translation with realistic cost model (no 0.42/12.8 hardcodes) | M3 | audit/survey |
| 5 | Live Web Request Backend Discoverer | Dynamic port/API discovery via network request sniffing & active tab probing | M4 | audit/survey |
| 6 | Dynamic Storage Presets & Predictor | Non-static storage preset generation & page prediction engine | M5 | audit/survey |
| 7 | Final E2E Test Suite & Adversarial Pass | 100% E2E test suite pass (Tiers 1-4) + Tier 5 adversarial coverage hardening | M6 | instructions |

## Code Layout
- `src/domain/model/valueObjects.ts`: StorageKey, StorageValue, StorageTarget
- `src/domain/ports/primary/storageUseCases.ts`: StorageUseCasesPort
- `src/domain/ports/secondary/storageRepositoryPort.ts`: StorageRepositoryPort
- `src/application/storageService.ts`: StorageApplicationService
- `src/infrastructure/adapters/storageInterceptorAdapter.ts`: StorageInterceptorAdapter
- `src/infrastructure/mcp/mcpServerAdapter.ts`: McpServerAdapter
- `src/infrastructure/telemetry/tracer.ts`: ExtensionTelemetry
- `utils/dataBlamer.ts`: Data Blame engine
- `utils/sqlToIdb.ts`: SQL query translator
- `utils/backendDiscoverer.ts`: Backend discovery engine
- `utils/presetManager.ts` & `utils/presetPredictor.ts`: Presets & Predictor engines
- `components/SpatialGraphCanvas.tsx` & `workers/spatialLayoutWorker.ts`: 3D Spatial Visualization
- `utils/result.ts`: Functional Result<T, E> type

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Storage Interceptor & Data Blamer Eradication | Implement native Storage.prototype proxying & dynamic Error().stack Data Blame tracking in `utils/dataBlamer.ts` and `src/infrastructure/adapters/storageInterceptorAdapter.ts` | none | DONE |
| M2 | Off-Main-Thread 3D Spatial Graph Engine | Connect `components/SpatialGraphCanvas.tsx` to `workers/spatialLayoutWorker.ts` with real IndexedDB/LocalStorage node layout calculations | M1 | IN_PROGRESS |
| M3 | Production SQL-to-IDBCursor Query Engine | Replace fixed costs (`0.42`/`12.8`) in `utils/sqlToIdb.ts` with genuine index-scan and table-scan performance heuristics and fullResult cursors | none | DONE |
| M4 | Dynamic Web Request & API Backend Discoverer | Upgrade `utils/backendDiscoverer.ts` from static ports to web request sniffing and active tab endpoint discovery | none | DONE |
| M5 | Dynamic Storage Presets & Page Predictor | Eradicate hardcoded preset tokens in `utils/presetManager.ts` and `utils/presetPredictor.ts` with dynamic domain value generators | M1 | IN_PROGRESS |
| M6 | Final E2E Test Suite & Adversarial Hardening | Pass 100% E2E test suite (Tiers 1-4) and complete Tier 5 white-box adversarial coverage hardening | M1, M2, M3, M4, M5 | PLANNED |

## Interface Contracts
### StorageInterceptor ↔ DataBlamer
- Interceptor extracts native callstack `Error().stack` at mutation point.
- `DataBlamer` parses stack trace into `DataBlameInfo` containing `actor`, `scriptUrl`, `line`, `col`, returning `Result<DataBlameInfo, Error>`.

### SpatialGraphCanvas ↔ SpatialLayoutWorker
- Canvas posts storage node structure `Node3DProps[]` to worker via `postMessage`.
- Worker computes force-directed 3D coordinates off-main-thread and posts back `Result<{ positions: [number, number, number][] }, Error>`.

### SqlToIdbTranslator ↔ IDBRepository
- Translator parses SQL query string into `ParsedSqlQuery` and computes dynamic cost heuristic based on database entry count and index availability.
