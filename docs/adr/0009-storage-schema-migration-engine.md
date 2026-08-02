# 0009. Storage Schema Migration Engine

* **Status:** Accepted
* **Deciders:** Lead Security Architect, Infrastructure Team, Storage Suite Team
* **Date:** 2026-08-01

## Context and Problem Statement
Browser storage data (stored across `localStorage`, `sessionStorage`, `IndexedDB`, and extension storage) evolves across application releases. Schema changes—such as renaming keys, reshaping data models, splitting fields, or enforcing new default values—require deterministic client-side schema migration engines. Without versioned migration pipelines, reading legacy data structures leads to runtime exceptions, broken UI components, and data corruption.

Key architectural requirements include:
1. **Versioned Schema Pipeline**: Sequential execution of migration steps ($v_1 \to v_2 \to v_3 \dots$).
2. **Atomic Rollback Engine**: Automatic step rollback execution (`down` steps) when forward migration step fails mid-pipeline, ensuring storage state is restored without corruption.
3. **Automatic Invalidation & Purging**: Declarative strategies (`purge`, `reset-default`, `backup-and-purge`, `fail`) when stored data version is below `minSupportedVersion` or unparseable.
4. **Storage Engine Integration**: Multi-target key-value storage adapter integration supporting `localStorage`, `sessionStorage`, `IndexedDB`, `cookie`, `cacheAPI`, and `opfs`.
5. **Zero-Throw Monad Standard**: All operations return `Result<T, StorageSchemaMigrationError>`.

## Decision Drivers
* Hexagonal architecture compliance with strict separation of domain models, primary ports, secondary ports, and adapters.
* Zero unhandled exceptions via `Result<T, StorageSchemaMigrationError>` monads.
* Transactional rollback safety restoring state on step errors.
* Flexible invalidation rules for obsolete or incompatible data models.
* Concurrency guard for safe multi-request key processing.

## Decision Outcome
Chosen option: **Versioned Schema Migration Pipeline with Atomic Rollback & Declarative Invalidation Engine**.

### Positives
* **Transactional Reliability**: Automatic step rollback (`down` step handlers) ensures storage never remains in a partially-migrated invalid state.
* **Declarative Recovery**: Obsolete versions below `minSupportedVersion` trigger deterministic invalidation actions (`purge`, `reset-default`, `backup-and-purge`, `fail`).
* **Storage Abstraction**: Decoupled secondary repository port abstracts browser storage target APIs (`localStorage`, `sessionStorage`, `IndexedDB`, `cookie`, `cacheAPI`, `opfs`).
* **Zero Runtime Crashing**: Monadic error handling guarantees safe error propagation without unhandled exceptions.

### Negatives / Tradeoffs
* **Migration Step Overhead**: Each release requires defining both forward (`up`) and reverse (`down`) migration handlers.

## Implementation Details

### Domain Data Structures (`src/domain/model/storageSchemaMigration.ts`)
- **`SchemaVersion`**: `number`
- **`MigrationContext`**: `{ target: StorageTarget; key: string; namespace: string; fromVersion: SchemaVersion; toVersion: SchemaVersion; metadata?: Record<string, unknown> }`
- **`MigrationStep`**: `{ version: SchemaVersion; name: string; up: MigrationUpFn; down: MigrationDownFn; minCompatibleVersion?: SchemaVersion }`
- **`InvalidationStrategy`**: `'purge' | 'reset-default' | 'fail' | 'backup-and-purge'`
- **`SchemaDefinition`**: `{ namespace: string; currentVersion: SchemaVersion; migrations: MigrationStep[]; minSupportedVersion: SchemaVersion; invalidationStrategy: InvalidationStrategy; defaultValue?: Record<string, unknown> }`
- **`SchemaVersionHeader`**: `{ namespace: string; version: SchemaVersion; updatedAt: number; checksum?: string; appliedMigrations: SchemaVersion[] }`
- **`MigrationState`**: `'IDLE' | 'MIGRATING_UP' | 'MIGRATING_DOWN' | 'ROLLING_BACK' | 'INVALIDATED' | 'PURGED' | 'COMPLETED' | 'FAILED'`
- **`MigrationResult`**: `{ success: boolean; namespace: string; key: string; target: StorageTarget; initialVersion: SchemaVersion; finalVersion: SchemaVersion; appliedSteps: SchemaVersion[]; rolledBackSteps: SchemaVersion[]; invalidated: boolean; purged: boolean; migratedData?: Record<string, unknown>; error?: StorageSchemaMigrationError; executionTimeMs: number }`
- **`StorageSchemaMigrationErrorKind`**: `'INVALID_SCHEMA_VERSION' | 'MIGRATION_STEP_FAILED' | 'ROLLBACK_FAILED' | 'INCOMPATIBLE_VERSION' | 'STORAGE_ADAPTER_ERROR' | 'DUPLICATE_VERSION_REGISTRATION' | 'MISSING_MIGRATION_STEP' | 'INVALID_SCHEMA_DEFINITION' | 'CHECKSUM_MISMATCH'`
- **`StorageSchemaMigrationError`**: Domain error class extending `Error`.

### File Inventory
- **ADR Document**: `docs/adr/0009-storage-schema-migration-engine.md`
- **Domain Models**: `src/domain/model/storageSchemaMigration.ts`
- **Primary Port**: `src/domain/ports/primary/storageSchemaMigrationPort.ts`
- **Secondary Port**: `src/domain/ports/secondary/storageSchemaMigrationRepositoryPort.ts`
- **Infrastructure Adapter**: `src/infrastructure/adapters/storageSchemaMigrationAdapter.ts`
- **Utility Engine**: `utils/storageSchemaMigrationEngine.ts`
- **Test Files**:
  - `tests/storageSchemaMigrationEngine.test.ts`
  - `tests/feature_09_storage_schema_migration.test.ts`
  - `tests/storageSchemaMigrationEngine.stress.test.ts`
