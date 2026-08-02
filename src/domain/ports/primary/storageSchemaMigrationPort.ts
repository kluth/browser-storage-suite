import { Result } from '../../../../utils/result';
import { StorageTarget } from '../../model/valueObjects';
import {
  SchemaDefinition,
  MigrationResult,
  StorageSchemaMigrationError,
  SchemaVersionHeader,
  SchemaVersion,
} from '../../model/storageSchemaMigration';

export interface StorageSchemaMigrationPort {
  registerSchema(schema: SchemaDefinition): Result<void, StorageSchemaMigrationError>;
  getSchema(namespace: string): Result<SchemaDefinition | undefined, StorageSchemaMigrationError>;
  unregisterSchema(namespace: string): Result<boolean, StorageSchemaMigrationError>;
  validateSchemaChain(namespace: string): Result<boolean, StorageSchemaMigrationError>;

  migrateUp(
    namespace: string,
    rawData: Record<string, unknown>,
    fromVersion: SchemaVersion,
    toVersion?: SchemaVersion,
    contextMetadata?: Record<string, unknown>
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>>;

  migrateDown(
    namespace: string,
    rawData: Record<string, unknown>,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
    contextMetadata?: Record<string, unknown>
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>>;

  migrateStorageKey(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>>;

  invalidateAndPurge(
    target: StorageTarget,
    key: string,
    namespace: string,
    reason: string
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>>;

  getSchemaHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<SchemaVersionHeader | null, StorageSchemaMigrationError>>;
}
