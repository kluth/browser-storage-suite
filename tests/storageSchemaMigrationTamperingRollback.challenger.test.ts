import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import {
  SchemaDefinition,
  StorageSchemaMigrationError,
  SchemaVersionHeader,
} from '../src/domain/model/storageSchemaMigration';
import {
  StorageSchemaMigrationAdapter,
  computeChecksum,
} from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import { StorageTarget } from '../src/domain/model/valueObjects';

describe('Adversarial Challenger: Tampering, Rollback & Invalidation Engine', () => {
  let engine: StorageSchemaMigrationEngine;
  let adapter: StorageSchemaMigrationAdapter;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('1. Schema Header Tampering & Checksum Mismatch Recovery', () => {
    const namespace = 'tamper_test';
    const key = 'user_data';
    const target: StorageTarget = 'localStorage';

    beforeEach(() => {
      engine.registerSchema({
        namespace,
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v2 upgrade',
            up: (d) => ({ ...d, v: 2 }),
            down: (d) => ({ ...d, v: 1 }),
          },
          {
            version: 3,
            name: 'v3 upgrade',
            up: (d) => ({ ...d, v: 3 }),
            down: (d) => ({ ...d, v: 2 }),
          },
        ],
      });
    });

    it('detects checksum mismatch when checksum in header is altered', async () => {
      await adapter.savePayload(target, key, { name: 'Alice' });

      // Save a header with bad checksum
      const badHeader: SchemaVersionHeader = {
        namespace,
        version: 1,
        updatedAt: Date.now(),
        checksum: 'DEADBEEF_TAMPERED_CHECKSUM',
        appliedMigrations: [],
      };
      await adapter.saveHeader(target, key, namespace, badHeader);

      // Verify direct loadHeader returns CHECKSUM_MISMATCH error
      const loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('CHECKSUM_MISMATCH');
        expect(loadRes.error.message).toContain('Checksum mismatch for header of key');
        expect(loadRes.error.version).toBe(1);
      }

      // Verify migrateStorageKey handles checksum mismatch by invalidating and purging (strategy: purge)
      const migRes = await engine.migrateStorageKey(target, key, namespace);
      expect(migRes.ok).toBe(true);
      if (migRes.ok) {
        expect(migRes.value.invalidated).toBe(true);
        expect(migRes.value.purged).toBe(true);
        expect(migRes.value.finalVersion).toBe(3);
      }

      // Verify header and payload were removed from storage
      const postHeader = await adapter.loadHeader(target, key, namespace);
      expect(postHeader.ok).toBe(true);
      if (postHeader.ok) {
        expect(postHeader.value).toBeNull();
      }
      const postPayload = await adapter.loadPayload(target, key);
      expect(postPayload.ok).toBe(true);
      if (postPayload.ok) {
        expect(postPayload.value).toBeNull();
      }
    });

    it('recovers with reset-default strategy on checksum tampering', async () => {
      engine.registerSchema({
        namespace: 'tamper_reset',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'reset-default',
        defaultValue: { role: 'guest', active: true },
        migrations: [
          {
            version: 2,
            name: 'v2 upgrade',
            up: (d) => ({ ...d, v: 2 }),
            down: (d) => ({ ...d, v: 1 }),
          },
        ],
      });

      await adapter.savePayload(target, key, { role: 'admin', active: false });
      const badHeader: SchemaVersionHeader = {
        namespace: 'tamper_reset',
        version: 1,
        updatedAt: Date.now(),
        checksum: 'INVALID_HASH',
        appliedMigrations: [],
      };
      await adapter.saveHeader(target, key, 'tamper_reset', badHeader);

      const migRes = await engine.migrateStorageKey(target, key, 'tamper_reset');
      expect(migRes.ok).toBe(true);
      if (migRes.ok) {
        expect(migRes.value.invalidated).toBe(true);
        expect(migRes.value.purged).toBe(false);
        expect(migRes.value.migratedData).toEqual({ role: 'guest', active: true });
        expect(migRes.value.finalVersion).toBe(2);
      }

      // Verify payload in storage is now defaultValue
      const savedPayload = await adapter.loadPayload(target, key);
      expect(savedPayload.ok).toBe(true);
      if (savedPayload.ok) {
        expect(savedPayload.value).toEqual({ role: 'guest', active: true });
      }

      // Verify header was reset with correct checksum for v2
      const savedHeader = await adapter.loadHeader(target, key, 'tamper_reset');
      expect(savedHeader.ok).toBe(true);
      if (savedHeader.ok && savedHeader.value) {
        expect(savedHeader.value.version).toBe(2);
        expect(savedHeader.value.checksum).toBe(computeChecksum('tamper_reset', key, 2));
      }
    });

    it('recovers with backup-and-purge strategy on checksum tampering', async () => {
      engine.registerSchema({
        namespace: 'tamper_backup',
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'backup-and-purge',
        migrations: [
          {
            version: 2,
            name: 'v2 upgrade',
            up: (d) => ({ ...d, v: 2 }),
            down: (d) => ({ ...d, v: 1 }),
          },
        ],
      });

      const originalData = { secret: 'top_secret_data' };
      await adapter.savePayload(target, key, originalData);
      const badHeader: SchemaVersionHeader = {
        namespace: 'tamper_backup',
        version: 1,
        updatedAt: Date.now(),
        checksum: 'BAD_CHECKSUM',
        appliedMigrations: [],
      };
      await adapter.saveHeader(target, key, 'tamper_backup', badHeader);

      const migRes = await engine.migrateStorageKey(target, key, 'tamper_backup');
      expect(migRes.ok).toBe(true);
      if (migRes.ok) {
        expect(migRes.value.invalidated).toBe(true);
        expect(migRes.value.purged).toBe(true);
      }

      // Original payload and header are purged
      const savedPayload = await adapter.loadPayload(target, key);
      expect(savedPayload.ok).toBe(true);
      if (savedPayload.ok) {
        expect(savedPayload.value).toBeNull();
      }

      // Backup was created
      const store = (adapter as any).getStore(target);
      let backupFound = false;
      for (const k of store.keys()) {
        if (k.startsWith('__backup__:tamper_backup:user_data:')) {
          backupFound = true;
          expect(JSON.parse(store.get(k))).toEqual(originalData);
        }
      }
      expect(backupFound).toBe(true);
    });

    it('handles malformed JSON in schema header string', async () => {
      // Write raw garbage string into header location
      const headerKey = `__schema_meta__:${namespace}:${key}`;
      (adapter as any).setRaw(target, headerKey, '{ bad json header :::');

      const loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('CHECKSUM_MISMATCH');
        expect(loadRes.error.message).toContain("Malformed JSON schema header for key 'user_data'");
      }

      // Running migrateStorageKey purges the corrupt key
      const migRes = await engine.migrateStorageKey(target, key, namespace);
      expect(migRes.ok).toBe(true);
      if (migRes.ok) {
        expect(migRes.value.invalidated).toBe(true);
        expect(migRes.value.purged).toBe(true);
      }
    });

    it('handles non-object header JSON payload (primitive / array)', async () => {
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      // Test string payload
      (adapter as any).setRaw(target, headerKey, JSON.stringify("just a string"));
      let loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }

      // Test array payload
      (adapter as any).setRaw(target, headerKey, JSON.stringify([1, 2, 3]));
      loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }
    });

    it('handles header missing version or namespace properties', async () => {
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      // Missing version
      (adapter as any).setRaw(target, headerKey, JSON.stringify({ namespace: 'tamper_test' }));
      let loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('INVALID_SCHEMA_VERSION');
        expect(loadRes.error.message).toContain('missing required version or namespace');
      }

      // Missing namespace
      (adapter as any).setRaw(target, headerKey, JSON.stringify({ version: 1 }));
      loadRes = await adapter.loadHeader(target, key, namespace);
      expect(loadRes.ok).toBe(false);
      if (!loadRes.ok) {
        expect(loadRes.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }
    });
  });

  describe('2. Missing `down` Functions & Atomic Rollback Failure', () => {
    const namespace = 'rollback_test';

    it('fails with ROLLBACK_FAILED when forward migration step 3 throws and step 2 is missing down function', async () => {
      const schema: SchemaDefinition = {
        namespace,
        currentVersion: 4,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (valid up and down)',
            up: (d) => ({ ...d, step2: true }),
            down: (d) => {
              const { step2, ...rest } = d;
              return rest;
            },
          },
          {
            version: 3,
            name: 'Step 3 (missing down function)',
            up: (d) => ({ ...d, step3: true }),
            down: undefined as any, // Missing down function!
          },
          {
            version: 4,
            name: 'Step 4 (up throws error)',
            up: () => {
              throw new Error('Fatal database migration failure in step 4!');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      const rawData = { initial: 'value' };

      // Running migrateUp from v1 to v4:
      // Step 2 up succeeds (appliedSteps: [2])
      // Step 3 up succeeds (appliedSteps: [2, 3])
      // Step 4 up fails! Rollback begins in reverse: [3, 2]
      // Rollback step 3: missing down function! -> returns ROLLBACK_FAILED
      const res = await engine.migrateUp(namespace, rawData, 1, 4);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.message).toContain('Missing down function for rollback at version 3');
        expect(res.error.version).toBe(3);
        expect(res.error.stepName).toBe('Step 3 (missing down function)');
      }
    });

    it('fails with ROLLBACK_FAILED when down function throws exception during rollback', async () => {
      const schema: SchemaDefinition = {
        namespace: 'down_throws',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (down throws error)',
            up: (d) => ({ ...d, step2: true }),
            down: () => {
              throw new Error('Down migration crash!');
            },
          },
          {
            version: 3,
            name: 'Step 3 (up throws error)',
            up: () => {
              throw new Error('Step 3 up error!');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);

      const res = await engine.migrateUp('down_throws', { init: 1 }, 1, 3);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.message).toContain('Rollback failed at version 2: Down migration crash!');
        expect(res.error.version).toBe(2);
        expect(res.error.stepName).toBe('Step 2 (down throws error)');
      }
    });

    it('returns MISSING_MIGRATION_STEP when migrateDown is called directly and a down function is missing', async () => {
      const schema: SchemaDefinition = {
        namespace: 'down_direct',
        currentVersion: 3,
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
            version: 3,
            name: 'Step 3 (no down)',
            up: (d) => d,
            down: null as any,
          },
        ],
      };

      engine.registerSchema(schema);

      const res = await engine.migrateDown('down_direct', { a: 1 }, 3, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.message).toContain('Missing down migration function for version 3');
        expect(res.error.version).toBe(3);
      }
    });

    it('saves header at original fromVersion with recalculated checksum when MIGRATION_STEP_FAILED occurs in migrateStorageKey', async () => {
      const target: StorageTarget = 'localStorage';
      const key = 'user_account';
      const ns = 'header_restore_test';

      engine.registerSchema({
        namespace: ns,
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (up throws)',
            up: () => {
              throw new Error('Step 2 failure');
            },
            down: (d) => d,
          },
        ],
      });

      // Save initial v1 payload and valid v1 header
      await adapter.savePayload(target, key, { name: 'Bob' });
      await adapter.saveHeader(target, key, ns, {
        namespace: ns,
        version: 1,
        updatedAt: Date.now(),
        checksum: computeChecksum(ns, key, 1),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, ns);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MIGRATION_STEP_FAILED');
      }

      // Verify header in storage was restored to version 1 with valid checksum
      const restoredHeader = await adapter.loadHeader(target, key, ns);
      expect(restoredHeader.ok).toBe(true);
      if (restoredHeader.ok && restoredHeader.value) {
        expect(restoredHeader.value.version).toBe(1);
        expect(restoredHeader.value.checksum).toBe(computeChecksum(ns, key, 1));
      }
    });
  });

  describe('3. Version Gaps & Migration Chain Validation', () => {
    const namespace = 'gap_test';

    beforeEach(() => {
      engine.registerSchema({
        namespace,
        currentVersion: 5,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2',
            up: (d) => ({ ...d, v2: true }),
            down: (d) => d,
          },
          // Missing version 3!
          {
            version: 4,
            name: 'Step 4',
            up: (d) => ({ ...d, v4: true }),
            down: (d) => d,
          },
          {
            version: 5,
            name: 'Step 5',
            up: (d) => ({ ...d, v5: true }),
            down: (d) => d,
          },
        ],
      });
    });

    it('validateSchemaChain identifies missing version 3 in migration chain', () => {
      const res = engine.validateSchemaChain(namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.message).toBe('Missing migration step for version 3');
        expect(res.error.version).toBe(3);
      }
    });

    it('migrateUp fails with MISSING_MIGRATION_STEP when attempting to cross version gap 3', async () => {
      const res = await engine.migrateUp(namespace, { foo: 'bar' }, 1, 5);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.message).toBe('Missing migration step for version 3');
        expect(res.error.version).toBe(3);
      }
    });

    it('migrateStorageKey fails when migrating across version gap', async () => {
      const target: StorageTarget = 'localStorage';
      const key = 'gap_key';

      await adapter.savePayload(target, key, { a: 1 });
      await adapter.saveHeader(target, key, namespace, {
        namespace,
        version: 1,
        updatedAt: Date.now(),
        checksum: computeChecksum(namespace, key, 1),
        appliedMigrations: [],
      });

      const res = await engine.migrateStorageKey(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(3);
      }
    });
  });

  describe('4. Invalidation Strategies & Obsolete Versions', () => {
    it('returns INCOMPATIBLE_VERSION when version is below minSupportedVersion and strategy is fail', async () => {
      const ns = 'fail_strat';
      engine.registerSchema({
        namespace: ns,
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'fail',
        migrations: [],
      });

      const res = await engine.migrateUp(ns, { data: 1 }, 1, 3);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
        expect(res.error.message).toContain('Version 1 is below minimum supported version 2');
        expect(res.error.version).toBe(1);
      }
    });

    it('executes purge strategy when version < minSupportedVersion', async () => {
      const ns = 'purge_strat';
      engine.registerSchema({
        namespace: ns,
        currentVersion: 3,
        minSupportedVersion: 2,
        invalidationStrategy: 'purge',
        migrations: [],
      });

      const res = await engine.migrateUp(ns, { data: 1 }, 1, 3);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
        expect(res.value.finalVersion).toBe(3);
      }
    });

    it('returns INCOMPATIBLE_VERSION when invalidateAndPurge is called with invalidationStrategy fail', async () => {
      const ns = 'invalidate_fail';
      engine.registerSchema({
        namespace: ns,
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'fail',
        migrations: [],
      });

      const res = await engine.invalidateAndPurge('localStorage', 'k1', ns, 'Explicit test reason');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INCOMPATIBLE_VERSION');
        expect(res.error.message).toContain("Invalidated key 'k1' under namespace 'invalidate_fail': Explicit test reason");
      }
    });
  });

  describe('5. Multi-Target Storage Driver Edge Cases & Concurrency', () => {
    it('serializes concurrent migrateStorageKey requests on tampered key without race conditions', async () => {
      const ns = 'concurrent_tamper';
      engine.registerSchema({
        namespace: ns,
        currentVersion: 2,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'v2',
            up: (d) => ({ ...d, v: 2 }),
            down: (d) => ({ ...d, v: 1 }),
          },
        ],
      });

      const target: StorageTarget = 'sessionStorage';
      const key = 'shared_key';

      await adapter.savePayload(target, key, { data: 'test' });
      await adapter.saveHeader(target, key, ns, {
        namespace: ns,
        version: 1,
        updatedAt: Date.now(),
        checksum: 'TAMPERED_CHECKSUM',
        appliedMigrations: [],
      });

      // Launch 5 concurrent migration operations on the same tampered key
      const futures = Array.from({ length: 5 }, () =>
        engine.migrateStorageKey(target, key, ns)
      );

      const results = await Promise.all(futures);

      // All 5 must resolve cleanly (first purges key, subsequent ones see key already purged or null header)
      for (const res of results) {
        expect(res.ok).toBe(true);
      }
    });
  });
});
