import { describe, it, expect, beforeEach } from 'vitest';
import { StorageAclEngine } from '../utils/storageAclEngine';
import { StorageTestHarness } from '../utils/storageTestHarness';
import { MockStoragePort, MockStorageArea } from '../src/domain/ports/secondary/mockStoragePort';
import {
  AclRule,
  AclSubjectContext,
  AclEnvironmentContext,
  AclResourceContext,
  StorageAclError,
} from '../src/domain/model/storageAcl';
import { Result } from '../utils/result';

/**
 * Storage ACL Guard Wrapper intercepting storage operations on MockStoragePort
 */
export class StorageAclGuard {
  constructor(
    private readonly storage: MockStoragePort,
    private readonly engine: StorageAclEngine
  ) {}

  public async setItem(
    area: MockStorageArea,
    key: string,
    value: unknown,
    subject: AclSubjectContext,
    env: AclEnvironmentContext
  ): Promise<Result<void, StorageAclError>> {
    const resource: AclResourceContext = { key };
    const evalRes = await this.engine.evaluateAccess(subject, env, resource, 'WRITE');
    if (!evalRes.ok) return Result.err(evalRes.error);

    if (!evalRes.value.allowed) {
      return Result.err(
        new StorageAclError(
          'ACL_SCOPE_INSUFFICIENT',
          `Write access to key '${key}' denied by ACL: ${evalRes.value.reason}`,
          evalRes.value
        )
      );
    }

    const setRes = await this.storage.setItem(area, key, value);
    if (!setRes.ok) {
      return Result.err(
        new StorageAclError('REPOSITORY_ERROR', `Storage setItem failed: ${setRes.error.message}`, setRes.error)
      );
    }
    return Result.ok(undefined);
  }

  public async setItems(
    area: MockStorageArea,
    items: Record<string, unknown>,
    subject: AclSubjectContext,
    env: AclEnvironmentContext
  ): Promise<Result<void, StorageAclError>> {
    // Transaction check: evaluate ACL for ALL keys first
    for (const [key] of Object.entries(items)) {
      const resource: AclResourceContext = { key };
      const evalRes = await this.engine.evaluateAccess(subject, env, resource, 'WRITE');
      if (!evalRes.ok) return Result.err(evalRes.error);

      if (!evalRes.value.allowed) {
        return Result.err(
          new StorageAclError(
            'ACL_KEY_RESTRICTED',
            `Bulk write operation aborted: Key '${key}' access denied by ACL policy`,
            evalRes.value
          )
        );
      }
    }

    // Perform atomic set
    const setRes = await this.storage.setItems(area, items);
    if (!setRes.ok) {
      return Result.err(
        new StorageAclError('REPOSITORY_ERROR', `Storage setItems failed: ${setRes.error.message}`, setRes.error)
      );
    }
    return Result.ok(undefined);
  }

  public async getItem<T>(
    area: MockStorageArea,
    key: string,
    subject: AclSubjectContext,
    env: AclEnvironmentContext
  ): Promise<Result<T | null, StorageAclError>> {
    const resource: AclResourceContext = { key };
    const evalRes = await this.engine.evaluateAccess(subject, env, resource, 'READ');
    if (!evalRes.ok) return Result.err(evalRes.error);

    if (!evalRes.value.allowed) {
      return Result.err(
        new StorageAclError(
          'ACL_SCOPE_INSUFFICIENT',
          `Read access to key '${key}' denied by ACL: ${evalRes.value.reason}`,
          evalRes.value
        )
      );
    }

    const getRes = await this.storage.getItem<T>(area, key);
    if (!getRes.ok) {
      return Result.err(
        new StorageAclError('REPOSITORY_ERROR', `Storage getItem failed: ${getRes.error.message}`, getRes.error)
      );
    }
    return Result.ok(getRes.value);
  }

  public async removeItem(
    area: MockStorageArea,
    key: string,
    subject: AclSubjectContext,
    env: AclEnvironmentContext
  ): Promise<Result<void, StorageAclError>> {
    const resource: AclResourceContext = { key };
    const evalRes = await this.engine.evaluateAccess(subject, env, resource, 'DELETE');
    if (!evalRes.ok) return Result.err(evalRes.error);

    if (!evalRes.value.allowed) {
      return Result.err(
        new StorageAclError(
          'ACL_SCOPE_INSUFFICIENT',
          `Delete access to key '${key}' denied by ACL: ${evalRes.value.reason}`,
          evalRes.value
        )
      );
    }

    const rmRes = await this.storage.removeItem(area, key);
    if (!rmRes.ok) {
      return Result.err(
        new StorageAclError('REPOSITORY_ERROR', `Storage removeItem failed: ${rmRes.error.message}`, rmRes.error)
      );
    }
    return Result.ok(undefined);
  }
}

