import { describe, it, expect, beforeEach } from 'vitest';
import { StorageSchemaMigrationEngine } from '../utils/storageSchemaMigrationEngine';
import {
  StorageSchemaMigrationAdapter,
  computeChecksum,
} from '../src/infrastructure/adapters/storageSchemaMigrationAdapter';
import {
  SchemaDefinition,
  SchemaVersionHeader,
} from '../src/domain/model/storageSchemaMigration';
import { StorageTarget } from '../src/domain/model/valueObjects';

describe('Challenger 2: Storage Schema Migration Engine - Tampering, Rollback & Adapter Persistence', () => {
  let adapter: StorageSchemaMigrationAdapter;
  let engine: StorageSchemaMigrationEngine;

  beforeEach(() => {
    adapter = new StorageSchemaMigrationAdapter();
    engine = new StorageSchemaMigrationEngine(adapter);
  });

  describe('Adversarial Category 1: Corrupted & Malformed Schema Header Strings', () => {
    it('challenger_tamper_01: malformed non-JSON header raw string returns CHECKSUM_MISMATCH on loadHeader', async () => {
      const target: StorageTarget = 'localStorage';
      const key = 'user_data';
      const namespace = 'auth_ns';
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      (adapter as any).setRaw(target, headerKey, 'CORRUPTED_{"invalid_json": true');

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('CHECKSUM_MISMATCH');
        expect(res.error.message).toContain('Malformed JSON schema header');
      }
    });

    it('challenger_tamper_02: non-object JSON header (e.g. JSON array) returns INVALID_SCHEMA_VERSION', async () => {
      const target: StorageTarget = 'sessionStorage';
      const key = 'session_key';
      const namespace = 'auth_ns';
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      (adapter as any).setRaw(target, headerKey, JSON.stringify(['version', 1, 'namespace', 'auth_ns']));

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }
    });

    it('challenger_tamper_03: header missing version or namespace field returns INVALID_SCHEMA_VERSION', async () => {
      const target: StorageTarget = 'indexedDB';
      const key = 'idb_key';
      const namespace = 'store_ns';
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      (adapter as any).setRaw(
        target,
        headerKey,
        JSON.stringify({ namespace: 'store_ns', updatedAt: Date.now() })
      );

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }
    });

    it('challenger_tamper_04: header with string version returns INVALID_SCHEMA_VERSION', async () => {
      const target: StorageTarget = 'cookie';
      const key = 'cookie_key';
      const namespace = 'cookie_ns';
      const headerKey = `__schema_meta__:${namespace}:${key}`;

      (adapter as any).setRaw(
        target,
        headerKey,
        JSON.stringify({ namespace: 'cookie_ns', version: '2.0.0', updatedAt: Date.now() })
      );

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SCHEMA_VERSION');
      }
    });
  });

  describe('Adversarial Category 2: Checksum Mismatch Detection', () => {
    it('challenger_checksum_01: direct header checksum mismatch returns CHECKSUM_MISMATCH', async () => {
      const target: StorageTarget = 'localStorage';
      const key = 'account_settings';
      const namespace = 'settings_ns';

      const validChecksum = computeChecksum(namespace, key, 2);
      const invalidChecksum = 'f' + validChecksum.slice(1);

      const header: SchemaVersionHeader = {
        namespace,
        version: 2,
        updatedAt: Date.now(),
        checksum: invalidChecksum,
        appliedMigrations: [1, 2],
      };

      const headerKey = `__schema_meta__:${namespace}:${key}`;
      (adapter as any).setRaw(target, headerKey, JSON.stringify(header));

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('CHECKSUM_MISMATCH');
        expect(res.error.version).toBe(2);
      }
    });

    it('challenger_checksum_02: tampered version in header without checksum update fails checksum validation', async () => {
      const target: StorageTarget = 'localStorage';
      const key = 'profile_data';
      const namespace = 'user_ns';

      const originalChecksum = computeChecksum(namespace, key, 1);

      const headerKey = `__schema_meta__:${namespace}:${key}`;
      (adapter as any).setRaw(
        target,
        headerKey,
        JSON.stringify({
          namespace,
          version: 999,
          updatedAt: Date.now(),
          checksum: originalChecksum,
          appliedMigrations: [1],
        })
      );

      const res = await adapter.loadHeader(target, key, namespace);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('CHECKSUM_MISMATCH');
      }
    });

    it('challenger_checksum_03: migrateStorageKey auto-purges storage when checksum mismatch occurs under purge strategy', async () => {
      const schema: SchemaDefinition = {
        namespace: 'secure_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [],
      };
      engine.registerSchema(schema);

      const target: StorageTarget = 'localStorage';
      const key = 'tampered_key';
      await adapter.savePayload(target, key, { secret: 'data' });

      const headerKey = `__schema_meta__:secure_ns:${key}`;
      (adapter as any).setRaw(
        target,
        headerKey,
        JSON.stringify({
          namespace: 'secure_ns',
          version: 2,
          updatedAt: Date.now(),
          checksum: 'FORGED_CHECKSUM',
          appliedMigrations: [1, 2],
        })
      );

      const res = await engine.migrateStorageKey(target, key, 'secure_ns');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidated).toBe(true);
        expect(res.value.purged).toBe(true);
      }

      const payload = await adapter.loadPayload(target, key);
      expect(payload.value).toBeNull();
      const header = await adapter.loadHeader(target, key, 'secure_ns');
      expect(header.value).toBeNull();
    });
  });

  describe('Adversarial Category 3: Rollback Failures & Missing Down Step Functions', () => {
    it('challenger_rollback_01: missing down function during up step error recovery returns ROLLBACK_FAILED', async () => {
      const schema: SchemaDefinition = {
        namespace: 'rollback_missing_down',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (no down handler)',
            up: (d) => ({ ...d, step2: true }),
            down: undefined as any,
          },
          {
            version: 3,
            name: 'Step 3 (throws)',
            up: () => {
              throw new Error('Step 3 exploded!');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('rollback_missing_down', { initial: 1 }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.version).toBe(2);
      }
    });

    it('challenger_rollback_02: down function throwing error during rollback returns ROLLBACK_FAILED with cause', async () => {
      const schema: SchemaDefinition = {
        namespace: 'rollback_down_throws',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (failing down)',
            up: (d) => ({ ...d, v2: true }),
            down: () => {
              throw new Error('Down handler crashed');
            },
          },
          {
            version: 3,
            name: 'Step 3 (failing up)',
            up: () => {
              throw new Error('Up handler crashed');
            },
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('rollback_down_throws', { data: 'test' }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('ROLLBACK_FAILED');
        expect(res.error.version).toBe(2);
        expect(res.error.message).toContain('Rollback failed at version 2');
      }
    });

    it('challenger_rollback_03: migrateDown with missing down function returns MISSING_MIGRATION_STEP', async () => {
      const schema: SchemaDefinition = {
        namespace: 'down_missing_step',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 2,
            name: 'Step 2 (null down)',
            up: (d) => d,
            down: null as any,
          },
          {
            version: 3,
            name: 'Step 3',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateDown('down_missing_step', { v: 3 }, 3, 1);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(2);
      }
    });
  });

  describe('Adversarial Category 4: Missing Intermediate Migration Version Steps', () => {
    it('challenger_missing_step_01: gap v1 to v3 missing v2 in migrateUp returns MISSING_MIGRATION_STEP', async () => {
      const schema: SchemaDefinition = {
        namespace: 'gap_v2_ns',
        currentVersion: 3,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          {
            version: 3,
            name: 'Step 3',
            up: (d) => ({ ...d, v3: true }),
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('gap_v2_ns', { start: true }, 1, 3);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(2);
      }
    });

    it('challenger_missing_step_02: multi-version gap v1 to v5 missing v3 and v4 returns MISSING_MIGRATION_STEP for earliest missing version', async () => {
      const schema: SchemaDefinition = {
        namespace: 'multi_gap_ns',
        currentVersion: 5,
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
            version: 5,
            name: 'Step 5',
            up: (d) => d,
            down: (d) => d,
          },
        ],
      };

      engine.registerSchema(schema);
      const res = await engine.migrateUp('multi_gap_ns', { start: true }, 1, 5);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(3);
      }
    });

    it('challenger_missing_step_03: validateSchemaChain flags missing step in chain', async () => {
      const schema: SchemaDefinition = {
        namespace: 'chain_gap_ns',
        currentVersion: 4,
        minSupportedVersion: 1,
        invalidationStrategy: 'purge',
        migrations: [
          { version: 2, name: 'Step 2', up: (d) => d, down: (d) => d },
          { version: 4, name: 'Step 4', up: (d) => d, down: (d) => d },
        ],
      };

      engine.registerSchema(schema);
      const res = engine.validateSchemaChain('chain_gap_ns');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MISSING_MIGRATION_STEP');
        expect(res.error.version).toBe(3);
      }
    });
  });

  describe('Adversarial Category 5: Multi-Storage Target Adapter Persistence', () => {
    const targets: StorageTarget[] = [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'cookie',
      'cacheAPI',
      'opfs',
    ];

    it('challenger_adapter_01: header and payload persistence works across all 6 storage targets', async () => {
      for (const target of targets) {
        const key = `key_${target}`;
        const namespace = 'multi_ns';
        const payload = { targetName: target, count: 42 };

        const savePayRes = await adapter.savePayload(target, key, payload);
        expect(savePayRes.ok).toBe(true);

        const header: SchemaVersionHeader = {
          namespace,
          version: 2,
          updatedAt: Date.now(),
          appliedMigrations: [1, 2],
        };
        const saveHeadRes = await adapter.saveHeader(target, key, namespace, header);
        expect(saveHeadRes.ok).toBe(true);

        const loadPayRes = await adapter.loadPayload(target, key);
        expect(loadPayRes.ok).toBe(true);
        if (loadPayRes.ok) {
          expect(loadPayRes.value).toEqual(payload);
        }

        const loadHeadRes = await adapter.loadHeader(target, key, namespace);
        expect(loadHeadRes.ok).toBe(true);
        if (loadHeadRes.ok) {
          expect(loadHeadRes.value?.version).toBe(2);
          expect(loadHeadRes.value?.namespace).toBe(namespace);
          expect(loadHeadRes.value?.checksum).toBe(computeChecksum(namespace, key, 2));
        }

        const delPayRes = await adapter.deletePayload(target, key);
        expect(delPayRes.ok).toBe(true);

        const delHeadRes = await adapter.deleteHeader(target, key, namespace);
        expect(delHeadRes.ok).toBe(true);

        const clearedPay = await adapter.loadPayload(target, key);
        expect(clearedPay.value).toBeNull();
        const clearedHead = await adapter.loadHeader(target, key, namespace);
        expect(clearedHead.value).toBeNull();
      }
    });

    it('challenger_adapter_02: backupPayload creates timestamped backup key across all 6 storage targets', async () => {
      for (const target of targets) {
        const key = `backup_test_${target}`;
        const namespace = 'backup_ns';
        const payload = { status: 'obsolete', target };

        const backupRes = await adapter.backupPayload(target, key, namespace, payload);
        expect(backupRes.ok).toBe(true);
        if (backupRes.ok) {
          expect(backupRes.value).toContain(`__backup__:${namespace}:${key}:`);
          const backupKey = backupRes.value;

          const loadedBackup = await adapter.loadPayload(target, backupKey);
          expect(loadedBackup.ok).toBe(true);
          if (loadedBackup.ok) {
            expect(loadedBackup.value).toEqual(payload);
          }
        }
      }
    });

    it('challenger_adapter_03: storage target stores are completely isolated from each other', async () => {
      const key = 'shared_key_name';

      await adapter.savePayload('localStorage', key, { store: 'local' });
      await adapter.savePayload('sessionStorage', key, { store: 'session' });
      await adapter.savePayload('indexedDB', key, { store: 'idb' });

      const localVal = await adapter.loadPayload('localStorage', key);
      const sessionVal = await adapter.loadPayload('sessionStorage', key);
      const idbVal = await adapter.loadPayload('indexedDB', key);

      expect(localVal.value).toEqual({ store: 'local' });
      expect(sessionVal.value).toEqual({ store: 'session' });
      expect(idbVal.value).toEqual({ store: 'idb' });
    });
  });
});
