# E2E Test Infra: Browser Storage Suite

## Test Philosophy
- Opaque-box, requirement-driven E2E test suite. No dependency on implementation internals.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Live Storage Inspector | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ |
| 2 | Cookie Manager | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ |
| 3 | Storage State Aggregate & Time Travel | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | Data Blaming & Callstack Attribution | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ |
| 5 | Backend API Scanner | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 6 | MCP Server Adapter | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ |
| 7 | SQL-to-IDBCursor Translator | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 8 | Selective Storage Data Seeder | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 9 | Smart Preset Predictor | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 10 | Virtualized Data Grid | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 11 | 3D Spatial Canvas & Worker | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 12 | Hexagonal Application Service & Result<T, E> | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 13 | OpenTelemetry Tracing Layer | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 14 | Native Storage Interception Adapter | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 15 | Storage Quota & Performance Advisor | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 16 | Extension Options & Snapshot Import/Export | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |

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
| 1 | Full Storage Inspection & Provenance Audit | F1, F2, F4, F15 | High |
| 2 | Time-Travel Debugging & State Snapshot Restoration | F3, F10, F12, F16 | High |
| 3 | E-Commerce Cart Hydration & Data Seeding Workflow | F8, F9, F1, F15 | Medium |
| 4 | Backend Discovery & MCP SQL Query Profiling | F5, F6, F7, F13 | High |
| 5 | Multi-Tab Storage Interception & OpenTelemetry Tracing | F14, F13, F3, F4 | High |
| 6 | Spatial Graph 3D Topology Visualization | F11, F10, F1, F3 | High |
| 7 | Extension Backup, Presets & Domain Switch Workflow | F16, F9, F1, F2 | Medium |
| 8 | Hexagonal Domain Validation & Result Pattern Resilience | F12, F7, F6, F3 | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature (80 tests minimum across 16 features)
- Tier 2: ≥5 per feature (80 tests minimum across 16 features)
- Tier 3: Pairwise coverage of major feature interactions (16 tests minimum)
- Tier 4: ≥8 realistic application scenarios (8 tests minimum)
- Total E2E test suite target: ≥184 tests