describe('Storage ACL Interceptor & Storage Harness Integration', () => {
  let harness: StorageTestHarness;
  let engine: StorageAclEngine;
  let guard: StorageAclGuard;

  beforeEach(async () => {
    harness = new StorageTestHarness();
    engine = new StorageAclEngine({ defaultEffect: 'DENY' });
    guard = new StorageAclGuard(harness, engine);

    // Register rules
    const readOnlyRule: AclRule = {
      id: 'rule_read_only',
      name: 'Read Only Rule for Reader Origin',
      subjectOrRole: 'reader_sub',
      originPattern: 'https://read.example.com',
      keyPattern: 'public:*',
      actions: ['READ'],
      effect: 'ALLOW',
    };

    const fullRule: AclRule = {
      id: 'rule_full_user',
      name: 'Full Read/Write User Rule',
      subjectOrRole: 'full_sub',
      originPattern: 'https://app.example.com',
      keyPattern: 'user:*',
      actions: ['READ', 'WRITE', 'DELETE'],
      effect: 'ALLOW',
    };

    await engine.registerRule(readOnlyRule);
    await engine.registerRule(fullRule);
  });

  it('should intercept unauthorized setItem, return error monad, and leave storage UNTOUCHED', async () => {
    const subject: AclSubjectContext = { subjectId: 'reader_sub', roles: [] };
    const env: AclEnvironmentContext = { origin: 'https://read.example.com', timestamp: Date.now() };

    // Attempt unauthorized write
    const writeRes = await guard.setItem('local', 'public:key1', 'val1', subject, env);
    expect(writeRes.ok).toBe(false);
    if (!writeRes.ok) {
      expect(writeRes.error.code).toBe('ACL_SCOPE_INSUFFICIENT');
    }

    // Verify underlying storage harness remains completely empty
    const checkRes = await harness.getItem('local', 'public:key1');
    expect(checkRes.ok).toBe(true);
    if (checkRes.ok) {
      expect(checkRes.value).toBeNull();
    }
  });

  it('should allow authorized setItem and getItem calls', async () => {
    const subject: AclSubjectContext = { subjectId: 'full_sub', roles: [] };
    const env: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };

    const setRes = await guard.setItem('local', 'user:pref', { theme: 'dark' }, subject, env);
    expect(setRes.ok).toBe(true);

    const getRes = await guard.getItem<{ theme: string }>('local', 'user:pref', subject, env);
    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.value).toEqual({ theme: 'dark' });
    }
  });

  it('should abort bulk setItems if any key violates key pattern policies (atomic transaction guarantee)', async () => {
    const subject: AclSubjectContext = { subjectId: 'full_sub', roles: [] };
    const env: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };

    const items = {
      'user:k1': 'v1',
      'user:k2': 'v2',
      'system:restricted_key': 'secret_val', // Violates 'user:*' key pattern!
    };

    const bulkRes = await guard.setItems('local', items, subject, env);
    expect(bulkRes.ok).toBe(false);
    if (!bulkRes.ok) {
      expect(bulkRes.error.code).toBe('ACL_KEY_RESTRICTED');
    }

    // Verify NO keys were written to harness
    const k1 = await harness.getItem('local', 'user:k1');
    const k2 = await harness.getItem('local', 'user:k2');
    if (k1.ok) expect(k1.value).toBeNull();
    if (k2.ok) expect(k2.value).toBeNull();
  });

  it('should protect delete operations with ACL permissions', async () => {
    const subjectFull: AclSubjectContext = { subjectId: 'full_sub', roles: [] };
    const envFull: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };

    await guard.setItem('local', 'user:temp', 'to_be_deleted', subjectFull, envFull);

    const subjectReader: AclSubjectContext = { subjectId: 'reader_sub', roles: [] };
    const envReader: AclEnvironmentContext = { origin: 'https://read.example.com', timestamp: Date.now() };

    // Reader attempts delete -> denied
    const delFail = await guard.removeItem('local', 'user:temp', subjectReader, envReader);
    expect(delFail.ok).toBe(false);

    // Key still exists
    const checkRes = await harness.getItem('local', 'user:temp');
    if (checkRes.ok) expect(checkRes.value).toBe('to_be_deleted');

    // Full user deletes -> succeeds
    const delSuccess = await guard.removeItem('local', 'user:temp', subjectFull, envFull);
    expect(delSuccess.ok).toBe(true);

    const checkAfter = await harness.getItem('local', 'user:temp');
    if (checkAfter.ok) expect(checkAfter.value).toBeNull();
  });
});
