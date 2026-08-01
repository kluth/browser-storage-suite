import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter, InMemoryStorageBackend } from '../src/infrastructure/adapters/storageMutexAdapter';

describe('StorageMutexEngine Mechanics & Integration', () => {
  let adapter: StorageMutexAdapter;
  let engine1: StorageMutexEngine;
  let engine2: StorageMutexEngine;

  beforeEach(() => {
    adapter = new StorageMutexAdapter(new InMemoryStorageBackend());
    adapter.clearAll();
    const chan = 'chan_storage_mutex_engine';
    engine1 = new StorageMutexEngine({ clientId: 'client_1', driverType: 'in-memory', repository: adapter, channelName: chan });
    engine2 = new StorageMutexEngine({ clientId: 'client_2', driverType: 'in-memory', repository: adapter, channelName: chan });
  });

  afterEach(() => {
    engine1.destroy();
    engine2.destroy();
  });

  describe('Suite 1: Mutex Acquisition & Release Mechanics', () => {
    it('test_01_1: sequential acquire and release of exclusive lock', async () => {
      const lock1 = await engine1.acquireLock('resource_A');
      expect(lock1.ok).toBe(true);

      const isLocked1 = await engine1.isLocked('resource_A');
      expect(isLocked1.ok && isLocked1.value).toBe(true);

      if (lock1.ok) {
        const rel1 = await engine1.releaseLock(lock1.value.lockId);
        expect(rel1.ok).toBe(true);
      }

      const isLocked2 = await engine1.isLocked('resource_A');
      expect(isLocked2.ok && isLocked2.value).toBe(false);
    });

    it('test_01_2: key isolation between distinct lock names', async () => {
      const lockA = await engine1.acquireLock('resource_A');
      const lockB = await engine2.acquireLock('resource_B');

      expect(lockA.ok).toBe(true);
      expect(lockB.ok).toBe(true);

      if (lockA.ok) await engine1.releaseLock(lockA.value.lockId);
      if (lockB.ok) await engine2.releaseLock(lockB.value.lockId);
    });

    it('test_01_3: multiple concurrent shared locks allow simultaneous access', async () => {
      const lock1 = await engine1.acquireLock('shared_res', { mode: 'shared' });
      const lock2 = await engine2.acquireLock('shared_res', { mode: 'shared' });

      expect(lock1.ok).toBe(true);
      expect(lock2.ok).toBe(true);

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);
      if (lock2.ok) await engine2.releaseLock(lock2.value.lockId);
    });

    it('test_01_4: exclusive lock blocks shared lock acquisition until released', async () => {
      const excLock = await engine1.acquireLock('shared_block', { mode: 'exclusive' });
      expect(excLock.ok).toBe(true);

      let sharedAcquired = false;
      const pendingShared = engine2.acquireLock('shared_block', { mode: 'shared', timeoutMs: 1000 }).then((res) => {
        if (res.ok) sharedAcquired = true;
        return res;
      });

      expect(sharedAcquired).toBe(false);

      if (excLock.ok) {
        await engine1.releaseLock(excLock.value.lockId);
      }

      const sharedRes = await pendingShared;
      expect(sharedRes.ok).toBe(true);
      expect(sharedAcquired).toBe(true);

      if (sharedRes.ok) await engine2.releaseLock(sharedRes.value.lockId);
    });
  });

  describe('Suite 2: Contention, Timeouts, Priorities & AbortSignal', () => {
    it('test_02_1: timeout triggers when lock cannot be granted in time', async () => {
      const lock1 = await engine1.acquireLock('timeout_res');
      expect(lock1.ok).toBe(true);

      const lock2 = await engine2.acquireLock('timeout_res', { timeoutMs: 50 });
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('ACQUISITION_TIMEOUT');
      }

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);
    });

    it('test_02_2: priority queue grants lock in priority order', async () => {
      const lock1 = await engine1.acquireLock('prio_res');
      expect(lock1.ok).toBe(true);

      const grantOrder: string[] = [];

      const waiterLow = engine2.acquireLock('prio_res', { priority: 'LOW' }).then((res) => {
        if (res.ok) grantOrder.push('LOW');
        return res;
      });

      const waiterHigh = engine2.acquireLock('prio_res', { priority: 'HIGH' }).then((res) => {
        if (res.ok) grantOrder.push('HIGH');
        return res;
      });

      const waiterCrit = engine2.acquireLock('prio_res', { priority: 'CRITICAL' }).then((res) => {
        if (res.ok) grantOrder.push('CRITICAL');
        return res;
      });

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);

      const [rLow, rHigh, rCrit] = await Promise.all([waiterLow, waiterHigh, waiterCrit]);

      expect(rLow.ok).toBe(true);
      expect(rHigh.ok).toBe(true);
      expect(rCrit.ok).toBe(true);

      expect(grantOrder[0]).toBe('CRITICAL');
      expect(grantOrder[1]).toBe('HIGH');
      expect(grantOrder[2]).toBe('LOW');

      if (rLow.ok) await engine2.releaseLock(rLow.value.lockId);
      if (rHigh.ok) await engine2.releaseLock(rHigh.value.lockId);
      if (rCrit.ok) await engine2.releaseLock(rCrit.value.lockId);
    });

    it('test_02_3: AbortSignal cancels waiting lock request', async () => {
      const lock1 = await engine1.acquireLock('abort_res');
      expect(lock1.ok).toBe(true);

      const controller = new AbortController();
      const lock2Promise = engine2.acquireLock('abort_res', { signal: controller.signal });

      controller.abort();

      const lock2 = await lock2Promise;
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('ABORTED');
      }

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);
    });

    it('test_02_4: non-blocking ifAvailable returns LOCK_CONTENTION immediately', async () => {
      const lock1 = await engine1.acquireLock('nb_res');
      expect(lock1.ok).toBe(true);

      const lock2 = await engine2.acquireLock('nb_res', { ifAvailable: true });
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('LOCK_CONTENTION');
      }

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);
    });
  });

  describe('Suite 3: Re-entrancy Policy', () => {
    it('test_03_1: re-entrant acquisition increments depth count', async () => {
      const lock1 = await engine1.acquireLock('reentrant_res', { reentrant: true });
      expect(lock1.ok).toBe(true);
      if (lock1.ok) expect(lock1.value.reentrancyDepth).toBe(1);

      const lock2 = await engine1.acquireLock('reentrant_res', { reentrant: true });
      expect(lock2.ok).toBe(true);
      if (lock2.ok) expect(lock2.value.reentrancyDepth).toBe(2);

      if (lock2.ok) {
        const rel1 = await engine1.releaseLock(lock2.value.lockId);
        expect(rel1.ok).toBe(true);
      }

      const isLocked = await engine1.isLocked('reentrant_res');
      expect(isLocked.ok && isLocked.value).toBe(true);

      if (lock1.ok) {
        const rel2 = await engine1.releaseLock(lock1.value.lockId);
        expect(rel2.ok).toBe(true);
      }

      const isLocked2 = await engine1.isLocked('reentrant_res');
      expect(isLocked2.ok && isLocked2.value).toBe(false);
    });

    it('test_03_2: non-reentrant option rejects self-acquisition', async () => {
      const lock1 = await engine1.acquireLock('no_reentrant_res', { reentrant: true });
      expect(lock1.ok).toBe(true);

      const lock2 = await engine1.acquireLock('no_reentrant_res', { reentrant: false });
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('REENTRANT_LOCK_FORBIDDEN');
      }

      if (lock1.ok) await engine1.releaseLock(lock1.value.lockId);
    });
  });

  describe('Suite 4: Auto-Expiration & Refresh', () => {
    it('test_04_1: refreshLock extends lease expiration', async () => {
      const lock = await engine1.acquireLock('refresh_res', { leaseDurationMs: 1000 });
      expect(lock.ok).toBe(true);
      if (!lock.ok) return;

      const initialExpiry = lock.value.expiresAt;

      const refreshRes = await engine1.refreshLock(lock.value.lockId);
      expect(refreshRes.ok).toBe(true);
      if (refreshRes.ok) {
        expect(refreshRes.value.expiresAt).toBeGreaterThanOrEqual(initialExpiry);
        await engine1.releaseLock(refreshRes.value.lockId);
      }
    });

    it('test_04_2: auto-expires dead lock leases after TTL', async () => {
      const lock = await engine1.acquireLock('ttl_res', { leaseDurationMs: 10 });
      expect(lock.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 20));

      const lockInfo = await engine1.getLockInfo('ttl_res');
      expect(lockInfo.ok).toBe(true);
      if (lockInfo.ok) {
        expect(lockInfo.value).toBeNull();
      }
    });
  });
});
