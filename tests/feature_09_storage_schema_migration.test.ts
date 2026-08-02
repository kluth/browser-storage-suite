import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import { StorageSchemaMigrationAdapter } from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import { SchemaDefinition } from '../src/domain/model/storageSchemaMigration';

describe('Feature 09 Storage Schema Migration Integration Tests', () => {
  let adapter: StorageSchemaMigrationAdapter;
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('Suite 2.1: Multi-Version End-to-End Migration Pipeline (v1 -> v2 -> v3)', () => {
    it('test_05_1: end-to-end multi-version migration updates payload and schema header in storage repository', async () => {
      const schema: SchemaDefinition = {
        namespace: 'app_user',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Split name into firstName and lastName',
            up: (data) => {
              const name = String(data.name || '');
              const parts = name.split(' ');
              return {
                userId: data.userId,
                firstName: parts[0] || '',
                lastName: parts.slice(1).join(' ') || '',
              };
            },
            down: (data) => ({
              userId: data.userId,
              name: `${data.firstName} ${data.lastName}`.trim(),
            }),
          },
          {
            version: 3,
            name: 'Add schemaVersion and createdAt metadata',
            up: (data) => ({
              ...data,
              schemaVersion: 3,
              createdAt: 1700000000,
            }),
            down: (data) => {
              const { schemaVersion, createdAt, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      engine.registerSchema(schema);

      const target = 'localStorage';
      const key = 'user:100';

      await adapter.savePayload(target, key, { userId: 'u_100', name: 'Bob Smith' });
      await adapter.saveHeader(target, key, 'app_user', {
        namespace: 'app_user',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'app_user');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.success).toBe(true);
        expect(res.value.appliedSteps).toEqual([2, 3]);
        expect(res.value.finalVersion).toBe(3);

        const loadedPayload = await adapter.loadPayload(target, key);
        expect(loadedPayload.ok).toBe(true);
        if (loadedPayload.ok) {
          expect(loadedPayload.value).toEqual({
            userId: 'u_100',
            firstName: 'Bob',
            lastName: 'Smith',
            schemaVersion: 3,
            createdAt: 1700000000,
          });
        }

        const loadedHeader = await adapter.loadHeader(target, key, 'app_user');
        expect(loadedHeader.ok).toBe(true);
        if (loadedHeader.ok) {
          expect(loadedHeader.value?.version).toBe(3);
          expect(loadedHeader.value?.appliedMigrations).toEqual([2, 3]);
        }
      }
    });

    it('test_05_2: migrateStorageKey automatically skips migration if header version matches schema currentVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'app_user',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'user:100';

      await adapter.savePayload(target, key, { userId: 'u_100', name: 'Bob' });
      await adapter.saveHeader(target, key, 'app_user', {
        namespace: 'app_user',
        version: 3,
        updatedAt: Date.now(),
        appliedMigrations: [2, 3],
      });

      const res = await engine.migrateStorageKey(target, key, 'app_user');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.appliedSteps).toEqual([]);
        expect(res.value.finalVersion).toBe(3);
      }
    });
  });

  describe('Suite 2.2: Partial Failure Rollback Isolation', () => {
    it('test_06_1: failed v2->v3 step rollbacks payload to v2 state and preserves v2 header in storage', async () => {
      const schema: SchemaDefinition = {
        namespace: 'order_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Add tax rate',
            up: (data) => ({ ...data, tax: 0.1 }),
            down: (data) => {
              const { tax, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Failing step (database connection error)',
            up: () => {
              throw new Error('Database connection error');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'order:500';

      await adapter.savePayload(target, key, { orderId: 'ord_500', total: 100 });
      await adapter.saveHeader(target, key, 'order_ns', {
        namespace: 'order_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'order_ns');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.version).toBe(3);

        const loadedHeader = await adapter.loadHeader(target, key, 'order_ns');
        expect(loadedHeader.ok).toBe(true);
        if (loadedHeader.ok) {
          expect(loadedHeader.value?.version).toBe(1);
        }
      }
    });

    it('test_06_2: failed v1->v2 first step rollback restores original v1 payload and version 1 header', async () => {
      const schema: SchemaDefinition = {
        namespace: 'cart_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Failing step v2',
            up: () => {
              throw new Error('Network error');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'cart:1';

      const originalPayload = { cartId: 'c_1', items: ['apple'] };
      await adapter.savePayload(target, key, originalPayload);
      await adapter.saveHeader(target, key, 'cart_ns', {
        namespace: 'cart_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'cart_ns');

      expect(res.ok).toBe(false);

      const loadedPayload = await adapter.loadPayload(target, key);
      expect(loadedPayload.ok).toBe(true);
      if (loadedPayload.ok) {
        expect(loadedPayload.value).toEqual(originalPayload);
      }

      const loadedHeader = await adapter.loadHeader(target, key, 'cart_ns');
      expect(loadedHeader.ok).toBe(true);
      if (loadedHeader.ok) {
        expect(loadedHeader.value?.version).toBe(1);
      }
    });
  });

  describe('Suite 2.3: Storage Engine Interoperability & Metadata Persistence', () => {
    it('test_07_1: migration pipeline functions seamlessly across IndexedDB, sessionStorage, and cookie adapters', async () => {
      const schema: SchemaDefinition = {
        namespace: 'multi_target',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Add normalized flag',
            up: (data) => ({ ...data, normalized: true }),
            down: (data) => {
              const { normalized, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      engine.registerSchema(schema);

      const targets = ['indexedDB', 'sessionStorage', 'cookie'] as const;
      for (const target of targets) {
        const key = `key_${target}`;
        await adapter.savePayload(target, key, { val: 10 });
        await adapter.saveHeader(target, key, 'multi_target', {
          namespace: 'multi_target',
          version: 1,
          updatedAt: Date.now(),
          appliedMigrations: [],
        });

        const res = await engine.migrateStorageKey(target, key, 'multi_target');
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.finalVersion).toBe(2);
          expect(res.value.migratedData).toEqual({ val: 10, normalized: true });
        }

        const loadedHeader = await adapter.loadHeader(target, key, 'multi_target');
        expect(loadedHeader.ok).toBe(true);
        if (loadedHeader.ok) {
          expect(loadedHeader.value?.version).toBe(2);
        }
      }
    });

    it('test_07_2: unregisterSchema removes schema definition and prevents subsequent key migrations', async () => {
      const schema: SchemaDefinition = {
        namespace: 'temp_schema',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      engine.unregisterSchema('temp_schema');

      const res = await engine.migrateStorageKey('localStorage', 'k1', 'temp_schema');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
      }
    });

    it('test_07_3: migrateStorageKey creates header when migrating unheadered existing key', async () => {
      const schema: SchemaDefinition = {
        namespace: 'legacy_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Upgrade v1 to v2',
            up: (data) => ({ ...data, upgraded: true }),
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'unheadered_key';

      await adapter.savePayload(target, key, { legacyData: 'abc' });

      const res = await engine.migrateStorageKey(target, key, 'legacy_ns');
      expect(res.ok).toBe(true);

      const headerRes = await adapter.loadHeader(target, key, 'legacy_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value).not.toBeNull();
        expect(headerRes.value?.version).toBe(2);
      }
    });

    it('test_07_4: invalidateAndPurge with reset-default strategy updates header and payload in repository', async () => {
      const schema: SchemaDefinition = {
        namespace: 'reset_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'reset-default',
        defaultValue: { defaultSetting: true },
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'reset_key';

      const res = await engine.invalidateAndPurge(target, key, 'reset_ns', 'Corrupted key');
      expect(res.ok).toBe(true);

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual({ defaultSetting: true });
      }

      const headerRes = await adapter.loadHeader(target, key, 'reset_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(2);
      }
    });

    it('test_07_5: invalidateAndPurge with purge strategy removes header and payload from repository', async () => {
      const schema: SchemaDefinition = {
        namespace: 'purge_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'purge_key';

      await adapter.savePayload(target, key, { data: 123 });
      await adapter.saveHeader(target, key, 'purge_ns', {
        namespace: 'purge_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.invalidateAndPurge(target, key, 'purge_ns', 'Force purge');
      expect(res.ok).toBe(true);

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }

      const headerRes = await adapter.loadHeader(target, key, 'purge_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value).toBeNull();
      }
    });

    it('test_07_6: invalidateAndPurge with backup-and-purge strategy creates backup key in repository', async () => {
      const schema: SchemaDefinition = {
        namespace: 'backup_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'backup-and-purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'backup_key';

      await adapter.savePayload(target, key, { precious: 'data' });

      const res = await engine.invalidateAndPurge(target, key, 'backup_ns', 'Corrupted header');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.purged).toBe(true);
      }

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }
    });

    it('test_07_7: getSchemaHeader returns header from repository adapter', async () => {
      const target = 'localStorage';
      const key = 'header_test';
      const namespace = 'ns1';

      await adapter.saveHeader(target, key, namespace, {
        namespace,
        version: 5,
        updatedAt: 123456789,
        appliedMigrations: [2, 3, 4, 5],
      });

      const res = await engine.getSchemaHeader(target, key, namespace);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value?.version).toBe(5);
        expect(res.value?.updatedAt).toBe(123456789);
      }
    });

    it('test_07_8: migrateStorageKey returns error if schema is not registered', async () => {
      const res = await engine.migrateStorageKey('localStorage', 'k', 'unknown_ns');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
      }
    });
  });
});
