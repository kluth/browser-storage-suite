import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import {
  SchemaDefinition,
  MigrationContext,
  StorageSchemaMigrationError,
  SchemaVersionHeader,
} from '../src/domain/model/storageSchemaMigration';
import { StorageSchemaMigrationRepositoryPort } from '../src/domain/ports/secondary/storageSchemaMigrationRepositoryPort';
import { StorageTarget } from '../src/domain/model/valueObjects';
import { Result } from '../utils/result';

describe('StorageSchemaMigrationEngine Unit Tests', () => {
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    engine = new StorageSchemaMigrationEngine();
  });

  describe('Suite 1.1: Schema Registration & Version Comparator', () => {
    it('test_01_1: registerSchema stores valid schema definition and validates version ordering', () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Add email field',
            up: (data) => ({ ...data, email: 'user@example.com' }),
            down: (data) => {
              const { email, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Rename name to displayName',
            up: (data) => ({ ...data, displayName: data.name }),
            down: (data) => ({ ...data, name: data.displayName }),
          },
        ],
      };

      const res = engine.registerSchema(schema);
      expect(res.ok).toBe(true);

      const getRes = engine.getSchema('user_profile');
      expect(getRes.ok).toBe(true);
      if (getRes.ok) {
        expect(getRes.value).toEqual(schema);
      }
    });

    it('test_01_2: registerSchema rejects empty or whitespace namespace string', () => {
      const schemaEmpty: SchemaDefinition = {
        namespace: '   ',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      const res = engine.registerSchema(schemaEmpty);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe('Schema namespace must be a non-empty string');
      }
    });

    it('test_01_3: registerSchema rejects invalid currentVersion', () => {
      const invalidVersions = [0, -1, 1.5];
      for (const ver of invalidVersions) {
        const schema: SchemaDefinition = {
          namespace: 'ns',
          currentVersion: ver,
          minSupportedVersion: 1,
          invalidationStrategy: 'purge',
          migrations: [],
        };
        const res = engine.registerSchema(schema);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
          expect(res.error.message).toBe('currentVersion must be a positive integer');
        }
      }
    });

    it('test_01_4: registerSchema rejects invalid minSupportedVersion', () => {
      const invalidVersions = [0, -2, 2.5];
      for (const ver of invalidVersions) {
        const schema: SchemaDefinition = {
          namespace: 'ns',
          currentVersion: 3,
          minSupportedVersion: ver,
          invalidationStrategy: 'purge',
          migrations: [],
        };
        const res = engine.registerSchema(schema);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
          expect(res.error.message).toBe('minSupportedVersion must be a positive integer');
        }
      }
    });

    it('test_01_5: registerSchema rejects currentVersion < minSupportedVersion', () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 1,
        minSupportedVersion: 2,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      const res = engine.registerSchema(schema);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe('currentVersion (1) cannot be less than minSupportedVersion (2)');
      }
    });

    it('test_01_6: registerSchema rejects non-integer step version', () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2.5 as any,
            name: 'Step 2.5',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      const res = engine.registerSchema(schema);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe('Migration step version must be a positive integer');
      }
    });

    it('test_01_7: registerSchema rejects duplicate version step numbers within same schema', () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2a',
            up: (d) => d,
            down: (d) => d,
          },
          {
            version: 2,
            name: 'Step 2b',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      const res = engine.registerSchema(schema);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('DUPLICATE_VERSION_REGISTRATION');
        expect(res.error.message).toBe('Duplicate migration step registered for version 2');
        expect(res.error.version).toBe(2);
      }
    });

    it('test_01_8: validateSchemaChain detects missing intermediate step in version chain', () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 4,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => d,
            down: (d) => d,
          },
          {
            version: 4,
            name: 'Step 4',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const valRes = engine.validateSchemaChain('user_profile');
      expect(valRes.ok).toBe(false);
      if (!valRes.ok) {
        expect(valRes.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(valRes.error.message).toBe('Missing migration step for version 3');
        expect(valRes.error.version).toBe(3);
      }
    });

    it('test_01_9: validateSchemaChain returns error for unregistered schema', () => {
      const res = engine.validateSchemaChain('unregistered');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe("Schema for namespace 'unregistered' is not registered");
      }
    });

    it('test_01_10: validateSchemaChain passes for valid complete step chain', () => {
      const schema: SchemaDefinition = {
        namespace: 'valid_chain',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          { version: 2, name: 'v2', up: (d) => d, down: (d) => d },
          { version: 3, name: 'v3', up: (d) => d, down: (d) => d },
        ],
      };
      engine.registerSchema(schema);
      const res = engine.validateSchemaChain('valid_chain');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(true);
      }
    });
  });

  describe('Suite 1.2: Forward Migration Runner (migrateUp)', () => {
    it('test_02_1: migrateUp executes step up functions in ascending sequential order and returns complete shape', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Add fullName',
            up: (data) => ({ ...data, fullName: data.username }),
            down: (data) => {
              const { fullName, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Rename to displayName',
            up: (data) => {
              const { fullName, ...rest } = data;
              return { ...rest, displayName: fullName };
            },
            down: (data) => {
              const { displayName, ...rest } = data;
              return { ...rest, fullName: displayName };
            },
          },
        ],
      };

      engine.registerSchema(schema);
      const initialData = { username: 'alice' };
      const res = await engine.migrateUp('user_profile', initialData, 1, 3);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 1,
          finalVersion: 3,
          appliedSteps: [2, 3],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          migratedData: { username: 'alice', displayName: 'alice' },
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_02_2: migrateUp passes correct MigrationContext metadata to step functions', async () => {
      let capturedContext: MigrationContext | null = null;

      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 with context',
            up: (data, context) => {
              capturedContext = context;
              return { ...data, updated: true };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { key: 'val' }, 1, 2, { env: 'test' });

      expect(res.ok).toBe(true);
      expect(capturedContext).toEqual({
        target: 'localStorage',
        key: '',
        namespace: 'user_profile',
        fromVersion: 1,
        toVersion: 2,
        metadata: { env: 'test' },
      });
    });

    it('test_02_3: migrateUp returns no-op MigrationResult when fromVersion equals toVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { username: 'bob' }, 3, 3);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 3,
          finalVersion: 3,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          migratedData: { username: 'bob' },
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_02_4: migrateUp fails when namespace is unregistered', async () => {
      const res = await engine.migrateUp('unregistered', {}, 1, 2);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe("Schema for namespace 'unregistered' is not registered");
      }
    });

    it('test_02_5: migrateUp delegates to migrateDown when fromVersion > targetToVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 3,
            name: 'Step 3',
            up: (d) => d,
            down: (data) => {
              const { v3, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { name: 'Bob', v3: true }, 3, 2);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.finalVersion).toBe(2);
        expect(res.value.appliedSteps).toEqual([3]);
        expect(res.value.migratedData).toEqual({ name: 'Bob' });
      }
    });

    it('test_02_6: migrateUp returns MISSING_MIGRATION_STEP when step is missing in pipeline', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          { version: 3, name: 'Step 3', up: (d) => d, down: (d) => d }, // Missing step 2!
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', {}, 1, 3);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.message).toBe('Missing migration step for version 2');
        expect(res.error.version).toBe(2);
      }
    });

    it('test_02_7: migrateUp returns INVALID_SCHEMA_DEFINITION when step count exceeds MAX_STEPS (1000)', async () => {
      const steps = [];
      for (let i = 2; i <= 1003; i++) {
        steps.push({ version: i, name: `Step ${i}`, up: (d: any) => d, down: (d: any) => d });
      }
      const schema: SchemaDefinition = {
        namespace: 'big_schema',
        currentVersion: 1003,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: steps,
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('big_schema', {}, 1, 1003);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe('Exceeded maximum migration steps threshold');
      }
    });

    it('test_02_8: migrateUp handles step throwing string exception (non-Error primitive)', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: () => {
              throw 'String error';
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', {}, 1, 2);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.message).toBe('Migration step 2 (Step 2) failed: String error');
      }
    });
  });

  describe('Suite 1.3: Rollback Engine (migrateDown & Error Recovery)', () => {
    it('test_03_1: atomic rollback calls down handlers in reverse order when up step fails', async () => {
      let step2DownCalled = false;

      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (adds fieldA)',
            up: (data) => ({ ...data, fieldA: 'A' }),
            down: (data) => {
              step2DownCalled = true;
              const { fieldA, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3 (throws error)',
            up: () => {
              throw new Error('Step 3 Failed');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { base: 'data' }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.message).toBe(
          'Migration step 3 (Step 3 (throws error)) failed: Step 3 Failed'
        );
        expect(res.error.version).toBe(3);
        expect(res.error.stepName).toBe('Step 3 (throws error)');
        expect(step2DownCalled).toBe(true);
      }
    });

    it('test_03_2: migrateDown explicitly executes step down functions from higher to lower version', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (data) => ({ ...data, v2: true }),
            down: (data) => {
              const { v2, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3',
            up: (data) => ({ ...data, v3: true }),
            down: (data) => {
              const { v3, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      engine.registerSchema(schema);
      const v3Data = { name: 'Alice', v2: true, v3: true };
      const res = await engine.migrateDown('user_profile', v3Data, 3, 1);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 3,
          finalVersion: 1,
          appliedSteps: [3, 2],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          migratedData: { name: 'Alice' },
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_03_3: rollback failure returns ROLLBACK_FAILED error kind when down handler throws', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (data) => ({ ...data, step2: true }),
            down: () => {
              throw new Error('Broken down handler');
            },
          },
          {
            version: 3,
            name: 'Step 3',
            up: () => {
              throw new Error('Step 3 failed');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { base: 'data' }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.message).toBe('Rollback failed at version 2: Broken down handler');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2');
      }
    });

    it('test_03_4: rollback failure returns ROLLBACK_FAILED when down handler is missing in stepToRollback', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (data) => ({ ...data, step2: true }),
            down: undefined as any,
          },
          {
            version: 3,
            name: 'Step 3',
            up: () => {
              throw new Error('Step 3 failed');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { base: 'data' }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.message).toBe('Missing down function for rollback at version 2');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2');
      }
    });

    it('test_03_5: migrateDown returns MISSING_MIGRATION_STEP when down handler missing', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => d,
            down: undefined as any,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateDown('user_profile', {}, 2, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.message).toBe('Missing down migration function for version 2');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2');
      }
    });

    it('test_03_6: migrateDown handles down handler throwing string error', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => d,
            down: () => {
              throw 'Down string err';
            },
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateDown('user_profile', {}, 2, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.message).toBe('Down migration step 2 (Step 2) failed: Down string err');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2');
      }
    });

    it('test_03_7: migrateDown returns error for unregistered schema', async () => {
      const res = await engine.migrateDown('unregistered', {}, 2, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe("Schema for namespace 'unregistered' is not registered");
      }
    });

    it('test_03_8: migrateDown returns no-op when fromVersion equals toVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };
      engine.registerSchema(schema);
      const res = await engine.migrateDown('user_profile', { a: 1 }, 2, 2);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 2,
          finalVersion: 2,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          migratedData: { a: 1 },
          executionTimeMs: expect.any(Number),
        });
      }
    });
  });

  describe('Suite 1.4: Auto-Invalidation Policies', () => {
    it('test_04_1: invalidationStrategy purge deletes payload and header when version < minSupportedVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { legacy: 'data' }, 0, 3);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 0,
          finalVersion: 3,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: true,
          purged: true,
          migratedData: undefined,
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_04_2: invalidationStrategy reset-default replaces payload with defaultValue at currentVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'settings_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'reset-default',
        defaultValue: { theme: 'dark', settings: {} },
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('settings_ns', { obsolete: true }, 0, 3);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'settings_ns',
          key: '',
          target: 'localStorage',
          initialVersion: 0,
          finalVersion: 3,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: true,
          purged: false,
          migratedData: { theme: 'dark', settings: {} },
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_04_3: invalidationStrategy reset-default uses empty object when defaultValue is missing', async () => {
      const schema: SchemaDefinition = {
        namespace: 'no_def_ns',
        currentVersion: 2,
        minSupportedVersion: 2,
        invalidationStrategy: 'reset-default',
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.invalidateAndPurge('localStorage', 'k', 'no_def_ns', 'obsolete');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.migratedData).toEqual({});
        expect(res.value.finalVersion).toBe(2);
      }
    });

    it('test_04_4: invalidationStrategy backup-and-purge calls repository backup adapter before purge', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'backup-and-purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { oldVal: 123 }, 0, 3);

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user_profile',
          key: '',
          target: 'localStorage',
          initialVersion: 0,
          finalVersion: 3,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: true,
          purged: true,
          migratedData: undefined,
          executionTimeMs: expect.any(Number),
        });
      }
    });

    it('test_04_5: invalidationStrategy fail returns INCOMPATIBLE_VERSION error result', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'fail',
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('user_profile', { oldVal: 123 }, 0, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
        expect(res.error.message).toBe('Version 0 is below minimum supported version 2');
        expect(res.error.version).toBe(0);
      }
    });

    it('test_04_6: invalidateAndPurge with unknown invalidationStrategy returns INCOMPATIBLE_VERSION error', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user_profile',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'unknown_strat' as any,
        migrations: [],
      };

      engine.registerSchema(schema);
      const res = await engine.invalidateAndPurge('localStorage', 'k1', 'user_profile', 'Corrupt header');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
        expect(res.error.message).toBe("Invalidated key 'k1' under namespace 'user_profile': Corrupt header");
      }
    });

    it('test_04_7: unregisterSchema removes registered schema correctly', () => {
      const schema: SchemaDefinition = {
        namespace: 'temp_ns',
        currentVersion: 1,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const get1 = engine.getSchema('temp_ns');
      expect(get1.ok).toBe(true);
      if (get1.ok) {
        expect(get1.value).toBeDefined();
      }

      const unregRes = engine.unregisterSchema('temp_ns');
      expect(unregRes.ok).toBe(true);
      if (unregRes.ok) {
        expect(unregRes.value).toBe(true);
      }

      const get2 = engine.getSchema('temp_ns');
      expect(get2.ok).toBe(true);
      if (get2.ok) {
        expect(get2.value).toBeUndefined();
      }
    });

    it('test_04_8: getSchema returns undefined for unregistered schema', () => {
      const res = engine.getSchema('non_existent');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBeUndefined();
      }
    });
  });

  describe('Suite 1.5: Repository Engine Integration & Concurrency Locking (migrateStorageKey)', () => {
    it('test_05_1: migrateStorageKey migrates stored key from repository and saves updated header/payload', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v2',
            up: (d) => ({ ...d, v2: true }),
            down: (d) => d,
          },
        ],
      };
      engine.registerSchema(schema);

      // Save v1 header & payload in repository adapter
      const adapter = (engine as any).repositoryAdapter as StorageSchemaMigrationRepositoryPort;
      await adapter.saveHeader('localStorage', 'user_key', 'user', {
        namespace: 'user',
        version: 1,
        updatedAt: 1000,
        appliedMigrations: [],
      });
      await adapter.savePayload('localStorage', 'user_key', { name: 'Alice' });

      const res = await engine.migrateStorageKey('localStorage', 'user_key', 'user');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user',
          key: 'user_key',
          target: 'localStorage',
          initialVersion: 1,
          finalVersion: 2,
          appliedSteps: [2],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          migratedData: { name: 'Alice', v2: true },
          executionTimeMs: expect.any(Number),
        });
      }

      // Verify header updated in adapter
      const headerRes = await engine.getSchemaHeader('localStorage', 'user_key', 'user');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(2);
        expect(headerRes.value?.appliedMigrations).toEqual([2]);
      }
    });

    it('test_05_2: migrateStorageKey returns no-op when header version matches schema.currentVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };
      engine.registerSchema(schema);

      const adapter = (engine as any).repositoryAdapter as StorageSchemaMigrationRepositoryPort;
      await adapter.saveHeader('localStorage', 'user_key', 'user', {
        namespace: 'user',
        version: 2,
        updatedAt: 1000,
        appliedMigrations: [2],
      });

      const res = await engine.migrateStorageKey('localStorage', 'user_key', 'user');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          success: true,
          namespace: 'user',
          key: 'user_key',
          target: 'localStorage',
          initialVersion: 2,
          finalVersion: 2,
          appliedSteps: [],
          rolledBackSteps: [],
          invalidated: false,
          purged: false,
          executionTimeMs: 0,
        });
      }
    });

    it('test_05_3: migrateStorageKey returns error for unregistered schema', async () => {
      const res = await engine.migrateStorageKey('localStorage', 'user_key', 'unregistered');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
        expect(res.error.message).toBe("Schema for namespace 'unregistered' is not registered");
      }
    });

    it('test_05_4: migrateStorageKey purges key on loadHeader CHECKSUM_MISMATCH', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };
      engine.registerSchema(schema);

      const mockAdapter: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () =>
          Result.err(
            new StorageSchemaMigrationError(
              'CHECKSUM_MISMATCH',
              "Checksum mismatch for header of key 'bad_key'"
            )
          ),
        saveHeader: async () => Result.ok(undefined),
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () => Result.ok(null),
        savePayload: async () => Result.ok(undefined),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok('backup_key'),
      };

      const customEngine = new StorageSchemaMigrationEngine(mockAdapter);
      customEngine.registerSchema(schema);

      const res = await customEngine.migrateStorageKey('localStorage', 'bad_key', 'user');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }
    });

    it('test_05_5: migrateStorageKey returns error when loadHeader fails with non-checksum error', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };
      engine.registerSchema(schema);

      const mockAdapter: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () =>
          Result.err(
            new StorageSchemaMigrationError('STORAGE_ADAPTER_ERROR', 'Fatal header load error')
          ),
        saveHeader: async () => Result.ok(undefined),
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () => Result.ok(null),
        savePayload: async () => Result.ok(undefined),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok(''),
      };

      const customEngine = new StorageSchemaMigrationEngine(mockAdapter);
      customEngine.registerSchema(schema);

      const res = await customEngine.migrateStorageKey('localStorage', 'k', 'user');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('STORAGE_ADAPTER_ERROR');
        expect(res.error.message).toBe('Fatal header load error');
      }
    });

    it('test_05_6: migrateStorageKey handles loadPayload error, savePayload error, saveHeader error', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [{ version: 2, name: 'v2', up: (d) => d, down: (d) => d }],
      };

      // Case 1: loadPayload error
      const mockAdapter1: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () => Result.ok(null),
        saveHeader: async () => Result.ok(undefined),
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () =>
          Result.err(new StorageSchemaMigrationError('STORAGE_ADAPTER_ERROR', 'Payload load fail')),
        savePayload: async () => Result.ok(undefined),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok(''),
      };
      const engine1 = new StorageSchemaMigrationEngine(mockAdapter1);
      engine1.registerSchema(schema);
      const res1 = await engine1.migrateStorageKey('localStorage', 'k', 'user');
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.message).toBe('Payload load fail');

      // Case 2: savePayload error
      const mockAdapter2: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () => Result.ok(null),
        saveHeader: async () => Result.ok(undefined),
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () => Result.ok({}),
        savePayload: async () =>
          Result.err(new StorageSchemaMigrationError('STORAGE_ADAPTER_ERROR', 'Save payload fail')),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok(''),
      };
      const engine2 = new StorageSchemaMigrationEngine(mockAdapter2);
      engine2.registerSchema(schema);
      const res2 = await engine2.migrateStorageKey('localStorage', 'k', 'user');
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error.message).toBe('Save payload fail');

      // Case 3: saveHeader error
      const mockAdapter3: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () => Result.ok(null),
        saveHeader: async () =>
          Result.err(new StorageSchemaMigrationError('STORAGE_ADAPTER_ERROR', 'Save header fail')),
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () => Result.ok({}),
        savePayload: async () => Result.ok(undefined),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok(''),
      };
      const engine3 = new StorageSchemaMigrationEngine(mockAdapter3);
      engine3.registerSchema(schema);
      const res3 = await engine3.migrateStorageKey('localStorage', 'k', 'user');
      expect(res3.ok).toBe(false);
      if (!res3.ok) expect(res3.error.message).toBe('Save header fail');
    });

    it('test_05_7: migrateStorageKey saves header with restored version when migration step fails', async () => {
      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v2 fail',
            up: () => {
              throw new Error('Step 2 fail');
            },
            down: (d) => d,
          },
        ],
      };

      let savedHeader: SchemaVersionHeader | null = null;
      const mockAdapter: StorageSchemaMigrationRepositoryPort = {
        loadHeader: async () =>
          Result.ok({
            namespace: 'user',
            version: 1,
            updatedAt: 500,
            appliedMigrations: [],
          }),
        saveHeader: async (_t, _k, _n, h) => {
          savedHeader = h;
          return Result.ok(undefined);
        },
        deleteHeader: async () => Result.ok(undefined),
        loadPayload: async () => Result.ok({ name: 'Alice' }),
        savePayload: async () => Result.ok(undefined),
        deletePayload: async () => Result.ok(undefined),
        backupPayload: async () => Result.ok(''),
      };

      const customEngine = new StorageSchemaMigrationEngine(mockAdapter);
      customEngine.registerSchema(schema);

      const res = await customEngine.migrateStorageKey('localStorage', 'user_key', 'user');
      expect(res.ok).toBe(false);
      expect(savedHeader).not.toBeNull();
      expect((savedHeader as SchemaVersionHeader | null)?.version).toBe(1);
    });

    it('test_05_8: migrateStorageKey queues concurrent migration calls on same target:namespace:key lock', async () => {
      const order: number[] = [];

      const schema: SchemaDefinition = {
        namespace: 'user',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v2 delay',
            up: async (d) => {
              order.push(1);
              await new Promise((r) => setTimeout(r, 50));
              order.push(2);
              return { ...d, v2: true };
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      // Trigger two concurrent migration calls on the same key
      const promise1 = engine.migrateStorageKey('localStorage', 'shared_key', 'user');
      const promise2 = engine.migrateStorageKey('localStorage', 'shared_key', 'user');

      const [res1, res2] = await Promise.all([promise1, promise2]);
      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      expect(order).toEqual([1, 2]); // Call 1 finished before Call 2 ran
    });

    it('test_05_9: migrateUp sorts out-of-order migration steps in ascending version sequence', async () => {
      const appliedOrder: number[] = [];
      const schema: SchemaDefinition = {
        namespace: 'sort_up_ns',
        currentVersion: 4,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          // Defined out of order
          { version: 4, name: 'Step 4', up: (d) => { appliedOrder.push(4); return d; }, down: (d) => d },
          { version: 2, name: 'Step 2', up: (d) => { appliedOrder.push(2); return d; }, down: (d) => d },
          { version: 3, name: 'Step 3', up: (d) => { appliedOrder.push(3); return d; }, down: (d) => d },
        ],
      };
      engine.registerSchema(schema);

      const res = await engine.migrateUp('sort_up_ns', {}, 1, 4);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.appliedSteps).toEqual([2, 3, 4]);
        expect(appliedOrder).toEqual([2, 3, 4]);
      }
    });

    it('test_05_10: migrateDown sorts out-of-order migration steps in descending version sequence', async () => {
      const appliedOrder: number[] = [];
      const schema: SchemaDefinition = {
        namespace: 'sort_down_ns',
        currentVersion: 4,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          // Defined out of order
          { version: 2, name: 'Step 2', up: (d) => d, down: (d) => { appliedOrder.push(2); return d; } },
          { version: 4, name: 'Step 4', up: (d) => d, down: (d) => { appliedOrder.push(4); return d; } },
          { version: 3, name: 'Step 3', up: (d) => d, down: (d) => { appliedOrder.push(3); return d; } },
        ],
      };
      engine.registerSchema(schema);

      const res = await engine.migrateDown('sort_down_ns', {}, 4, 1);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.appliedSteps).toEqual([4, 3, 2]);
        expect(appliedOrder).toEqual([4, 3, 2]);
      }
    });

    it('test_05_11: migrateUp explicit toVersion parameter overrides schema currentVersion', async () => {
      let step3Called = false;
      const schema: SchemaDefinition = {
        namespace: 'override_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          { version: 2, name: 'Step 2', up: (d) => ({ ...d, v2: true }), down: (d) => d },
          { version: 3, name: 'Step 3', up: (d) => { step3Called = true; return { ...d, v3: true }; }, down: (d) => d },
        ],
      };
      engine.registerSchema(schema);

      const res = await engine.migrateUp('override_ns', { init: 1 }, 1, 2);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.finalVersion).toBe(2);
        expect(res.value.appliedSteps).toEqual([2]);
        expect(step3Called).toBe(false);
      }
    });
  });
});
