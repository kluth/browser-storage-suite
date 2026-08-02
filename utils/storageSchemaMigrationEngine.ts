import { Result } from './result';
import { StorageTarget } from '../src/domain/model/valueObjects';
import {
  SchemaDefinition,
  SchemaVersion,
  SchemaVersionHeader,
  MigrationResult,
  MigrationContext,
  StorageSchemaMigrationError,
} from '../src/domain/model/storageSchemaMigration';
import { StorageSchemaMigrationPort } from '../src/domain/ports/primary/storageSchemaMigrationPort';
import { StorageSchemaMigrationRepositoryPort } from '../src/domain/ports/secondary/storageSchemaMigrationRepositoryPort';
import { StorageSchemaMigrationAdapter, computeChecksum } from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';

export class StorageSchemaMigrationEngine implements StorageSchemaMigrationPort {
  private schemas: Map<string, SchemaDefinition> = new Map();
  private repositoryAdapter: StorageSchemaMigrationRepositoryPort;
  private activeKeyLocks: Map<string, Promise<void>> = new Map();

  constructor(repositoryAdapter?: StorageSchemaMigrationRepositoryPort) {
    this.repositoryAdapter = repositoryAdapter ?? new StorageSchemaMigrationAdapter();
  }

  public registerSchema(schema: SchemaDefinition): Result<void, StorageSchemaMigrationError> {
    if (!schema || !schema.namespace || schema.namespace.trim().length === 0) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          'Schema namespace must be a non-empty string'
        )
      );
    }

    if (
      typeof schema.currentVersion !== 'number' ||
      schema.currentVersion < 1 ||
      !Number.isInteger(schema.currentVersion)
    ) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          'currentVersion must be a positive integer'
        )
      );
    }

    if (
      typeof schema.minSupportedVersion !== 'number' ||
      schema.minSupportedVersion < 1 ||
      !Number.isInteger(schema.minSupportedVersion)
    ) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          'minSupportedVersion must be a positive integer'
        )
      );
    }

    if (schema.currentVersion < schema.minSupportedVersion) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          `currentVersion (${schema.currentVersion}) cannot be less than minSupportedVersion (${schema.minSupportedVersion})`
        )
      );
    }

    if (Array.isArray(schema.migrations)) {
      const seenVersions = new Set<number>();
      for (const step of schema.migrations) {
        if (typeof step.version !== 'number' || step.version < 1 || !Number.isInteger(step.version)) {
          return Result.err(
            new StorageSchemaMigrationError(
              'INVALID_SCHEMA_DEFINITION',
              `Migration step version must be a positive integer`
            )
          );
        }
        if (seenVersions.has(step.version)) {
          return Result.err(
            new StorageSchemaMigrationError(
              'DUPLICATE_VERSION_REGISTRATION',
              `Duplicate migration step registered for version ${step.version}`,
              step.version
            )
          );
        }
        seenVersions.add(step.version);
      }
    }

    this.schemas.set(schema.namespace, schema);
    return Result.ok(undefined);
  }

  public getSchema(namespace: string): Result<SchemaDefinition | undefined, StorageSchemaMigrationError> {
    return Result.ok(this.schemas.get(namespace));
  }

  public unregisterSchema(namespace: string): Result<boolean, StorageSchemaMigrationError> {
    const existed = this.schemas.delete(namespace);
    return Result.ok(existed);
  }

  public validateSchemaChain(namespace: string): Result<boolean, StorageSchemaMigrationError> {
    const schema = this.schemas.get(namespace);
    if (!schema) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          `Schema for namespace '${namespace}' is not registered`
        )
      );
    }

    const migrations = schema.migrations || [];
    for (let v = schema.minSupportedVersion + 1; v <= schema.currentVersion; v++) {
      const step = migrations.find((m) => m.version === v);
      if (!step) {
        return Result.err(
          new StorageSchemaMigrationError(
            'MISSING_MIGRATION_STEP',
            `Missing migration step for version ${v}`,
            v
          )
        );
      }
    }

    return Result.ok(true);
  }

  public async migrateUp(
    namespace: string,
    rawData: Record<string, unknown>,
    fromVersion: SchemaVersion,
    toVersion?: SchemaVersion,
    contextMetadata?: Record<string, unknown>
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    const startTime = performance.now();
    const schema = this.schemas.get(namespace);
    if (!schema) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          `Schema for namespace '${namespace}' is not registered`
        )
      );
    }

    const targetToVersion = toVersion ?? schema.currentVersion;

    if (fromVersion < schema.minSupportedVersion) {
      const invalidationRes = await this.handleInvalidation(
        schema,
        'localStorage',
        '',
        fromVersion,
        `Version ${fromVersion} is below minimum supported version ${schema.minSupportedVersion}`,
        rawData
      );
      if (!invalidationRes.ok) {
        return invalidationRes;
      }
      return Result.ok({
        success: invalidationRes.value.success,
        namespace: invalidationRes.value.namespace,
        key: invalidationRes.value.key,
        target: invalidationRes.value.target,
        initialVersion: invalidationRes.value.initialVersion,
        finalVersion: invalidationRes.value.finalVersion,
        appliedSteps: invalidationRes.value.appliedSteps,
        rolledBackSteps: invalidationRes.value.rolledBackSteps,
        invalidated: invalidationRes.value.invalidated,
        purged: invalidationRes.value.purged,
        migratedData: invalidationRes.value.migratedData,
        executionTimeMs: Math.round(performance.now() - startTime),
      });
    }

    if (fromVersion === targetToVersion) {
      return Result.ok({
        success: true,
        namespace,
        key: '',
        target: 'localStorage',
        initialVersion: fromVersion,
        finalVersion: targetToVersion,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: false,
        purged: false,
        migratedData: JSON.parse(JSON.stringify(rawData)),
        executionTimeMs: Math.round(performance.now() - startTime),
      });
    }

    if (fromVersion > targetToVersion) {
      return this.migrateDown(namespace, rawData, fromVersion, targetToVersion, contextMetadata);
    }

    const requiredSteps: SchemaVersion[] = [];
    for (let v = fromVersion + 1; v <= targetToVersion; v++) {
      requiredSteps.push(v);
    }

    const stepsToRun = (schema.migrations || [])
      .filter((m) => m.version > fromVersion && m.version <= targetToVersion)
      .sort((a, b) => a.version - b.version);

    for (const reqVer of requiredSteps) {
      const stepExists = stepsToRun.some((m) => m.version === reqVer);
      if (!stepExists) {
        return Result.err(
          new StorageSchemaMigrationError(
            'MISSING_MIGRATION_STEP',
            `Missing migration step for version ${reqVer}`,
            reqVer
          )
        );
      }
    }

    let currentData = JSON.parse(JSON.stringify(rawData));
    const appliedSteps: SchemaVersion[] = [];
    const rolledBackSteps: SchemaVersion[] = [];

    // Cycle / recursion detection
    const MAX_STEPS = 1000;
    if (stepsToRun.length > MAX_STEPS) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          'Exceeded maximum migration steps threshold'
        )
      );
    }

    for (const step of stepsToRun) {
      const context: MigrationContext = {
        target: (contextMetadata?.target as StorageTarget) ?? 'localStorage',
        key: (contextMetadata?.key as string) ?? '',
        namespace,
        fromVersion: step.version - 1,
        toVersion: step.version,
        metadata: contextMetadata,
      };

      try {
        const transformed = await step.up(currentData, context);
        currentData = transformed;
        appliedSteps.push(step.version);
      } catch (err) {
        // Step failed! Rollback applied steps in reverse order
        for (let i = appliedSteps.length - 1; i >= 0; i--) {
          const v = appliedSteps[i];
          const stepToRollback = (schema.migrations || []).find((m) => m.version === v);
          if (!stepToRollback || typeof stepToRollback.down !== 'function') {
            return Result.err(
              new StorageSchemaMigrationError(
                'ROLLBACK_FAILED',
                `Missing down function for rollback at version ${v}`,
                v,
                stepToRollback?.name,
                err
              )
            );
          }

          const rollbackContext: MigrationContext = {
            target: (contextMetadata?.target as StorageTarget) ?? 'localStorage',
            key: (contextMetadata?.key as string) ?? '',
            namespace,
            fromVersion: v,
            toVersion: v - 1,
            metadata: contextMetadata,
          };

          try {
            const rolledBackData = await stepToRollback.down(currentData, rollbackContext);
            currentData = rolledBackData;
            rolledBackSteps.push(v);
          } catch (downErr) {
            return Result.err(
              new StorageSchemaMigrationError(
                'ROLLBACK_FAILED',
                `Rollback failed at version ${v}: ${downErr instanceof Error ? downErr.message : String(downErr)}`,
                v,
                stepToRollback.name,
                downErr
              )
            );
          }
        }

        return Result.err(
          new StorageSchemaMigrationError(
            'MIGRATION_STEP_FAILED',
            `Migration step ${step.version} (${step.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
            step.version,
            step.name,
            err
          )
        );
      }
    }

    return Result.ok({
      success: true,
      namespace,
      key: '',
      target: 'localStorage',
      initialVersion: fromVersion,
      finalVersion: targetToVersion,
      appliedSteps,
      rolledBackSteps,
      invalidated: false,
      purged: false,
      migratedData: currentData,
      executionTimeMs: Math.round(performance.now() - startTime),
    });
  }

  public async migrateDown(
    namespace: string,
    rawData: Record<string, unknown>,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
    contextMetadata?: Record<string, unknown>
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    const startTime = performance.now();
    const schema = this.schemas.get(namespace);
    if (!schema) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          `Schema for namespace '${namespace}' is not registered`
        )
      );
    }

    if (fromVersion === toVersion) {
      return Result.ok({
        success: true,
        namespace,
        key: '',
        target: 'localStorage',
        initialVersion: fromVersion,
        finalVersion: toVersion,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: false,
        purged: false,
        migratedData: JSON.parse(JSON.stringify(rawData)),
        executionTimeMs: Math.round(performance.now() - startTime),
      });
    }

    const stepsToRun = (schema.migrations || [])
      .filter((m) => m.version <= fromVersion && m.version > toVersion)
      .sort((a, b) => b.version - a.version);

    let currentData = JSON.parse(JSON.stringify(rawData));
    const appliedSteps: SchemaVersion[] = [];

    for (const step of stepsToRun) {
      if (typeof step.down !== 'function') {
        return Result.err(
          new StorageSchemaMigrationError(
            'MISSING_MIGRATION_STEP',
            `Missing down migration function for version ${step.version}`,
            step.version,
            step.name
          )
        );
      }

      const context: MigrationContext = {
        target: (contextMetadata?.target as StorageTarget) ?? 'localStorage',
        key: (contextMetadata?.key as string) ?? '',
        namespace,
        fromVersion: step.version,
        toVersion: step.version - 1,
        metadata: contextMetadata,
      };

      try {
        const transformed = await step.down(currentData, context);
        currentData = transformed;
        appliedSteps.push(step.version);
      } catch (err) {
        return Result.err(
          new StorageSchemaMigrationError(
            'MIGRATION_STEP_FAILED',
            `Down migration step ${step.version} (${step.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
            step.version,
            step.name,
            err
          )
        );
      }
    }

    return Result.ok({
      success: true,
      namespace,
      key: '',
      target: 'localStorage',
      initialVersion: fromVersion,
      finalVersion: toVersion,
      appliedSteps,
      rolledBackSteps: [],
      invalidated: false,
      purged: false,
      migratedData: currentData,
      executionTimeMs: Math.round(performance.now() - startTime),
    });
  }

  public async migrateStorageKey(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    const lockKey = `${target}:${namespace}:${key}`;
    const previousLock = this.activeKeyLocks.get(lockKey);
    if (previousLock) {
      await previousLock;
      return this.migrateStorageKeyInternal(target, key, namespace);
    }

    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.activeKeyLocks.set(lockKey, lockPromise);

    try {
      return await this.migrateStorageKeyInternal(target, key, namespace);
    } finally {
      this.activeKeyLocks.delete(lockKey);
      resolveLock();
    }
  }

  private async migrateStorageKeyInternal(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    const schema = this.schemas.get(namespace);
    if (!schema) {
      return Result.err(
        new StorageSchemaMigrationError(
          'INVALID_SCHEMA_DEFINITION',
          `Schema for namespace '${namespace}' is not registered`
        )
      );
    }

    const headerRes = await this.repositoryAdapter.loadHeader(target, key, namespace);
    if (!headerRes.ok) {
      if (
        headerRes.error.kind === 'CHECKSUM_MISMATCH' ||
        headerRes.error.kind === 'INVALID_SCHEMA_VERSION'
      ) {
        return this.invalidateAndPurge(target, key, namespace, headerRes.error.message);
      }
      return headerRes;
    }

    const header = headerRes.value;
    const fromVersion = header ? header.version : 1;

    if (header && header.version === schema.currentVersion) {
      return Result.ok({
        success: true,
        namespace,
        key,
        target,
        initialVersion: header.version,
        finalVersion: schema.currentVersion,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: false,
        purged: false,
        executionTimeMs: 0,
      });
    }

    const payloadRes = await this.repositoryAdapter.loadPayload(target, key);
    if (!payloadRes.ok) {
      return payloadRes;
    }

    const rawPayload = payloadRes.value ?? {};

    const migrationRes = await this.migrateUp(
      namespace,
      rawPayload,
      fromVersion,
      schema.currentVersion,
      { target, key }
    );

    if (!migrationRes.ok) {
      if (migrationRes.error.kind === 'MIGRATION_STEP_FAILED') {
        const failedVersion = migrationRes.error.version ?? fromVersion;
        const restoredVersion = fromVersion;
        const currentHeaderVersion = header ? header.version : restoredVersion;

        await this.repositoryAdapter.saveHeader(target, key, namespace, {
          namespace,
          version: currentHeaderVersion,
          updatedAt: Date.now(),
          checksum: computeChecksum(namespace, key, currentHeaderVersion),
          appliedMigrations: header?.appliedMigrations || [],
        });
      }
      return migrationRes;
    }

    const resValue = migrationRes.value;
    if (resValue.invalidated) {
      return this.invalidateAndPurge(
        target,
        key,
        namespace,
        `Obsolete schema version ${fromVersion}`
      );
    }

    const migratedData = resValue.migratedData ?? {};
    const savePayloadRes = await this.repositoryAdapter.savePayload(target, key, migratedData);
    if (!savePayloadRes.ok) {
      return savePayloadRes;
    }

    const newAppliedMigrations = Array.from(
      new Set([...(header?.appliedMigrations || []), ...resValue.appliedSteps])
    );

    const newHeader: SchemaVersionHeader = {
      namespace,
      version: schema.currentVersion,
      updatedAt: Date.now(),
      checksum: computeChecksum(namespace, key, schema.currentVersion),
      appliedMigrations: newAppliedMigrations,
    };

    const saveHeaderRes = await this.repositoryAdapter.saveHeader(
      target,
      key,
      namespace,
      newHeader
    );
    if (!saveHeaderRes.ok) {
      return saveHeaderRes;
    }

    return Result.ok({
      success: true,
      namespace: resValue.namespace,
      key,
      target,
      initialVersion: resValue.initialVersion,
      finalVersion: resValue.finalVersion,
      appliedSteps: resValue.appliedSteps,
      rolledBackSteps: resValue.rolledBackSteps,
      invalidated: resValue.invalidated,
      purged: resValue.purged,
      migratedData: resValue.migratedData,
      executionTimeMs: resValue.executionTimeMs,
    });
  }

  public async invalidateAndPurge(
    target: StorageTarget,
    key: string,
    namespace: string,
    reason: string
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    const schema = this.schemas.get(namespace);
    const strategy = schema && schema.invalidationStrategy ? schema.invalidationStrategy : 'purge';
    const currentVer = schema ? schema.currentVersion : 1;

    if (strategy === 'purge') {
      await this.repositoryAdapter.deleteHeader(target, key, namespace);
      await this.repositoryAdapter.deletePayload(target, key);
      return Result.ok({
        success: true,
        namespace,
        key,
        target,
        initialVersion: 0,
        finalVersion: currentVer,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: true,
        purged: true,
        executionTimeMs: 0,
      });
    }

    if (strategy === 'reset-default') {
      const defaultData =
        schema && schema.defaultValue ? JSON.parse(JSON.stringify(schema.defaultValue)) : {};

      await this.repositoryAdapter.savePayload(target, key, defaultData);
      await this.repositoryAdapter.saveHeader(target, key, namespace, {
        namespace,
        version: currentVer,
        updatedAt: Date.now(),
        checksum: computeChecksum(namespace, key, currentVer),
        appliedMigrations: [],
      });

      return Result.ok({
        success: true,
        namespace,
        key,
        target,
        initialVersion: 0,
        finalVersion: currentVer,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: true,
        purged: false,
        migratedData: defaultData,
        executionTimeMs: 0,
      });
    }

    if (strategy === 'backup-and-purge') {
      const payloadRes = await this.repositoryAdapter.loadPayload(target, key);
      if (
        payloadRes.ok &&
        payloadRes.value !== null &&
        payloadRes.value !== undefined &&
        typeof this.repositoryAdapter.backupPayload === 'function'
      ) {
        await this.repositoryAdapter.backupPayload(target, key, namespace, payloadRes.value);
      }
      await this.repositoryAdapter.deleteHeader(target, key, namespace);
      await this.repositoryAdapter.deletePayload(target, key);

      return Result.ok({
        success: true,
        namespace,
        key,
        target,
        initialVersion: 0,
        finalVersion: currentVer,
        appliedSteps: [],
        rolledBackSteps: [],
        invalidated: true,
        purged: true,
        executionTimeMs: 0,
      });
    }

    return Result.err(
      new StorageSchemaMigrationError(
        'INCOMPATIBLE_VERSION',
        `Invalidated key '${key}' under namespace '${namespace}': ${reason}`
      )
    );
  }

  private async handleInvalidation(
    schema: SchemaDefinition,
    target: StorageTarget,
    key: string,
    fromVersion: SchemaVersion,
    reason: string,
    rawData: Record<string, unknown>
  ): Promise<Result<MigrationResult, StorageSchemaMigrationError>> {
    if (schema.invalidationStrategy === 'fail') {
      return Result.err(
        new StorageSchemaMigrationError(
          'INCOMPATIBLE_VERSION',
          `Version ${fromVersion} is below minimum supported version ${schema.minSupportedVersion}`,
          fromVersion
        )
      );
    }
    return this.invalidateAndPurge(target, key, schema.namespace, reason);
  }

  public async getSchemaHeader(
    target: StorageTarget,
    key: string,
    namespace: string
  ): Promise<Result<SchemaVersionHeader | null, StorageSchemaMigrationError>> {
    return this.repositoryAdapter.loadHeader(target, key, namespace);
  }
}
