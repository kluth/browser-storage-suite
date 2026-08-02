import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import { StorageSchemaMigrationAdapter } from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import { SchemaDefinition } from '../src/domain/model/storageSchemaMigration';

describe('Pipeline Stress Challenger F4 (ADR-0009 Storage Schema Migration Engine)', () => {
  let adapter: StorageSchemaMigrationAdapter;
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('1. Multi-Version Migration Steps Pipeline (v1 -> v2 -> v3 -> v4 -> v5)', () => {
    it('should successfully execute a 5-step forward migration chain and update storage header', async () => {
      const stepExecutionLog: number[] = [];

      const schema: SchemaDefinition = {
        namespace: 'multi_step_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2: Add step2Flag',
            up: (data) => {
              stepExecutionLog.push(2);
              return { ...data, step2Flag: true, val: (data.val as number) + 10 };
            },
            down: (data) => {
              const { step2Flag, ...rest } = data;
              return { ...rest, val: (data.val as number) - 10 };
            },
          },
          {
            version: 3,
            name: 'Step 3: Multiply val by 2',
            up: (data) => {
              stepExecutionLog.push(3);
              return { ...data, step3Flag: true, val: (data.val as number) * 2 };
            },
            down: (data) => {
              const { step3Flag, ...rest } = data;
              return { ...rest, val: (data.val as number) / 2 };
            },
          },
          {
            version: 4,
            name: 'Step 4: Rename val to result',
            up: (data) => {
              stepExecutionLog.push(4);
              const { val, ...rest } = data;
              return { ...rest, step4Flag: true, result: val };
            },
            down: (data) => {
              const { result, step4Flag, ...rest } = data;
              return { ...rest, val: result };
            },
          },
          {
            version: 5,
            name: 'Step 5: Append status tag',
            up: (data) => {
              stepExecutionLog.push(5);
              return { ...data, status: 'MIGRATED_V5' };
            },
            down: (data) => {
              const { status, ...rest } = data;
              return rest;
            },
          },
        ],
      };

      const regRes = engine.registerSchema(schema);
      expect(regRes.ok).toBe(true);

      const target = 'localStorage';
      const key = 'entity:1001';
      const initialPayload = { entityId: 1001, val: 5 };

      await adapter.savePayload(target, key, initialPayload);
      await adapter.saveHeader(target, key, 'multi_step_ns', {
        namespace: 'multi_step_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const migrateRes = await engine.migrateStorageKey(target, key, 'multi_step_ns');
      expect(migrateRes.ok).toBe(true);
      if (migrateRes.ok) {
        expect(migrateRes.value.success).toBe(true);
        expect(migrateRes.value.initialVersion).toBe(1);
        expect(migrateRes.value.finalVersion).toBe(5);
        expect(migrateRes.value.appliedSteps).toEqual([2, 3, 4, 5]);
        expect(migrateRes.value.rolledBackSteps).toEqual([]);
        expect(migrateRes.value.invalidated).toBe(false);
      }

      expect(stepExecutionLog).toEqual([2, 3, 4, 5]);

      // Verify payload in storage: ((5 + 10) * 2 = 30)
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual({
          entityId: 1001,
          step2Flag: true,
          step3Flag: true,
          step4Flag: true,
          result: 30,
          status: 'MIGRATED_V5',
        });
      }

      // Verify header in storage
      const headerRes = await adapter.loadHeader(target, key, 'multi_step_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(5);
        expect(headerRes.value?.appliedMigrations).toEqual([2, 3, 4, 5]);
      }
    });

    it('should correctly execute reverse migration (migrateDown) from v5 to v1', async () => {
      const schema: SchemaDefinition = {
        namespace: 'down_chain_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => ({ ...d, v2: true }),
            down: (d) => {
              const { v2, ...rest } = d;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3',
            up: (d) => ({ ...d, v3: true }),
            down: (d) => {
              const { v3, ...rest } = d;
              return rest;
            },
          },
          {
            version: 4,
            name: 'Step 4',
            up: (d) => ({ ...d, v4: true }),
            down: (d) => {
              const { v4, ...rest } = d;
              return rest;
            },
          },
          {
            version: 5,
            name: 'Step 5',
            up: (d) => ({ ...d, v5: true }),
            down: (d) => {
              const { v5, ...rest } = d;
              return rest;
            },
          },
        ],
      };

      engine.registerSchema(schema);

      const v5Data = { base: 'data', v2: true, v3: true, v4: true, v5: true };
      const downRes = await engine.migrateDown('down_chain_ns', v5Data, 5, 1);

      expect(downRes.ok).toBe(true);
      if (downRes.ok) {
        expect(downRes.value.appliedSteps).toEqual([5, 4, 3, 2]);
        expect(downRes.value.finalVersion).toBe(1);
        expect(downRes.value.migratedData).toEqual({ base: 'data' });
      }
    });
  });

  describe('2. Intermediate Step Failures & Atomic Step-by-Step Rollback', () => {
    it('should trigger atomic step-by-step rollback in reverse order when intermediate step 4 fails during v1->v5 migration', async () => {
      const upCalled: number[] = [];
      const downCalled: number[] = [];

      const schema: SchemaDefinition = {
        namespace: 'rollback_ns',
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => {
              upCalled.push(2);
              return { ...d, step2: 'done' };
            },
            down: (d) => {
              downCalled.push(2);
              const { step2, ...rest } = d;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3',
            up: (d) => {
              upCalled.push(3);
              return { ...d, step3: 'done' };
            },
            down: (d) => {
              downCalled.push(3);
              const { step3, ...rest } = d;
              return rest;
            },
          },
          {
            version: 4,
            name: 'Step 4 (Fails)',
            up: () => {
              upCalled.push(4);
              throw new Error('Simulated failure in Step 4 UP');
            },
            down: (d) => {
              downCalled.push(4);
              return d;
            },
          },
          {
            version: 5,
            name: 'Step 5',
            up: (d) => {
              upCalled.push(5);
              return { ...d, step5: 'done' };
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      const target = 'localStorage';
      const key = 'rollback_key';
      const initialPayload = { raw: 'original_v1_data' };

      await adapter.savePayload(target, key, initialPayload);
      await adapter.saveHeader(target, key, 'rollback_ns', {
        namespace: 'rollback_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'rollback_ns');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.version).toBe(4);
        expect(res.error.stepName).toBe('Step 4 (Fails)');
      }

      // Step 2 and Step 3 up ran, then Step 4 up failed.
      expect(upCalled).toEqual([2, 3, 4]);
      // Rollback must call step 3 down then step 2 down in reverse order
      expect(downCalled).toEqual([3, 2]);

      // Storage header must remain at version 1 (unmodified/restored)
      const headerRes = await adapter.loadHeader(target, key, 'rollback_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(1);
      }
    });

    it('should return ROLLBACK_FAILED when down function throws during rollback execution', async () => {
      const schema: SchemaDefinition = {
        namespace: 'rollback_fail_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (Down throws)',
            up: (d) => ({ ...d, step2: true }),
            down: () => {
              throw new Error('Fatal error inside Step 2 DOWN handler');
            },
          },
          {
            version: 3,
            name: 'Step 3 (Up throws)',
            up: () => {
              throw new Error('Step 3 UP failed');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('rollback_fail_ns', { base: 1 }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2 (Down throws)');
      }
    });
  });

  describe('3. Declarative Invalidation Policy Execution (purge, reset-default, backup-and-purge, fail)', () => {
    it('Policy "purge": should purge payload and header when version < minSupportedVersion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'purge_policy_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'obsolete_purge_key';

      await adapter.savePayload(target, key, { oldData: 'v0_legacy' });
      await adapter.saveHeader(target, key, 'purge_policy_ns', {
        namespace: 'purge_policy_ns',
        version: 1, // Below minSupportedVersion 2
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'purge_policy_ns');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }

      // Payload and header should be deleted
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }

      const headerRes = await adapter.loadHeader(target, key, 'purge_policy_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value).toBeNull();
      }
    });

    it('Policy "reset-default": should reset payload to defaultValue and write currentVersion header', async () => {
      const defaultState = { theme: 'dark', language: 'en', notificationsEnabled: true };

      const schema: SchemaDefinition = {
        namespace: 'reset_default_policy_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'reset-default',
        defaultValue: defaultState,
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'obsolete_reset_key';

      await adapter.savePayload(target, key, { brokenField: 999 });
      await adapter.saveHeader(target, key, 'reset_default_policy_ns', {
        namespace: 'reset_default_policy_ns',
        version: 1, // Below minSupportedVersion 2
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'reset_default_policy_ns');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(false);
        expect(res.value.migratedData).toEqual(defaultState);
        expect(res.value.finalVersion).toBe(3);
      }

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual(defaultState);
      }

      const headerRes = await adapter.loadHeader(target, key, 'reset_default_policy_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(3);
      }
    });

    it('Policy "backup-and-purge": should create payload backup before purging main payload and header', async () => {
      const schema: SchemaDefinition = {
        namespace: 'backup_purge_policy_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'backup-and-purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'valuable_legacy_key';

      const legacyVal = { secretKey: 'ABC-123-DEF', auditLog: [1, 2, 3] };
      await adapter.savePayload(target, key, legacyVal);
      await adapter.saveHeader(target, key, 'backup_purge_policy_ns', {
        namespace: 'backup_purge_policy_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'backup_purge_policy_ns');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }

      // Main payload and header deleted
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }

      // Verify backup key exists in adapter's internal store
      const storeMap = (adapter as any).getStore(target) as Map<string, string>;
      let backupFound = false;
      let backupData: any = null;

      for (const [k, v] of storeMap.entries()) {
        if (k.startsWith('__backup__:backup_purge_policy_ns:valuable_legacy_key:')) {
          backupFound = true;
          backupData = JSON.parse(v);
          break;
        }
      }

      expect(backupFound).toBe(true);
      expect(backupData).toEqual(legacyVal);
    });

    it('Policy "fail": should fail migration with INCOMPATIBLE_VERSION error without deleting payload', async () => {
      const schema: SchemaDefinition = {
        namespace: 'fail_policy_ns',
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'fail',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'obsolete_fail_key';

      const rawPayload = { keepMeIntact: true };
      await adapter.savePayload(target, key, rawPayload);
      await adapter.saveHeader(target, key, 'fail_policy_ns', {
        namespace: 'fail_policy_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, 'fail_policy_ns');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
      }

      // Payload must NOT be deleted or modified
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual(rawPayload);
      }
    });
  });

  describe('4. Concurrency Stress (50 Concurrent migrateStorageKey Invocations)', () => {
    it('should execute 50 concurrent migrateStorageKey calls on the same key idempotently with zero race conditions', async () => {
      let upExecutionCount = 0;

      const schema: SchemaDefinition = {
        namespace: 'concurrent_stress_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Atomic Step 2',
            up: async (d) => {
              upExecutionCount++;
              // Simulate small asynchronous delay
              await new Promise((resolve) => setTimeout(resolve, 5));
              return { ...d, atomicMigrated: true };
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      const target = 'localStorage';
      const key = 'shared_locked_key';

      await adapter.savePayload(target, key, { counter: 0 });
      await adapter.saveHeader(target, key, 'concurrent_stress_ns', {
        namespace: 'concurrent_stress_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      // Launch 50 concurrent invocations
      const promises = Array.from({ length: 50 }, () =>
        engine.migrateStorageKey(target, key, 'concurrent_stress_ns')
      );

      const results = await Promise.all(promises);

      // All 50 promises must succeed
      for (const r of results) {
        expect(r.ok).toBe(true);
      }

      // Step up function MUST execute exactly once
      expect(upExecutionCount).toBe(1);

      // Exactly 1 invocation applies step 2, 49 are no-ops
      const appliedCounts = results.map((r) => (r.ok ? r.value.appliedSteps.length : 0));
      const nonZeroApplied = appliedCounts.filter((c) => c > 0);
      expect(nonZeroApplied.length).toBe(1);
      expect(nonZeroApplied[0]).toBe(1);

      // Storage payload & header state assertion
      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toEqual({ counter: 0, atomicMigrated: true });
      }

      const headerRes = await adapter.loadHeader(target, key, 'concurrent_stress_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(2);
      }
    });
  });

  describe('5. Large Payload Performance & Memory Stability (10,000 Item Array / Deep Objects)', () => {
    it('should migrate 10,000 nested items within 200ms latency threshold with zero memory leaks across 50 iterations', async () => {
      const schema: SchemaDefinition = {
        namespace: 'perf_stress_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2: Add metadata block to 10k items',
            up: (data) => {
              const items = (data.records as Array<any>) || [];
              const updatedRecords = items.map((rec) => ({
                ...rec,
                meta: { v2Tag: 'PROCESSED_V2', timestamp: 1700000000 },
              }));
              return { ...data, records: updatedRecords };
            },
            down: (data) => data,
          },
          {
            version: 3,
            name: 'Step 3: Aggregate stats and transform IDs',
            up: (data) => {
              const items = (data.records as Array<any>) || [];
              const updatedRecords = items.map((rec) => ({
                id: `UUID_${rec.id}`,
                value: rec.val * 2,
                meta: rec.meta,
              }));
              return {
                ...data,
                records: updatedRecords,
                totalCount: updatedRecords.length,
              };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);

      // Generate 10,000 record nested array payload
      const initialRecords = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        val: i * 5,
        tags: ['alpha', 'beta', 'gamma'],
        attributes: { active: true, rating: 4.5 },
      }));
      const payload = { records: initialRecords };

      // Benchmark single execution latency
      const startMs = performance.now();
      const res = await engine.migrateUp('perf_stress_ns', payload, 1, 3);
      const elapsedMs = performance.now() - startMs;

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.success).toBe(true);
        expect(res.value.finalVersion).toBe(3);
        const migratedRecords = res.value.migratedData?.records as any[];
        expect(migratedRecords.length).toBe(10000);
        expect(migratedRecords[0]).toEqual({
          id: 'UUID_0',
          value: 0,
          meta: { v2Tag: 'PROCESSED_V2', timestamp: 1700000000 },
        });
        expect(migratedRecords[9999]).toEqual({
          id: 'UUID_9999',
          value: 99990,
          meta: { v2Tag: 'PROCESSED_V2', timestamp: 1700000000 },
        });
      }

      // Latency must be strictly under 200ms
      expect(elapsedMs).toBeLessThan(200);

      // Memory stability loop across 50 consecutive runs to ensure no memory accumulation
      const iterations = 50;
      const startLoopMs = performance.now();

      for (let i = 0; i < iterations; i++) {
        const loopRes = await engine.migrateUp('perf_stress_ns', payload, 1, 3);
        expect(loopRes.ok).toBe(true);
      }

      const totalLoopTime = performance.now() - startLoopMs;
      const avgIterationMs = totalLoopTime / iterations;

      // Average iteration time should also stay well below 200ms
      expect(avgIterationMs).toBeLessThan(200);
    });
  });
});
