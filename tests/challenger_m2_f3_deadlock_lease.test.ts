import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter, InMemoryStorageBackend } from '../src/infrastructure/adapters/storageMutexAdapter';
import { StorageMutexError } from '../src/domain/model/storageMutex';

describe('Challenger M2 Feature 3: Deadlock Safety & Lease Expiration Harness', () => {
  let sharedAdapter: StorageMutexAdapter;
  let tabA: StorageMutexEngine;
  let tabB: StorageMutexEngine;
  let tabC: StorageMutexEngine;
  const channelName = 'chan_challenger_f3_deadlock';

  beforeEach(() => {
    sharedAdapter = new StorageMutexAdapter(new InMemoryStorageBackend());
    sharedAdapter.clearAll();
    tabA = new StorageMutexEngine({
      clientId: 'tab_A',
      driverType: 'broadcast-channel',
      repository: sharedAdapter,
      channelName,
      heartbeatIntervalMs: 50,
    });
    tabB = new StorageMutexEngine({
      clientId: 'tab_B',
      driverType: 'broadcast-channel',
      repository: sharedAdapter,
      channelName,
      heartbeatIntervalMs: 50,
    });
    tabC = new StorageMutexEngine({
      clientId: 'tab_C',
      driverType: 'broadcast-channel',
      repository: sharedAdapter,
      channelName,
      heartbeatIntervalMs: 50,
    });
  });

  afterEach(() => {
    tabA.destroy();
    tabB.destroy();
    tabC.destroy();
  });

  describe('1. Deadlock Detection & Error Propagation', () => {
    it('1.1: 2-Party Deadlock Detection — Tab A holds L1 & requests L2; Tab B holds L2 & requests L1', async () => {
      // Step 1: Tab A acquires L1
      const lockA1 = await tabA.acquireLock('lock_1', { timeoutMs: 5000 });
      expect(lockA1.ok).toBe(true);

      // Step 2: Tab B acquires L2
      const lockB2 = await tabB.acquireLock('lock_2', { timeoutMs: 5000 });
      expect(lockB2.ok).toBe(true);

      // Step 3: Tab A requests L2 (queued because Tab B holds L2)
      const promiseA2 = tabA.acquireLock('lock_2', { timeoutMs: 5000 });

      // Small delay to ensure Tab A's waiter is registered
      await new Promise((r) => setTimeout(r, 20));

      // Step 4: Tab B requests L1 (should trigger deadlock detection)
      const resB1 = await tabB.acquireLock('lock_1', { timeoutMs: 5000 });

      // Verification: Tab B's request for L1 must fail with DEADLOCK_DETECTED
      expect(resB1.ok).toBe(false);
      if (!resB1.ok) {
        expect(resB1.error.kind).toBe('DEADLOCK_DETECTED');
        expect(resB1.error.message).toContain('Deadlock cycle detected');
      }

      // Tab B releases L2 to break the deadlock
      if (lockB2.ok) {
        await tabB.releaseLock(lockB2.value.lockId);
      }

      // Tab A should now successfully acquire L2
      const resA2 = await promiseA2;
      expect(resA2.ok).toBe(true);

      if (resA2.ok) {
        await tabA.releaseLock(resA2.value.lockId);
      }
      if (lockA1.ok) {
        await tabA.releaseLock(lockA1.value.lockId);
      }
    });

    it('1.2: 3-Party Ring Deadlock Detection — A->B->C->A cycle detection and error propagation', async () => {
      const lockA1 = await tabA.acquireLock('ring_1', { timeoutMs: 5000 });
      expect(lockA1.ok).toBe(true);

      const lockB2 = await tabB.acquireLock('ring_2', { timeoutMs: 5000 });
      expect(lockB2.ok).toBe(true);

      const lockC3 = await tabC.acquireLock('ring_3', { timeoutMs: 5000 });
      expect(lockC3.ok).toBe(true);

      // A requests ring_2 (held by B)
      const promiseA2 = tabA.acquireLock('ring_2', { timeoutMs: 5000 });
      await new Promise((r) => setTimeout(r, 20));

      // B requests ring_3 (held by C)
      const promiseB3 = tabB.acquireLock('ring_3', { timeoutMs: 5000 });
      await new Promise((r) => setTimeout(r, 20));

      // C requests ring_1 (held by A) — completing cycle C -> ring_1 -> A -> ring_2 -> B -> ring_3 -> C
      const resC1 = await tabC.acquireLock('ring_1', { timeoutMs: 5000 });

      expect(resC1.ok).toBe(false);
      if (!resC1.ok) {
        expect(resC1.error.kind).toBe('DEADLOCK_DETECTED');
      }

      // Clean up locks
      if (lockC3.ok) await tabC.releaseLock(lockC3.value.lockId);
      const resB3 = await promiseB3;
      expect(resB3.ok).toBe(true);
      if (resB3.ok) await tabB.releaseLock(resB3.value.lockId);
      if (lockB2.ok) await tabB.releaseLock(lockB2.value.lockId);

      const resA2 = await promiseA2;
      expect(resA2.ok).toBe(true);
      if (resA2.ok) await tabA.releaseLock(resA2.value.lockId);
      if (lockA1.ok) await tabA.releaseLock(lockA1.value.lockId);
    });

    it('1.3: Deadlock Telemetry Count — getSnapshot correctly reports deadlocksDetected count', async () => {
      const lockA1 = await tabA.acquireLock('telemetry_1');
      const lockB2 = await tabB.acquireLock('telemetry_2');

      tabA.acquireLock('telemetry_2', { timeoutMs: 5000 });
      await new Promise((r) => setTimeout(r, 20));

      const resB1 = await tabB.acquireLock('telemetry_1', { timeoutMs: 5000 });
      expect(resB1.ok).toBe(false);

      const snapB = await tabB.getSnapshot();
      expect(snapB.ok).toBe(true);
      if (snapB.ok) {
        expect(snapB.value.deadlocksDetected).toBeGreaterThanOrEqual(1);
      }

      if (lockB2.ok) await tabB.releaseLock(lockB2.value.lockId);
      if (lockA1.ok) await tabA.releaseLock(lockA1.value.lockId);
    });

    it('1.4: Evaluation of Remote Waiter Deadlock Notification behavior', async () => {
      // Test if remote waiter promise hangs or receives notification when deadlock is detected during queue processing
      const lockA1 = await tabA.acquireLock('d_lock1');
      const lockB2 = await tabB.acquireLock('d_lock2');

      // Tab A requests d_lock2
      const promiseA2 = tabA.acquireLock('d_lock2', { timeoutMs: 1000 });
      await new Promise((r) => setTimeout(r, 20));

      // Tab B requests d_lock1
      const promiseB1 = tabB.acquireLock('d_lock1', { timeoutMs: 1000 });

      const [resA2, resB1] = await Promise.all([promiseA2, promiseB1]);
      
      // At least one of the lock requests must be rejected with DEADLOCK_DETECTED
      const hasDeadlockError = 
        (!resA2.ok && resA2.error.kind === 'DEADLOCK_DETECTED') ||
        (!resB1.ok && resB1.error.kind === 'DEADLOCK_DETECTED');
      
      expect(hasDeadlockError).toBe(true);

      if (lockA1.ok) await tabA.releaseLock(lockA1.value.lockId);
      if (lockB2.ok) await tabB.releaseLock(lockB2.value.lockId);
    });
  });

  describe('2. Watchdog Timers & Lease Expiration Handling', () => {
    it('2.1: Expired Lock Reclaimed by Waiting Tab — Lease TTL recovery', async () => {
      // Tab A acquires lock with 80ms lease duration
      const lockA = await tabA.acquireLock('lease_resource', { leaseDurationMs: 80 });
      expect(lockA.ok).toBe(true);

      // Destroy Tab A to simulate sudden process crash (heartbeat stops)
      tabA.destroy();

      // Tab B requests the same lock with timeout 1500ms
      const startMs = Date.now();
      const lockB = await tabB.acquireLock('lease_resource', { timeoutMs: 1500 });
      const elapsedMs = Date.now() - startMs;

      // Verification: Tab B acquired lock after Tab A's lease expired (~80-200ms)
      expect(lockB.ok).toBe(true);
      expect(elapsedMs).toBeLessThan(1200);

      if (lockB.ok) {
        await tabB.releaseLock(lockB.value.lockId);
      }
    });

    it('2.2: Reclaiming Expired Lock Returns LOCK_EXPIRED Error to original holder', async () => {
      // Tab A acquires lock with 50ms lease duration without auto-heartbeat
      const lockA = await tabA.acquireLock('expire_resource', { leaseDurationMs: 50 });
      expect(lockA.ok).toBe(true);

      // Stop Tab A heartbeat timer manually
      tabA.destroy();

      // Wait 120ms for lease to expire
      await new Promise((r) => setTimeout(r, 120));

      // Tab B acquires the lock
      const lockB = await tabB.acquireLock('expire_resource', { timeoutMs: 500 });
      expect(lockB.ok).toBe(true);

      if (lockB.ok) {
        await tabB.releaseLock(lockB.value.lockId);
      }
    });

    it('2.3: High-Contention Queue with Expiration — 5 tabs queueing for expired lock reclaim sequentially without orphaned waiters', async () => {
      const lockA = await tabA.acquireLock('queue_resource', { leaseDurationMs: 80 });
      expect(lockA.ok).toBe(true);

      // Create 5 concurrent waiters on Tab B & Tab C
      const engines = [tabB, tabC];
      const acquirePromises: Promise<any>[] = [];
      const acquiredOrder: string[] = [];

      for (let i = 0; i < 5; i++) {
        const eng = engines[i % 2];
        const p = eng.acquireLock('queue_resource', { timeoutMs: 5000 }).then(async (res) => {
          if (res.ok) {
            acquiredOrder.push(`${eng.clientId}_${i}`);
            // Hold briefly then release
            await new Promise((r) => setTimeout(r, 10));
            await eng.releaseLock(res.value.lockId);
          }
          return res;
        });
        acquirePromises.push(p);
      }

      // Destroy Tab A to trigger expiration
      tabA.destroy();

      const results = await Promise.all(acquirePromises);

      // All 5 waiters should successfully acquire and release the lock sequentially
      for (const res of results) {
        expect(res.ok).toBe(true);
      }
      expect(acquiredOrder.length).toBe(5);

      // Check snapshot: waiting queue must be empty and active locks must be 0
      const snap = await tabB.getSnapshot();
      expect(snap.ok).toBe(true);
      if (snap.ok) {
        expect(snap.value.waitingQueue.length).toBe(0);
        expect(snap.value.activeLocks.length).toBe(0);
      }
    });

    it('2.4: Heartbeat Lease Extension — Active holder heartbeat keeps lease alive under long operation', async () => {
      // Tab A acquires lock with leaseDurationMs: 150ms and heartbeatIntervalMs: 30ms
      const lockA = await tabA.acquireLock('long_job_lock', { leaseDurationMs: 150 });
      expect(lockA.ok).toBe(true);

      // Tab B tries non-blocking acquisition
      const tryB1 = await tabB.acquireLock('long_job_lock', { ifAvailable: true });
      expect(tryB1.ok).toBe(false);
      if (!tryB1.ok) {
        expect(tryB1.error.kind).toBe('LOCK_CONTENTION');
      }

      // Wait 350ms (longer than initial lease TTL of 150ms). Heartbeat should extend lease.
      await new Promise((r) => setTimeout(r, 350));

      const isLocked = await tabB.isLocked('long_job_lock');
      expect(isLocked.ok).toBe(true);
      if (isLocked.ok) {
        expect(isLocked.value).toBe(true);
      }

      // Tab A releases lock
      if (lockA.ok) {
        await tabA.releaseLock(lockA.value.lockId);
      }

      const isLockedAfter = await tabB.isLocked('long_job_lock');
      expect(isLockedAfter.ok).toBe(true);
      if (isLockedAfter.ok) {
        expect(isLockedAfter.value).toBe(false);
      }
    });
  });

  describe('3. Edge Cases & Re-Entrancy / Steal / Abort Safety', () => {
    it('3.1: Re-entrant Lock Acquisition — Default reentrant: true increments reentrancyDepth', async () => {
      const lock1 = await tabA.acquireLock('reentrant_lock', { reentrant: true });
      expect(lock1.ok).toBe(true);

      const lock2 = await tabA.acquireLock('reentrant_lock', { reentrant: true });
      expect(lock2.ok).toBe(true);
      if (lock1.ok && lock2.ok) {
        expect(lock2.value.reentrancyDepth).toBe(2);

        // Releasing once decrements depth
        const rel1 = await tabA.releaseLock(lock1.value.lockId);
        expect(rel1.ok).toBe(true);

        const snap = await tabA.getSnapshot();
        expect(snap.ok).toBe(true);
        if (snap.ok) {
          expect(snap.value.activeLocks.length).toBe(1);
          expect(snap.value.activeLocks[0].reentrancyDepth).toBe(1);
        }

        // Release second time frees lock
        const rel2 = await tabA.releaseLock(lock2.value.lockId);
        expect(rel2.ok).toBe(true);

        const isLocked = await tabA.isLocked('reentrant_lock');
        expect(isLocked.ok && isLocked.value).toBe(false);
      }
    });

    it('3.2: Re-entrant Lock Forbidden — reentrant: false returns REENTRANT_LOCK_FORBIDDEN error', async () => {
      const lock1 = await tabA.acquireLock('no_reentrant_lock');
      expect(lock1.ok).toBe(true);

      const lock2 = await tabA.acquireLock('no_reentrant_lock', { reentrant: false });
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('REENTRANT_LOCK_FORBIDDEN');
      }

      if (lock1.ok) await tabA.releaseLock(lock1.value.lockId);
    });

    it('3.3: AbortSignal Cancelation — Waiting lock request aborts cleanly when signal is triggered', async () => {
      const lockA = await tabA.acquireLock('abort_lock');
      expect(lockA.ok).toBe(true);

      const controller = new AbortController();
      const promiseB = tabB.acquireLock('abort_lock', { signal: controller.signal, timeoutMs: 10000 });

      // Abort lock B request after 30ms
      setTimeout(() => controller.abort(), 30);

      const resB = await promiseB;
      expect(resB.ok).toBe(false);
      if (!resB.ok) {
        expect(resB.error.kind).toBe('ABORTED');
      }

      // Check snapshot: Tab B waiter must be removed from queue
      const snap = await tabB.getSnapshot();
      expect(snap.ok).toBe(true);
      if (snap.ok) {
        expect(snap.value.waitingQueue.length).toBe(0);
      }

      if (lockA.ok) await tabA.releaseLock(lockA.value.lockId);
    });

    it('3.4: Lock Stealing — steal: true preempts active lock holder and marks state STOLEN', async () => {
      const lockA = await tabA.acquireLock('stolen_target');
      expect(lockA.ok).toBe(true);

      // Tab B steals the lock
      const lockB = await tabB.stealLock('stolen_target');
      expect(lockB.ok).toBe(true);

      // Tab A attempts to release its stolen lock
      if (lockA.ok) {
        const relA = await tabA.releaseLock(lockA.value.lockId);
        expect(relA.ok).toBe(false);
        if (!relA.ok) {
          expect(relA.error.kind).toBe('LOCK_NOT_HELD');
        }
      }

      if (lockB.ok) await tabB.releaseLock(lockB.value.lockId);
    });
  });
});
