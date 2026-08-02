import { StorageTarget } from './valueObjects';

export type SchemaVersion = number;

export interface MigrationContext {
  target: StorageTarget;
  key: string;
  namespace: string;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  metadata?: Record<string, unknown>;
}

export type MigrationUpFn = (
  data: Record<string, unknown>,
  context: MigrationContext
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type MigrationDownFn = (
  data: Record<string, unknown>,
  context: MigrationContext
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface MigrationStep {
  version: SchemaVersion;
  name: string;
  up: MigrationUpFn;
  down: MigrationDownFn;
  minCompatibleVersion?: SchemaVersion;
}

export type InvalidationStrategy = 'purge' | 'reset-default' | 'fail' | 'backup-and-purge';

export interface SchemaDefinition {
  namespace: string;
  currentVersion: SchemaVersion;
  migrations: MigrationStep[];
  minSupportedVersion: SchemaVersion;
  invalidationStrategy: InvalidationStrategy;
  defaultValue?: Record<string, unknown>;
}

export interface SchemaVersionHeader {
  namespace: string;
  version: SchemaVersion;
  updatedAt: number;
  checksum?: string;
  appliedMigrations: SchemaVersion[];
}

export type MigrationState =
  | 'IDLE'
  | 'MIGRATING_UP'
  | 'MIGRATING_DOWN'
  | 'ROLLING_BACK'
  | 'INVALIDATED'
  | 'PURGED'
  | 'COMPLETED'
  | 'FAILED';

export interface MigrationResult {
  success: boolean;
  namespace: string;
  key: string;
  target: StorageTarget;
  initialVersion: SchemaVersion;
  finalVersion: SchemaVersion;
  appliedSteps: SchemaVersion[];
  rolledBackSteps: SchemaVersion[];
  invalidated: boolean;
  purged: boolean;
  migratedData?: Record<string, unknown>;
  error?: StorageSchemaMigrationError;
  executionTimeMs: number;
}

export type StorageSchemaMigrationErrorKind =
  | 'INVALID_SCHEMA_VERSION'
  | 'MIGRATION_STEP_FAILED'
  | 'ROLLBACK_FAILED'
  | 'INCOMPATIBLE_VERSION'
  | 'STORAGE_ADAPTER_ERROR'
  | 'DUPLICATE_VERSION_REGISTRATION'
  | 'MISSING_MIGRATION_STEP'
  | 'INVALID_SCHEMA_DEFINITION'
  | 'CHECKSUM_MISMATCH';

export class StorageSchemaMigrationError extends Error {
  public readonly kind: StorageSchemaMigrationErrorKind;
  public readonly version?: SchemaVersion;
  public readonly stepName?: string;
  public readonly cause?: unknown;

  constructor(
    kind: StorageSchemaMigrationErrorKind,
    message: string,
    version?: SchemaVersion,
    stepName?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'StorageSchemaMigrationError';
    this.kind = kind;
    this.version = version;
    this.stepName = stepName;
    this.cause = cause;
    Object.setPrototypeOf(this, StorageSchemaMigrationError.prototype);
  }
}
