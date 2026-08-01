import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseLockPriority,
  StorageMutexError,
} from '../src/domain/model/storageMutex';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter, InMemoryStorageBackend } from '../src/infrastructure/adapters/storageMutexAdapter';

describe('StorageMutex Domain Model & Primary Port', () => {
  let engine: StorageMutexEngine;
  let adapter: StorageMutexAdapter;

  beforeEach(() => {
    adapter = new StorageMutexAdapter(new InMemoryStorageBackend());
    adapter.clearAll();
    engine = new StorageMutexEngine({
      driverType: 'in-memory',
      repository: adapter,
      channelName: 'chan_storage_mutex_unit',
    });
  });

  afterEach(() => {
    engine.destroy();
  });

  describe('Suite 1: Value Object & Priority Invariants', () => {
    it('test_01_1: should parse priority levels correctly', () => {
      expect(parseLockPriority('LOW')).toBe(0);
      expect(parseLockPriority('NORMAL')).toBe(1);
      expect(parseLockPriority('HIGH')).toBe(2);
      expect(parseLockPriority('CRITICAL')).toBe(3);
      expect(parseLockPriority(0)).toBe(0);
      expect(parseLockPriority(3)).toBe(3);
      expect(parseLockPriority(undefined)).toBe(1);
    });

    it('test_01_2: should construct StorageMutexError with kind and message', () => {
      const err = new StorageMutexError('LOCK_TIMEOUT', 'Timed out waiting for lock', 'res_a', 'client_1');
      expect(err.kind).toBe('LOCK_TIMEOUT');
      expect(err.message).toBe('Timed out waiting for lock');
      expect(err.lockName).toBe('res_a');
      expect(err.holderId).toBe('client_1');
      expect(err.name).toBe('StorageMutexError');
    });

    it('test_01_3: should issue fencing tokens sequentially', async () => {
      const res1 = await engine.acquireLock('token_res');
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.fencingToken).toBe(1);
        await engine.releaseLock(res1.value.lockId);
      }

      const res2 = await engine.acquireLock('token_res');
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.fencingToken).toBe(2);
        await engine.releaseLock(res2.value.lockId);
      }
    });
  });

  describe('Suite 2: Options Validation & Error Cases', () => {
    it('test_02_1: should reject empty or invalid lock names', async () => {
      const res = await engine.acquireLock('');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_LOCK_NAME');
      }
    });

    it('test_02_2: should reject negative timeout or invalid lease values', async () => {
      const res = await engine.acquireLock('valid_name', { timeoutMs: -100 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_OPTIONS');
      }
    });

    it('test_02_3: should handle release of non-existent lock handle gracefully', async () => {
      const res = await engine.releaseLock('non_existent_lock_id');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('LOCK_NOT_HELD');
      }
    });
  });

  describe('Suite 3: Primary Port Contract', () => {
    it('test_03_1: acquireLock returns ok Result with StorageLockInfo', async () => {
      const res = await engine.acquireLock('test_key');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.name).toBe('test_key');
        expect(res.value.state).toBe('ACQUIRED');
        expect(res.value.mode).toBe('exclusive');
        await engine.releaseLock(res.value.lockId);
      }
    });

    it('test_03_2: withLock higher order helper automatically releases lock', async () => {
      let executed = false;
      const res = await engine.withLock('with_lock_key', async (lock) => {
        expect(lock.name).toBe('with_lock_key');
        executed = true;
        return 'success';
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('success');
      }
      expect(executed).toBe(true);

      const isLockedRes = await engine.isLocked('with_lock_key');
      expect(isLockedRes.ok).toBe(true);
      if (isLockedRes.ok) {
        expect(isLockedRes.value).toBe(false);
      }
    });

    it('test_03_3: stealLock forcibly preempts lock', async () => {
      const res1 = await engine.acquireLock('stolen_key');
      expect(res1.ok).toBe(true);

      const stealRes = await engine.stealLock('stolen_key');
      expect(stealRes.ok).toBe(true);

      if (res1.ok) {
        const relRes = await engine.releaseLock(res1.value.lockId);
        expect(relRes.ok).toBe(false);
        if (!relRes.ok) {
          expect(relRes.error.kind).toBe('LOCK_NOT_HELD');
        }
      }

      if (stealRes.ok) {
        await engine.releaseLock(stealRes.value.lockId);
      }
    });

    it('test_03_4: getSnapshot provides full diagnostic snapshot', async () => {
      const lockRes = await engine.acquireLock('snap_key');
      expect(lockRes.ok).toBe(true);

      const snapRes = await engine.getSnapshot();
      expect(snapRes.ok).toBe(true);
      if (snapRes.ok) {
        expect(snapRes.value.activeLocks.length).toBe(1);
        expect(snapRes.value.adapterType).toBe('in-memory');
      }

      if (lockRes.ok) {
        await engine.releaseLock(lockRes.value.lockId);
      }
    });

    it('test_03_5: forceReleaseAll clears all held locks', async () => {
      await engine.acquireLock('key_1');
      await engine.acquireLock('key_2');

      const forceRes = await engine.forceReleaseAll();
      expect(forceRes.ok).toBe(true);
      if (forceRes.ok) {
        expect(forceRes.value).toBeGreaterThanOrEqual(2);
      }

      const snap = await engine.getSnapshot();
      expect(snap.ok && snap.value.activeLocks.length).toBe(0);
    });
  });
});
