import { Result } from '../../../../utils/result';
import { StorageTarget } from '../../model/valueObjects';
import { SchemaVersionHeader, StorageSchemaMigrationError } from '../../model/storageSchemaMigration';

export interface StorageSchemaMigrationRepositoryPort {
  loadHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<SchemaVersionHeader | null, StorageSchemaMigrationError>>;

  saveHeader(
    target: StorageTarget,
    key: string,
    namespace: string,
    header: SchemaVersionHeader
  ): Promise<Result<void, StorageSchemaMigrationError>>;

  deleteHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<void, StorageSchemaMigrationError>>;

  loadPayload(
    target: StorageTarget,
    key: string
  ): Promise<Result<Record<string, unknown> | null, StorageSchemaMigrationError>>;

  savePayload(
    target: StorageTarget,
    key: string,
    payload: Record<string, unknown>
  ): Promise<Result<void, StorageSchemaMigrationError>>;

  deletePayload(
    target: StorageTarget,
    key: string
  ): Promise<Result<void, StorageSchemaMigrationError>>;

  backupPayload?(
    target: StorageTarget,
    key: string,
    namespace: string,
    payload: Record<string, unknown>
  ): Promise<Result<string, StorageSchemaMigrationError>>;
}
