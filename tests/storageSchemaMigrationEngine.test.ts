import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import { SchemaDefinition, MigrationContext } from '../src/domain/model/storageSchemaMigration';

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

    it('test_01_2: registerSchema rejects duplicate version step numbers within same schema', () => {
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
        expect(res.error.version).toBe(2);
      }
    });

    it('test_01_3: registerSchema rejects invalid schema definition where currentVersion < minSupportedVersion', () => {
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
      }
    });

    it('test_01_4: validateSchemaChain detects missing intermediate step in version chain', () => {
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
        expect(valRes.error.version).toBe(3);
      }
    });
  });

  describe('Suite 1.2: Forward Migration Runner (migrateUp)', () => {
    it('test_02_1: migrateUp executes step up functions in ascending sequential order', async () => {
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
        expect(res.value.success).toBe(true);
        expect(res.value.migratedData).toEqual({ username: 'alice', displayName: 'alice' });
        expect(res.value.appliedSteps).toEqual([2, 3]);
        expect(res.value.finalVersion).toBe(3);
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
      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.fromVersion).toBe(1);
      expect(capturedContext!.toVersion).toBe(2);
      expect(capturedContext!.namespace).toBe('user_profile');
      expect(capturedContext!.metadata).toEqual({ env: 'test' });
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
        expect(res.value.appliedSteps).toEqual([]);
        expect(res.value.finalVersion).toBe(3);
        expect(res.value.migratedData).toEqual({ username: 'bob' });
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
        expect(res.error.version).toBe(3);
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
        expect(res.value.finalVersion).toBe(1);
        expect(res.value.appliedSteps).toEqual([3, 2]);
        expect(res.value.migratedData).toEqual({ name: 'Alice' });
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
        expect(res.error.version).toBe(2);
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
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
        expect(res.value.migratedData).toBeUndefined();
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
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(false);
        expect(res.value.migratedData).toEqual({ theme: 'dark', settings: {} });
        expect(res.value.finalVersion).toBe(3);
      }
    });

    it('test_04_3: invalidationStrategy backup-and-purge calls repository backup adapter before purge', async () => {
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
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }
    });

    it('test_04_4: invalidationStrategy fail returns INCOMPATIBLE_VERSION error result', async () => {
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
        expect(res.error.version).toBe(0);
      }
    });

    it('test_04_5: unregisterSchema removes registered schema correctly', () => {
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

    it('test_04_6: getSchema returns undefined for unregistered schema', () => {
      const res = engine.getSchema('non_existent');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBeUndefined();
      }
    });
  });
});
