# E2E Test Infra: Browser Storage Suite

## Test Philosophy
- Opaque-box, requirement-driven E2E test suite. No dependency on implementation internals.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory Matrix (Features 0001 - 0025)
*Note: Dual Track requirement-driven test infra. Modules are implemented incrementally across Milestones M1-M4.*

| # | Feature | Target Module (Planned in M1-M4) | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|----------------------------------|---------------------|:------:|:------:|:------:|:------:|
| 1 | 0001: Storage Encryption at Rest | `utils/cryptoManager.ts`, `src/infrastructure/adapters/cryptoAdapter.ts` | ADR-0001 (M1) | 5 | 5 | ✓ | ✓ |
| 2 | 0002: Cross-Domain Sync Protocol | `src/domain/model/crdt.ts`, `src/infrastructure/adapters/syncAdapter.ts` | ADR-0002 (M2) | 5 | 5 | ✓ | ✓ |
| 3 | 0003: Real-Time Diff Engine | `utils/diffEngine.ts`, `src/application/diffService.ts` | ADR-0003 (M1) | 5 | 5 | ✓ | ✓ |
| 4 | 0004: Auto Schema Invalidation | `src/domain/model/schemaRegistry.ts`, `src/application/schemaService.ts` | ADR-0004 (M2) | 5 | 5 | ✓ | ✓ |
| 5 | 0005: IndexedDB Transaction Profiler | `utils/idbProfiler.ts`, `src/infrastructure/adapters/profilerAdapter.ts` | ADR-0005 (M3) | 5 | 5 | ✓ | ✓ |
| 6 | 0006: AI Test Data Synthesizer | `utils/dataSynthesizer.ts`, `src/application/synthesizerService.ts` | ADR-0006 (M4) | 5 | 5 | ✓ | ✓ |
| 7 | 0007: Storage Compression Engine | `utils/compressionEngine.ts`, `src/infrastructure/adapters/compressionAdapter.ts` | ADR-0007 (M1) | 5 | 5 | ✓ | ✓ |
| 8 | 0008: Time-Travel State Reversion | `utils/timeTravelHistory.ts`, `src/application/timeTravelService.ts` | ADR-0008 (M2) | 5 | 5 | ✓ | ✓ |
| 9 | 0009: Storage Access Control & ACL Policy Engine | `utils/aclPolicyEngine.ts`, `src/domain/model/acl.ts` | ADR-0009 (M2) | 5 | 5 | ✓ | ✓ |
| 10 | 0010: Dead Key & Leak Detector | `utils/leakDetector.ts`, `src/application/leakDetectorService.ts` | ADR-0010 (M3) | 5 | 5 | ✓ | ✓ |
| 11 | 0011: Web Lock & Storage Mutex Manager | `utils/lockManager.ts`, `src/infrastructure/adapters/lockAdapter.ts` | ADR-0011 (M2) | 5 | 5 | ✓ | ✓ |
| 12 | 0012: Storage Memory Usage Heatmap | `components/SpatialCanvas3D.tsx`, `src/application/heatmapService.ts` | ADR-0012 (M3) | 5 | 5 | ✓ | ✓ |
| 13 | 0013: Export/Import Artifact Encryption Pipeline | `utils/exportPipeline.ts`, `src/infrastructure/adapters/exportAdapter.ts` | ADR-0013 (M2) | 5 | 5 | ✓ | ✓ |
| 14 | 0014: Cross-Browser Storage Bridge | `utils/storageBridge.ts`, `src/infrastructure/adapters/bridgeAdapter.ts` | ADR-0014 (M1) | 5 | 5 | ✓ | ✓ |
| 15 | 0015: Storage Event Bus & Reactive Observer | `utils/eventBus.ts`, `src/domain/ports/primary/eventObserver.ts` | ADR-0015 (M1) | 5 | 5 | ✓ | ✓ |
| 16 | 0016: Automated Storage Anomaly Detector | `utils/anomalyDetector.ts`, `src/application/anomalyService.ts` | ADR-0016 (M3) | 5 | 5 | ✓ | ✓ |
| 17 | 0017: Storage Quota Auto-Eviction & Cleanup | `utils/quotaEvictionEngine.ts`, `src/application/quotaService.ts` | ADR-0017 (M3) | 5 | 5 | ✓ | ✓ |
| 18 | 0018: GraphQL Storage Adapter | `utils/graphqlAdapter.ts`, `src/infrastructure/adapters/graphqlAdapter.ts` | ADR-0018 (M4) | 5 | 5 | ✓ | ✓ |
| 19 | 0019: Session Storage Persistence Virtualizer | `utils/sessionVirtualizer.ts`, `src/infrastructure/adapters/sessionAdapter.ts` | ADR-0019 (M3) | 5 | 5 | ✓ | ✓ |
| 20 | 0020: Browser Storage Mocking & Contract Testing Harness | `utils/mockStorageHarness.ts`, `tests/harness/` | ADR-0020 (M1) | 5 | 5 | ✓ | ✓ |
| 21 | 0021: Storage Governance & Compliance Auditor | `utils/complianceAuditor.ts`, `src/application/complianceService.ts` | ADR-0021 (M4) | 5 | 5 | ✓ | ✓ |
| 22 | 0022: Multi-Store Aggregate Search & Indexing Engine | `utils/aggregateSearchEngine.ts`, `src/application/searchService.ts` | ADR-0022 (M4) | 5 | 5 | ✓ | ✓ |
| 23 | 0023: OpenTelemetry Tracing & Audit Log Exporter | `src/infrastructure/telemetry/tracer.ts`, `utils/otlpExporter.ts` | ADR-0023 (M4) | 5 | 5 | ✓ | ✓ |
| 24 | 0024: Storage Migration & Schema Versioning CLI / Protocol | `utils/migrationRunner.ts`, `src/application/migrationService.ts` | ADR-0024 (M4) | 5 | 5 | ✓ | ✓ |
| 25 | 0025: AI Prompt Context Storage Cache | `utils/aiPromptCache.ts`, `src/application/promptCacheService.ts` | ADR-0025 (M4) | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: Vitest (`npx vitest run tests/e2e`)
- Test case format: Vitest BDD spec format (`describe`, `it`, `expect`) exercising opaque-box interfaces & APIs
- Directory layout:
  - `tests/e2e/tier1_feature_coverage/`
  - `tests/e2e/tier2_boundary_corner/`
  - `tests/e2e/tier3_cross_feature/`
  - `tests/e2e/tier4_real_world/`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Storage Encryption & Real-Time Patch Diffing | 0001, 0003, 0007, 0014, 0015, 0020 | High |
