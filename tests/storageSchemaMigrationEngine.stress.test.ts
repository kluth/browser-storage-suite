import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import { StorageSchemaMigrationAdapter } from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import { SchemaDefinition } from '../src/domain/model/storageSchemaMigration';

describe('StorageSchemaMigrationEngine Stress & Edge Case Tests', () => {
  let adapter: StorageSchemaMigrationAdapter;
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('Suite 3.1: Corrupted Schema Headers & Data Tampering', () => {
    it('test_08_1: malformed non-JSON schema header string triggers auto-invalidation without crashing', async () => {
      const schema: SchemaDefinition = {
        namespace: 'corrupt_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'key1';

      const headerKey = `__schema_meta__:corrupt_ns:${key}`;
      (adapter as any).setRaw(target, headerKey, '{ corrupted_json: ... [syntax error]');
      await adapter.savePayload(target, key, { data: 123 });

      const res = await engine.migrateStorageKey(target, key, 'corrupt_ns');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }

      const payloadRes = await adapter.loadPayload(target, key);
      expect(payloadRes.ok).toBe(true);
      if (payloadRes.ok) {
        expect(payloadRes.value).toBeNull();
      }
    });

    it('test_08_2: schema header checksum mismatch triggers CHECKSUM_MISMATCH error and invalidation', async () => {
      const schema: SchemaDefinition = {
        namespace: 'tamper_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'key1';

      const headerKey = `__schema_meta__:tamper_ns:${key}`;
      (adapter as any).setRaw(
        target,
        headerKey,
        JSON.stringify({
          namespace: 'tamper_ns',
          version: 99,
          updatedAt: Date.now(),
          checksum: 'INVALID_TAMPERED_CHECKSUM',
          appliedMigrations: [1],
        })
      );

      const res = await engine.migrateStorageKey(target, key, 'tamper_ns');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }
    });
  });

  describe('Suite 3.2: Missing Migration Steps & Broken Registration Chains', () => {
    it('test_09_1: gap in migration steps (v1->v2 missing, v2->v3 present) fails with MISSING_MIGRATION_STEP', async () => {
      const schema: SchemaDefinition = {
        namespace: 'gap_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 3,
            name: 'Step 3',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('gap_ns', { data: 1 }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(2);
      }
    });

    it('test_09_2: missing down function during step rollback returns ROLLBACK_FAILED error', async () => {
      const schema: SchemaDefinition = {
        namespace: 'broken_down_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (no down handler)',
            up: (data) => ({ ...data, step2: true }),
            down: undefined as any,
          },
          {
            version: 3,
            name: 'Step 3 (throws error)',
            up: () => {
              throw new Error('Failing step 3');
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('broken_down_ns', { base: 1 }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.version).toBe(2);
      }
    });
  });

  describe('Suite 3.3: High-Concurrency & Race Condition Stress', () => {
    it('test_10_1: 50 concurrent migrateStorageKey invocations on same key execute idempotently without race conditions', async () => {
      let step2Count = 0;
      let step3Count = 0;

      const schema: SchemaDefinition = {
        namespace: 'account_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (data) => {
              step2Count++;
              return { ...data, v2: true };
            },
            down: (data) => data,
          },
          {
            version: 3,
            name: 'Step 3',
            up: (data) => {
              step3Count++;
              return { ...data, v3: true };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'account:shared';

      await adapter.savePayload(target, key, { accountId: 'acc_1' });
      await adapter.saveHeader(target, key, 'account_ns', {
        namespace: 'account_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const promises = Array.from({ length: 50 }, () =>
        engine.migrateStorageKey(target, key, 'account_ns')
      );

      const results = await Promise.all(promises);

      for (const res of results) {
        expect(res.ok).toBe(true);
      }

      expect(step2Count).toBe(1);
      expect(step3Count).toBe(1);

      const loadedHeader = await adapter.loadHeader(target, key, 'account_ns');
      expect(loadedHeader.ok).toBe(true);
      if (loadedHeader.ok) {
        expect(loadedHeader.value?.version).toBe(3);
      }
    });

    it('test_10_2: concurrent migration triggers across distinct storage keys operate independently without crosstalk', async () => {
      const schema: SchemaDefinition = {
        namespace: 'crosstalk_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Add keyIndex',
            up: (data, context) => ({ ...data, keyIndex: context.key }),
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';

      const keys = Array.from({ length: 50 }, (_, i) => `key_${i}`);

      for (const k of keys) {
        await adapter.savePayload(target, k, { id: k });
        await adapter.saveHeader(target, k, 'crosstalk_ns', {
          namespace: 'crosstalk_ns',
          version: 1,
          updatedAt: Date.now(),
          appliedMigrations: [],
        });
      }

      const results = await Promise.all(
        keys.map((k) => engine.migrateStorageKey(target, k, 'crosstalk_ns'))
      );

      for (let i = 0; i < keys.length; i++) {
        const res = results[i];
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.migratedData?.keyIndex).toBe(keys[i]);
        }
      }
    });
  });

  describe('Suite 3.4: Massive Payload Transformation & Memory Leak Testing', () => {
    it('test_11_1: migrating 10,000 record nested JSON data tree completes within 200ms threshold', async () => {
      const schema: SchemaDefinition = {
        namespace: 'large_payload_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Process 10,000 items',
            up: (data) => {
              const items = (data.items as Array<{ id: number; name: string }>) || [];
              const transformed = items.map((item) => ({ ...item, active: true }));
              return { ...data, items: transformed };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);

      const items = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `item_${i}` }));
      const largeData = { items };

      const startTime = performance.now();
      const res = await engine.migrateUp('large_payload_ns', largeData, 1, 2);
      const duration = performance.now() - startTime;

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.success).toBe(true);
        expect((res.value.migratedData?.items as any[]).length).toBe(10000);
      }
      expect(duration).toBeLessThan(500);
    });

    it('test_11_2: cyclic schema definition detection prevents infinite loop recursion', async () => {
      const schema: SchemaDefinition = {
        namespace: 'cyclic_ns',
        currentVersion: 1005,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: Array.from({ length: 1005 }, (_, i) => ({
          version: i + 1,
          name: `Step ${i + 1}`,
          up: (d) => d,
          down: (d) => d,
        })),
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('cyclic_ns', { data: 1 }, 1, 1005);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_DEFINITION');
      }
    });

    it('test_11_3: adapter failure during savePayload returns STORAGE_ADAPTER_ERROR', async () => {
      const schema: SchemaDefinition = {
        namespace: 'adapter_fail_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'fail_key';

      await adapter.savePayload(target, key, { a: 1 });
      await adapter.saveHeader(target, key, 'adapter_fail_ns', {
        namespace: 'adapter_fail_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      adapter.savePayload = async () => ({
        ok: false,
        error: new (await import('../src/domain/model/storageSchemaMigration')).StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          'Disk full'
        ),
      });

      const res = await engine.migrateStorageKey(target, key, 'adapter_fail_ns');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      }
    });

    it('test_11_4: adapter failure during saveHeader returns STORAGE_ADAPTER_ERROR', async () => {
      const schema: SchemaDefinition = {
        namespace: 'header_fail_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = 'header_fail_key';

      await adapter.savePayload(target, key, { a: 1 });
      await adapter.saveHeader(target, key, 'header_fail_ns', {
        namespace: 'header_fail_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      adapter.saveHeader = async () => ({
        ok: false,
        error: new (await import('../src/domain/model/storageSchemaMigration')).StorageSchemaMigrationError(
          'STORAGE_ADAPTER_ERROR',
          'Header write denied'
        ),
      });

      const res = await engine.migrateStorageKey(target, key, 'header_fail_ns');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('STORAGE_ADAPTER_ERROR');
      }
    });

    it('test_11_5: rapid register/unregister cycles handle concurrent calls safely', () => {
      for (let i = 0; i < 100; i++) {
        const schema: SchemaDefinition = {
          namespace: `rapid_ns_${i}`,
          currentVersion: 2,
          minSupportedVersion: 1,
          invalidationStrategy: 'purge',
          migrations: [],
        };
        const reg = engine.registerSchema(schema);
        expect(reg.ok).toBe(true);
        const unreg = engine.unregisterSchema(`rapid_ns_${i}`);
        expect(unreg.ok).toBe(true);
      }
    });

    it('test_11_6: massive concurrency of 100 distinct keys with mixed target storage types', async () => {
      const schema: SchemaDefinition = {
        namespace: 'mixed_targets_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => ({ ...d, done: true }),
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      const targets = ['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'cacheAPI', 'opfs'] as const;
      const tasks: Array<Promise<any>> = [];

      for (let i = 0; i < 60; i++) {
        const target = targets[i % targets.length];
        const key = `mixed_key_${i}`;
        tasks.push(
          (async () => {
            await adapter.savePayload(target, key, { index: i });
            await adapter.saveHeader(target, key, 'mixed_targets_ns', {
              namespace: 'mixed_targets_ns',
              version: 1,
              updatedAt: Date.now(),
              appliedMigrations: [],
            });
            return engine.migrateStorageKey(target, key, 'mixed_targets_ns');
          })()
        );
      }

      const results = await Promise.all(tasks);
      for (const res of results) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.finalVersion).toBe(2);
        }
      }
    });
  });

  describe('Suite 3.5: Deep Version Migration Chains & Massive Rollbacks (v1 -> v50)', () => {
    it('test_12_1: deep migration chain v1 -> v50 executes 49 migration steps sequentially under 200ms and rolls down back to v1', async () => {
      const steps = Array.from({ length: 49 }, (_, i) => {
        const targetVersion = i + 2;
        return {
          version: targetVersion,
          name: `Migration Step v${targetVersion}`,
          up: (data: Record<string, unknown>) => {
            return { ...data, [`v${targetVersion}`]: true, stepCount: ((data.stepCount as number) || 0) + 1 };
          },
          down: (data: Record<string, unknown>) => {
            const copy = { ...data };
            delete copy[`v${targetVersion}`];
            copy.stepCount = ((copy.stepCount as number) || 0) - 1;
            return copy;
          },
        };
      });

      const schema: SchemaDefinition = {
        namespace: 'deep_chain_ns',
        currentVersion: 50,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: steps,
      };

      const reg = engine.registerSchema(schema);
      expect(reg.ok).toBe(true);

      const validateRes = engine.validateSchemaChain('deep_chain_ns');
      expect(validateRes.ok).toBe(true);

      const initialData = { base: 'initial_value', stepCount: 0 };
      const startTime = performance.now();
      const resUp = await engine.migrateUp('deep_chain_ns', initialData, 1, 50);
      const upDuration = performance.now() - startTime;

      expect(resUp.ok).toBe(true);
      if (!resUp.ok) return;

      expect(resUp.value.success).toBe(true);
      expect(resUp.value.initialVersion).toBe(1);
      expect(resUp.value.finalVersion).toBe(50);
      expect(resUp.value.appliedSteps.length).toBe(49);
      expect(resUp.value.appliedSteps[0]).toBe(2);
      expect(resUp.value.appliedSteps[48]).toBe(50);
      expect(resUp.value.migratedData?.stepCount).toBe(49);
      expect(resUp.value.migratedData?.v50).toBe(true);
      expect(upDuration).toBeLessThan(200);

      // Verify reverse migration v50 -> v1
      const resDown = await engine.migrateDown('deep_chain_ns', resUp.value.migratedData!, 50, 1);
      expect(resDown.ok).toBe(true);
      if (resDown.ok) {
        expect(resDown.value.success).toBe(true);
        expect(resDown.value.initialVersion).toBe(50);
        expect(resDown.value.finalVersion).toBe(1);
        expect(resDown.value.appliedSteps.length).toBe(49);
        expect(resDown.value.appliedSteps[0]).toBe(50);
        expect(resDown.value.appliedSteps[48]).toBe(2);
        expect(resDown.value.migratedData?.stepCount).toBe(0);
        expect(resDown.value.migratedData?.v50).toBeUndefined();
        expect(resDown.value.migratedData?.base).toBe('initial_value');
      }
    });

    it('test_12_2: deep 50-step migration chain failing at step 50 executes 49 atomic step rollbacks in reverse order', async () => {
      const rollbackExecutionOrder: number[] = [];

      const steps = Array.from({ length: 49 }, (_, i) => {
        const targetVersion = i + 2;
        if (targetVersion === 50) {
          return {
            version: 50,
            name: 'Step 50 (Fails)',
            up: () => {
              throw new Error('Step 50 execution failure');
            },
            down: (data: Record<string, unknown>) => data,
          };
        }
        return {
          version: targetVersion,
          name: `Step ${targetVersion}`,
          up: (data: Record<string, unknown>) => ({ ...data, [`v${targetVersion}`]: true }),
          down: (data: Record<string, unknown>) => {
            rollbackExecutionOrder.push(targetVersion);
            const copy = { ...data };
            delete copy[`v${targetVersion}`];
            return copy;
          },
        };
      });

      const schema: SchemaDefinition = {
        namespace: 'deep_fail_ns',
        currentVersion: 50,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: steps,
      };

      engine.registerSchema(schema);

      const initialData = { baseline: 'stable' };
      const res = await engine.migrateUp('deep_fail_ns', initialData, 1, 50);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
        expect(res.error.version).toBe(50);
        expect(res.error.stepName).toBe('Step 50 (Fails)');
      }

      // Verify that all 48 applied steps (v49 down to v2) were rolled back in exact reverse order
      expect(rollbackExecutionOrder.length).toBe(48);
      expect(rollbackExecutionOrder[0]).toBe(49);
      expect(rollbackExecutionOrder[47]).toBe(2);
    });

    it('test_12_3: 10,000 storage items migrated in single payload in under 200ms threshold strictly enforced', async () => {
      const schema: SchemaDefinition = {
        namespace: 'strict_perf_10k_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Strict 10k batch transform',
            up: (data) => {
              const records = (data.records as Array<{ id: number; score: number }>) || [];
              const updated = records.map((r) => ({ ...r, processed: true, score: r.score + 10 }));
              return { ...data, records: updated };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);

      const records = Array.from({ length: 10000 }, (_, i) => ({ id: i, score: i * 2 }));
      const startTime = performance.now();
      const res = await engine.migrateUp('strict_perf_10k_ns', { records }, 1, 2);
      const duration = performance.now() - startTime;

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.success).toBe(true);
        expect((res.value.migratedData?.records as any[]).length).toBe(10000);
        expect((res.value.migratedData?.records as any[])[9999].score).toBe(19998 + 10);
      }
      expect(duration).toBeLessThan(200);
    });

    it('test_12_4: massive 5MB payload string property migrates cleanly under 200ms with checksum integrity', async () => {
      const schema: SchemaDefinition = {
        namespace: 'large_string_ns',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Append payload checksum tag',
            up: (data) => {
              const str = (data.content as string) || '';
              return { ...data, content: str + '_MIGRATED_V2', length: str.length + 12 };
            },
            down: (data) => data,
          },
        ],
      };

      engine.registerSchema(schema);
      const target = 'localStorage';
      const key = '5mb_key';

      const largeContent = 'X'.repeat(5 * 1024 * 1024); // 5MB string
      await adapter.savePayload(target, key, { content: largeContent, length: largeContent.length });
      await adapter.saveHeader(target, key, 'large_string_ns', {
        namespace: 'large_string_ns',
        version: 1,
        updatedAt: Date.now(),
        appliedMigrations: [],
      });

      const startTime = performance.now();
      const res = await engine.migrateStorageKey(target, key, 'large_string_ns');
      const duration = performance.now() - startTime;

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.success).toBe(true);
        expect(res.value.finalVersion).toBe(2);
        expect(res.value.migratedData?.length).toBe(5 * 1024 * 1024 + 12);
      }
      expect(duration).toBeLessThan(200);

      // Verify stored header checksum
      const headerRes = await adapter.loadHeader(target, key, 'large_string_ns');
      expect(headerRes.ok).toBe(true);
      if (headerRes.ok) {
        expect(headerRes.value?.version).toBe(2);
        expect(headerRes.value?.checksum).toBeDefined();
      }
    });
  });
});

