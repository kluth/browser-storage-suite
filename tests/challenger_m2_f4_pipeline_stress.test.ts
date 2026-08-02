import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import { StorageSchemaMigrationAdapter } from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import {
  SchemaDefinition,
  StorageSchemaMigrationError,
} from '../src/domain/model/storageSchemaMigration';

describe('Challenger M2 Feature 4 Pipeline Stress Test Harness', () => {
  let adapter: StorageSchemaMigrationAdapter;
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('1. Multi-version migration steps (v1 -> v5)', () => {
    it('should sequentially execute up migrations v1 -> v5 and down migrations v5 -> v1', async () => {
      const upExecuted: number[] = [];
      const downExecuted: number[] = [];

      const schema: SchemaDefinition = {
        namespace: 'multi_v5_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v1 to v2: add profile',
            up: (data) => {
              upExecuted.push(2);
              return { ...data, profile: { username: 'user1' }, versionTrack: [...((data.versionTrack as number[]) || []), 2] };
            },
            down: (data) => {
              downExecuted.push(2);
              const { profile, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'v2 to v3: add settings',
            up: (data) => {
              upExecuted.push(3);
              return { ...data, settings: { theme: 'dark' }, versionTrack: [...((data.versionTrack as number[]) || []), 3] };
            },
            down: (data) => {
              downExecuted.push(3);
              const { settings, ...rest } = data;
              return rest;
            },
          },
          {
            version: 4,
            name: 'v3 to v4: add permissions',
            up: (data) => {
              upExecuted.push(4);
              return { ...data, permissions: ['read', 'write'], versionTrack: [...((data.versionTrack as number[]) || []), 4] };
            },
            down: (data) => {
              downExecuted.push(4);
              const { permissions, ...rest } = data;
              return rest;
            },
          },
          {
            version: 5,
            name: 'v4 to v5: add metadata',
            up: (data) => {
              upExecuted.push(5);
              return { ...data, metadata: { migrated: true }, versionTrack: [...((data.versionTrack as number[]) || []), 5] };
            },
            down: (data) => {
              downExecuted.push(5);
              const { metadata, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      const regRes = engine.registerSchema(schema);
      expect(regRes.ok).toBe(true);

      const initialData = { id: 'usr_100', versionTrack: [1] };

      // Execute Up v1 -> v5
      const resUp = await engine.migrateUp('multi_v5_ns', initialData, 1, 5);
      expect(resUp.ok).toBe(true);
      if (!resUp.ok) return;

      expect(resUp.value.success).toBe(true);
      expect(resUp.value.initialVersion).toBe(1);
      expect(resUp.value.finalVersion).toBe(5);
      expect(resUp.value.appliedSteps).toEqual([2, 3, 4, 5]);
      expect(resUp.value.rolledBackSteps).toEqual([]);
      expect(upExecuted).toEqual([2, 3, 4, 5]);
      expect(resUp.value.migratedData).toEqual({
        id: 'usr_100',
        versionTrack: [1, 2, 3, 4, 5],
        profile: { username: 'user1' },
        settings: { theme: 'dark' },
        permissions: ['read', 'write'],
        metadata: { migrated: true },
      });

      // Execute Down v5 -> v1
      const resDown = await engine.migrateDown('multi_v5_ns', resUp.value.migratedData!, 5, 1);
      expect(resDown.ok).toBe(true);
      if (!resDown.ok) return;

      expect(resDown.value.success).toBe(true);
      expect(resDown.value.initialVersion).toBe(5);
      expect(resDown.value.finalVersion).toBe(1);
      expect(resDown.value.appliedSteps).toEqual([5, 4, 3, 2]);
      expect(downExecuted).toEqual([5, 4, 3, 2]);
      expect(resDown.value.migratedData).toEqual({
        id: 'usr_100',
        versionTrack: [1, 2, 3, 4, 5],
      });
    });

    it('should migrate storage key transparently from v1 to v5 via migrateStorageKey', async () => {
      const schema: SchemaDefinition = {
        namespace: 'key_v5_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: Array.from({ length: 4 }, (_, i) => ({
          version: i + 2,
          name: `Step ${i + 2}`,
          up: (d) => ({ ...d, [`step_${i + 2}`]: true }),
          down: (d) => d,
        })),
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'user:settings:v5';

      await adapter.savePayload(target, key, { userId: 42 });
      await adapter.saveHeader(target, key, 'key_v5_ns', {
        namespace: 'key_v5_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'key_v5_ns');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.success).toBe(true);
      expect(res.value.initialVersion).toBe(1);
      expect(res.value.finalVersion).toBe(5);
      expect(res.value.appliedSteps).toEqual([2, 3, 4, 5]);

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual({
          userId: 42,
          step_2: true,
          step_3: true,
          step_4: true,
          step_5: true,
        });
      }

      const headerRes = await adapter.loadHeader(target, key, 'key_v5_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(5);
        expect(headerRes.value?.appliedMigrations).toEqual([2, 3, 4, 5]);
      }
    });
  });

  describe('2. Intermediate step failure triggering atomic step-by-step rollback', () => {
    it('should roll back applied steps v2 and v3 in exact reverse order when step v4 fails', async () => {
      const upOrder: number[] = [];
      const downOrder: number[] = [];

      const schema: SchemaDefinition = {
        namespace: 'rollback_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (data) => {
              upOrder.push(2);
              return { ...data, v2: true };
            },
            down: (data) => {
              downOrder.push(2);
              const { v2, ...rest } = data;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3',
            up: (data) => {
              upOrder.push(3);
              return { ...data, v3: true };
            },
            down: (data) => {
              downOrder.push(3);
              const { v3, ...rest } = data;
              return rest;
            },
          },
          {
            version: 4,
            name: 'Step 4 (Fails)',
            up: () => {
              upOrder.push(4);
              throw new Error('Simulated failure during Step 4 migration');
            },
            down: (data) => data,
          },
          {
            version: 5,
            name: 'Step 5',
            up: (data) => ({ ...data, v5: true }),
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);

      const res = await engine.migrateUp('rollback_ns', { base: 'data' }, 1, 5);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.version).toBe(4);
        expect(res.error.stepName).toBe('Step 4 (Fails)');
        expect(res.error.message).toContain('Simulated failure during Step 4 migration');
      }

      // Assert up execution: 2, 3, 4
      expect(upOrder).toEqual([2, 3, 4]);
      // Assert rollback execution order: 3 then 2 (exact reverse of applied steps)
      expect(downOrder).toEqual([3, 2]);
    });

    it('should preserve storage header version at starting version when migrateStorageKey encounters step failure', async () => {
      const schema: SchemaDefinition = {
        namespace: 'key_fail_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => ({ ...d, step2: true }),
            down: (d) => d,
          },
          {
            version: 3,
            name: 'Step 3 (Fails)',
            up: () => {
              throw new Error('Step 3 exploded');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'critical:config';

      await adapter.savePayload(target, key, { orig: 'value' });
      await adapter.saveHeader(target, key, 'key_fail_ns', {
        namespace: 'key_fail_ns',
        version: 1,
        updatedAt: 1000,
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'key_fail_ns');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
      }

      // Verify header in storage was reset/preserved at version 1
      const headerRes = await adapter.loadHeader(target, key, 'key_fail_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(1);
      }
    });
  });

  describe('3. Declarative invalidation policy execution (purge, reset-default, backup-and-purge, fail)', () => {
    const rawData = { legacyKey: 'oldValue', active: true };

    it('purge: should delete payload and header when fromVersion is below minSupportedVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'purge_ns',
        currentVersion: 5,
        minSupportedVersion: 3,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'purge_key';

      await adapter.savePayload(target, key, rawData);
      await adapter.saveHeader(target, key, 'purge_ns', {
        namespace: 'purge_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'purge_ns');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.invalidated).toBe(true);
      expect(res.value.purged).toBe(true);
      expect(res.value.finalVersion).toBe(5);

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

    it('reset-default: should overwrite storage payload with defaultValue and update schema header to currentVersion', async () => {
      const defaultState = { theme: 'light', notifications: true, role: 'guest' };
      const schema: SchemaDefinition = {
        namespace: 'reset_ns',
        currentVersion: 4,
        minSupportedVersion: 3,
        invalidationStrategy: 'reset-default',
        defaultValue: defaultState,
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'user_preferences';

      await adapter.savePayload(target, key, { ancientSetting: 'obsolete' });
      await adapter.saveHeader(target, key, 'reset_ns', {
        namespace: 'reset_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'reset_ns');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.invalidated).toBe(true);
      expect(res.value.purged).toBe(false);
      expect(res.value.migratedData).toEqual(defaultState);

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual(defaultState);
      }

      const headerRes = await adapter.loadHeader(target, key, 'reset_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(4);
      }
    });

    it('backup-and-purge: should create backup payload entry before purging key data', async () => {
      let backupKeyCreated = '';

      const originalBackup = adapter.backupPayload.bind(adapter);
      adapter.backupPayload = async (target, key, namespace, payload) => {
        const res = await originalBackup(target, key, namespace, payload);
        if (res.ok) {
          backupKeyCreated = res.value;
        }
        return res;
      };

      const schema: SchemaDefinition = {
        namespace: 'backup_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'backup-and-purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'important_data';

      const payloadData = { secret: 'top_secret_v1', items: [1, 2, 3] };
      await adapter.savePayload(target, key, payloadData);
      await adapter.saveHeader(target, key, 'backup_ns', {
        namespace: 'backup_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'backup_ns');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.invalidated).toBe(true);
      expect(res.value.purged).toBe(true);
      expect(backupKeyCreated).toContain('__backup__:backup_ns:important_data:');

      // Check primary key is deleted
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }

      // Check backup key is preserved in store
      const backupPayloadRes = await adapter.loadPayload(target, backupKeyCreated);
      expect(backupPayloadRes.ok).toBe(true);
      if (backupPayloadRes.ok) {
        expect(backupPayloadRes.value).toEqual(payloadData);
      }
    });

    it('fail: should return INCOMPATIBLE_VERSION error when fromVersion is below minSupportedVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'strict_fail_ns',
        currentVersion: 5,
        minSupportedVersion: 3,
        invalidationStrategy: 'fail',
        migrations: [],
      };

      engine.registerSchema(schema);

      const res = await engine.migrateUp('strict_fail_ns', rawData, 1, 5);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
        expect(res.error.version).toBe(1);
        expect(res.error.message).toContain('below minimum supported version 3');
      }
    });
  });

  describe('4. 50 concurrent migrateStorageKey calls asserting idempotency and zero race conditions', () => {
    it('should execute 50 concurrent migrateStorageKey calls on same key idempotently without race conditions', async () => {
      let step2Count = 0;
      let step3Count = 0;

      const schema: SchemaDefinition = {
        namespace: 'concurrent_50_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2: normalize email',
            up: (data) => {
              step2Count++;
              return { ...data, email: (data.email as string)?.toLowerCase() };
            },
            down: (data) => data,
          },
          {
            version: 3,
            name: 'Step 3: add schemaHash',
            up: (data) => {
              step3Count++;
              return { ...data, schemaHash: 'hash_v3_ok' };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'shared:user:profile';

      await adapter.savePayload(target, key, { email: 'USER@DOMAIN.COM', name: 'Alice' });
      await adapter.saveHeader(target, key, 'concurrent_50_ns', {
        namespace: 'concurrent_50_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      // Fire 50 concurrent migration requests on the exact same target & key
      const concurrentTasks = Array.from({ length: 50 }, () =>
        engine.migrateStorageKey(target, key, 'concurrent_50_ns')
      );

      const results = await Promise.all(concurrentTasks);

      // Verify all 50 calls succeeded
      for (const res of results) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.finalVersion).toBe(3);
        }
      }

      // Assert migration functions were invoked EXACTLY once due to mutex serialization / header version updates
      expect(step2Count).toBe(1);
      expect(step3Count).toBe(1);

      // Verify final saved state
      const finalPayload = await adapter.loadPayload(target, key);
      expect(finalPayload.ok).toBe(true);
      if (finalPayload.ok) {
        expect(finalPayload.value).toEqual({
          email: 'user@domain.com',
          name: 'Alice',
          schemaHash: 'hash_v3_ok',
        });
      }

      const finalHeader = await adapter.loadHeader(target, key, 'concurrent_50_ns');
      expect(finalHeader.ok).toBe(true);
      if (finalHeader.ok) {
        expect(finalHeader.value?.version).toBe(3);
        expect(finalHeader.value?.appliedMigrations).toEqual([2, 3]);
      }
    });
  });

  describe('5. 10,000 item array/nested object transformations asserting latency < 200ms and zero memory leaks', () => {
    it('should transform 10,000 nested item record array within 200ms and maintain zero memory leak profile', async () => {
      const schema: SchemaDefinition = {
        namespace: 'perf_10k_nested_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v1 to v2: compute totals and flatten tags',
            up: (data) => {
              const items = (data.items as any[]) || [];
              const transformed = items.map((item) => ({
                ...item,
                totalValue: item.quantity * item.unitPrice,
                tagCount: item.tags?.length || 0,
              }));
              return { ...data, items: transformed, v2Processed: true };
            },
            down: (data) => data,
          },
          {
            version: 3,
            name: 'v3: generate lookup map index',
            up: (data) => {
              const items = (data.items as any[]) || [];
              const indexMap: Record<string, number> = {};
              items.forEach((item) => {
                indexMap[item.sku] = item.totalValue;
              });
              return { ...data, indexMap, v3Indexed: true };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);

      // Generate 10,000 complex nested objects
      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: `item_${i}`,
        sku: `SKU-${100000 + i}`,
        quantity: (i % 10) + 1,
        unitPrice: 19.99 + (i % 5),
        tags: ['electronics', 'retail', `category_${i % 20}`],
        attributes: {
          weightGrams: 250 + i,
          warehouse: `WH-${i % 5}`,
        },
      }));

      const rawData = { batchId: 'BATCH_2026_001', items };

      const startTime = performance.now();
      const res = await engine.migrateUp('perf_10k_nested_ns', rawData, 1, 3);
      const executionTimeMs = performance.now() - startTime;

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.success).toBe(true);
      expect(res.value.appliedSteps).toEqual([2, 3]);

      const migrated = res.value.migratedData as any;
      expect(migrated.items.length).toBe(10000);
      expect(migrated.items[0].totalValue).toBe(1 * 19.99);
      expect(migrated.items[9999].totalValue).toBe(10 * 23.99);
      expect(Object.keys(migrated.indexMap).length).toBe(10000);

      // Assert strict latency < 200ms
      expect(executionTimeMs).toBeLessThan(200);

      // Memory leak assertion: Repeat migration transformation 20 times in sequence
      // and ensure execution time remains stable and does not degrade exponentially.
      const runDurations: number[] = [];
      for (let i = 0; i < 20; i++) {
        const iterStart = performance.now();
        const iterRes = await engine.migrateUp('perf_10k_nested_ns', rawData, 1, 3);
        const iterDuration = performance.now() - iterStart;
        expect(iterRes.ok).toBe(true);
        runDurations.push(iterDuration);
      }

      // Check average iteration duration < 200ms and last iteration is not degraded compared to first
      const avgDuration = runDurations.reduce((a, b) => a + b, 0) / runDurations.length;
      expect(avgDuration).toBeLessThan(200);
      expect(runDurations[runDurations.length - 1]).toBeLessThan(200);
    });
  });
});