| 2 | Cross-Domain CRDT Sync & Web Lock Concurrency | 0002, 0004, 0008, 0009, 0011, 0013 | High |
| 3 | IndexedDB Transaction Profiling & Memory Heatmap Visualization | 0005, 0010, 0012, 0016, 0017, 0019 | High |
| 4 | AI Test Data Generation & Multi-Store Fuzzy Search | 0006, 0018, 0021, 0022, 0023, 0024, 0025 | High |
| 5 | Secure Export/Import Pipeline with Compression & Integrity Verification | 0013, 0007, 0001, 0008 | High |
| 6 | Event-Driven Reactive Storage Mutation & OpenTelemetry Tracing | 0015, 0023, 0014, 0003 | Medium |
| 7 | Storage Quota Auto-Eviction & Leak Detection Lifecycle | 0017, 0010, 0016, 0005 | Medium |
| 8 | GraphQL Storage Adapter Querying & AI Prompt Context Cache | 0018, 0025, 0022, 0004 | High |
| 9 | Session Storage Shadow Virtualization & Time-Travel Timeline Reversion | 0019, 0008, 0011, 0002 | High |
| 10 | Schema Migration CLI Execution & Data Governance Compliance Audit | 0024, 0021, 0004, 0009 | Medium |
| 11 | Multi-Browser Extension Storage Bridge & Mock Harness Testing | 0014, 0020, 0015, 0001 | Medium |
| 12 | End-to-End Enterprise Storage Security, Search & Telemetry Workflow | 0001 - 0025 | Critical |

## Coverage Thresholds
- Tier 1: ≥5 tests per feature (125 tests minimum across 25 features)
- Tier 2: ≥5 tests per feature (125 tests minimum across 25 features)
- Tier 3: Pairwise coverage of major feature interactions (25 tests minimum)
- Tier 4: ≥12 realistic application scenarios (12 tests minimum)
- Total E2E test suite target: ≥287 tests
