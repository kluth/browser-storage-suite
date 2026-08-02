import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter, InMemoryStorageBackend } from '../src/infrastructure/adapters/storageMutexAdapter';
import { StorageLockInfo } from '../src/domain/model/storageMutex';

describe('Adversarial Concurrency, Linearizability & Memory Leak Verification (ADR-0008)', () => {
  let adapter: StorageMutexAdapter;
  let engines: StorageMutexEngine[];

  beforeEach(() => {
    adapter = new StorageMutexAdapter(new InMemoryStorageBackend());
    adapter.clearAll();
    engines = [];
  });

  afterEach(() => {
    for (const e of engines) {
      e.destroy();
    }
    engines = [];
  });

  const createEngine = (id: string): StorageMutexEngine => {
    const e = new StorageMutexEngine({
      clientId: id,
      driverType: 'in-memory',
      repository: adapter,
      channelName: 'chan_adversarial_mutex',
    });
    engines.push(e);
    return e;
  };

  describe('Adversarial 1: Mutual Exclusion & Fencing Token Linearizability Under High Load', () => {
    it('guarantees strictly one holder at a time for exclusive locks under 200 concurrent requests across 20 simulated tabs', async () => {
      const numTabs = 20;
      const requestsPerTab = 10;
      const hotKey = 'critical_section_data';

      for (let i = 0; i < numTabs; i++) {
        createEngine(`tab_${i}`);
      }

      let activeCount = 0;
      let maxSimultaneous = 0;
      const fencingTokens: number[] = [];
      const executionOrder: string[] = [];

      const tabTask = async (engine: StorageMutexEngine, tabId: number) => {
        for (let j = 0; j < requestsPerTab; j++) {
          const res = await engine.withLock(
            hotKey,
            async (lock) => {
              activeCount++;
              if (activeCount > maxSimultaneous) {
                maxSimultaneous = activeCount;
              }
              fencingTokens.push(lock.fencingToken);
              executionOrder.push(`tab_${tabId}_req_${j}`);
              // Micro-delay to increase overlap window
              await new Promise((r) => setTimeout(r, 1));
              activeCount--;
              return lock.fencingToken;
            },
            { timeoutMs: 60000, leaseDurationMs: 5000 }
          );
          expect(res.ok).toBe(true);
        }
      };

      await Promise.all(engines.map((e, idx) => tabTask(e, idx)));

      expect(maxSimultaneous).toBe(1);
      expect(fencingTokens.length).toBe(numTabs * requestsPerTab);

      // Verify strictly monotonic fencing tokens
      for (let i = 1; i < fencingTokens.length; i++) {
        expect(fencingTokens[i]).toBeGreaterThan(fencingTokens[i - 1]);
      }
    }, 60000);

    it('enforces shared lock concurrency while blocking exclusive locks strictly', async () => {
      const eW1 = createEngine('writer_1');
      const eR1 = createEngine('reader_1');
      const eR2 = createEngine('reader_2');
      const eR3 = createEngine('reader_3');
      const eW2 = createEngine('writer_2');

      const sharedKey = 'read_heavy_resource';
      let activeReaders = 0;
      let maxReaders = 0;
      let activeWriters = 0;
      let maxWriters = 0;

      // 1. Reader 1 acquires shared lock
      const r1Res = await eR1.acquireLock(sharedKey, { mode: 'shared' });
      expect(r1Res.ok).toBe(true);
      activeReaders++;
      if (activeReaders > maxReaders) maxReaders = activeReaders;

      // 2. Reader 2 acquires shared lock concurrently
      const r2Res = await eR2.acquireLock(sharedKey, { mode: 'shared' });
      expect(r2Res.ok).toBe(true);
      activeReaders++;
      if (activeReaders > maxReaders) maxReaders = activeReaders;

      expect(maxReaders).toBe(2);

      // 3. Writer 1 tries to acquire exclusive lock - should be queued
      let writer1Acquired = false;
      const w1Promise = eW1.withLock(
        sharedKey,
        async () => {
          writer1Acquired = true;
          activeWriters++;
          if (activeWriters > maxWriters) maxWriters = activeWriters;
          expect(activeReaders).toBe(0); // must be 0 readers when writer holds exclusive
          await new Promise((r) => setTimeout(r, 10));
          activeWriters--;
        },
        { mode: 'exclusive' }
      );

      // Give microtask queue time to register waiter
      await new Promise((r) => setTimeout(r, 20));
      expect(writer1Acquired).toBe(false);

      // Release readers
      if (r1Res.ok) {
        activeReaders--;
        await eR1.releaseLock(r1Res.value.lockId);
      }
      if (r2Res.ok) {
        activeReaders--;
        await eR2.releaseLock(r2Res.value.lockId);
      }

      await w1Promise;
      expect(writer1Acquired).toBe(true);
      expect(maxWriters).toBe(1);
    });
  });

  describe('Adversarial 2: Priority Queue & FIFO Order Preservation', () => {
    it('serves higher priority waiters before lower priority waiters', async () => {
      const eHolder = createEngine('holder');
      const eLow = createEngine('low_priority');
      const eMed = createEngine('med_priority');
      const eHigh = createEngine('high_priority');

      const lockKey = 'priority_key';

      // Holder acquires lock
      const holderLock = await eHolder.acquireLock(lockKey);
      expect(holderLock.ok).toBe(true);

      const grantSequence: string[] = [];

      // Queue Low priority waiter
      const lowPromise = eLow.withLock(
        lockKey,
        async () => {
          grantSequence.push('LOW');
        },
        { priority: 'LOW' } // priority 0
      );

      // Queue High priority waiter
      const highPromise = eHigh.withLock(
        lockKey,
        async () => {
          grantSequence.push('HIGH');
        },
        { priority: 'HIGH' } // priority 10
      );

      // Queue Medium priority waiter
      const medPromise = eMed.withLock(
        lockKey,
        async () => {
          grantSequence.push('MEDIUM');
        },
        { priority: 'NORMAL' } // priority 5
      );

      await new Promise((r) => setTimeout(r, 30));

      // Release holder lock
      if (holderLock.ok) {
        await eHolder.releaseLock(holderLock.value.lockId);
      }

      await Promise.all([lowPromise, highPromise, medPromise]);

      expect(grantSequence).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });

    it('preserves FIFO ordering for waiters with identical priority', async () => {
      const eHolder = createEngine('holder');
      const waiters = Array.from({ length: 5 }, (_, i) => createEngine(`fifo_waiter_${i}`));

      const lockKey = 'fifo_key';
      const holderLock = await eHolder.acquireLock(lockKey);
      expect(holderLock.ok).toBe(true);

      const grantSequence: number[] = [];
      const waiterPromises: Promise<any>[] = [];

      for (let i = 0; i < waiters.length; i++) {
        const p = waiters[i].withLock(
          lockKey,
          async () => {
            grantSequence.push(i);
          },
          { priority: 'NORMAL' }
        );
        waiterPromises.push(p);
        // Small stagger to ensure deterministic monotonic request timestamps
        await new Promise((r) => setTimeout(r, 5));
      }

      if (holderLock.ok) {
        await eHolder.releaseLock(holderLock.value.lockId);
      }

      await Promise.all(waiterPromises);

      expect(grantSequence).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('Adversarial 3: Deadlock Cycle Prevention & Starvation Recovery', () => {
    it('detects 3-way circular lock dependency cycle (A->B->C->A)', async () => {
      const eA = createEngine('node_A');
      const eB = createEngine('node_B');
      const eC = createEngine('node_C');

      // A holds Lock1
      const l1 = await eA.acquireLock('lock_1');
      expect(l1.ok).toBe(true);

      // B holds Lock2
      const l2 = await eB.acquireLock('lock_2');
      expect(l2.ok).toBe(true);

      // C holds Lock3
      const l3 = await eC.acquireLock('lock_3');
      expect(l3.ok).toBe(true);

      // A requests Lock2 (A waits on B)
      const pA = eA.acquireLock('lock_2', { timeoutMs: 10000 });

      // B requests Lock3 (B waits on C)
      const pB = eB.acquireLock('lock_3', { timeoutMs: 10000 });

      await new Promise((r) => setTimeout(r, 20));

      // C requests Lock1 (C waits on A -> creates A->B->C->A cycle!)
      const resC = await eC.acquireLock('lock_1', { timeoutMs: 10000 });

      expect(resC.ok).toBe(false);
      if (!resC.ok) {
        expect(resC.error.kind).toBe('DEADLOCK_DETECTED');
      }

      // Cleanup
      if (l1.ok) await eA.releaseLock(l1.value.lockId);
      if (l2.ok) await eB.releaseLock(l2.value.lockId);
      if (l3.ok) await eC.releaseLock(l3.value.lockId);

      await Promise.all([pA, pB]);
    });
  });

  describe('Adversarial 4: Lease Expiration & Abandoned Lock Auto-Purge', () => {
    it('recovers cleanly when a holder crashes / abandons lock without release', async () => {
      const eCrasher = createEngine('crasher_tab');
      const eSurvivor = createEngine('survivor_tab');

      const abandonKey = 'abandoned_resource';

      // Crasher acquires lock with 50ms lease
      const crashLock = await eCrasher.acquireLock(abandonKey, { leaseDurationMs: 50 });
      expect(crashLock.ok).toBe(true);

      // Survivor requests lock with 500ms timeout
      const startTime = Date.now();
      const survivorRes = await eSurvivor.acquireLock(abandonKey, { timeoutMs: 1000 });

      const elapsed = Date.now() - startTime;
      expect(survivorRes.ok).toBe(true);
      // Should acquire lock after ~50ms lease expires, well before 1000ms timeout
      expect(elapsed).toBeLessThan(800);

      if (survivorRes.ok) {
        await eSurvivor.releaseLock(survivorRes.value.lockId);
      }
    });
  });

  describe('Adversarial 5: Re-entrancy & Lock Stealing (Preemption)', () => {
    it('handles re-entrant acquisition up to depth and requires equal number of releases', async () => {
      const engine = createEngine('reentrant_client');
      const key = 'reentrant_key';

      const lock1 = await engine.acquireLock(key, { reentrant: true });
      expect(lock1.ok).toBe(true);
      if (lock1.ok) expect(lock1.value.reentrancyDepth).toBe(1);

      const lock2 = await engine.acquireLock(key, { reentrant: true });
      expect(lock2.ok).toBe(true);
      if (lock2.ok) expect(lock2.value.reentrancyDepth).toBe(2);

      // First release decrements depth
      const rel1 = await engine.releaseLock(lock1.ok ? lock1.value.lockId : '');
      expect(rel1.ok).toBe(true);

      // Check lock is still held
      const isHeld = await engine.isLocked(key);
      expect(isHeld.ok && isHeld.value).toBe(true);

      // Second release fully releases lock
      const rel2 = await engine.releaseLock(lock2.ok ? lock2.value.lockId : '');
      expect(rel2.ok).toBe(true);

      const isHeldAfter = await engine.isLocked(key);
      expect(isHeldAfter.ok && isHeldAfter.value).toBe(false);
    });

    it('rejects re-entrant acquisition when reentrant: false is set', async () => {
      const engine = createEngine('strict_client');
      const key = 'strict_key';

      const lock1 = await engine.acquireLock(key, { reentrant: false });
      expect(lock1.ok).toBe(true);

      const lock2 = await engine.acquireLock(key, { reentrant: false });
      expect(lock2.ok).toBe(false);
      if (!lock2.ok) {
        expect(lock2.error.kind).toBe('REENTRANT_LOCK_FORBIDDEN');
      }

      if (lock1.ok) await engine.releaseLock(lock1.value.lockId);
    });

    it('preempts active lock when steal: true is requested', async () => {
      const eVictim = createEngine('victim');
      const eThief = createEngine('thief');
      const key = 'stolen_key';

      const victimLock = await eVictim.acquireLock(key);
      expect(victimLock.ok).toBe(true);

      const thiefLock = await eThief.stealLock(key);
      expect(thiefLock.ok).toBe(true);

      // Victim trying to release stolen lock receives error
      if (victimLock.ok) {
        const victimRel = await eVictim.releaseLock(victimLock.value.lockId);
        expect(victimRel.ok).toBe(false);
        if (!victimRel.ok) {
          expect(victimRel.error.kind).toBe('LOCK_NOT_HELD');
        }
      }

      if (thiefLock.ok) {
        await eThief.releaseLock(thiefLock.value.lockId);
      }
    });
  });

  describe('Adversarial 6: Memory Leak & Resource Cleanup Verification', () => {
    it('leaves zero memory leaks or dangling internal state after 500 rapid lock cycles', async () => {
      const engine = createEngine('leak_checker');
      const numCycles = 500;

      for (let i = 0; i < numCycles; i++) {
        const key = `rapid_key_${i % 10}`;
        const res = await engine.acquireLock(key, { leaseDurationMs: 1000 });
        expect(res.ok).toBe(true);
        if (res.ok) {
          const rel = await engine.releaseLock(res.value.lockId);
          expect(rel.ok).toBe(true);
        }
      }

      const snap = await engine.getSnapshot();
      expect(snap.ok).toBe(true);
      if (snap.ok) {
        expect(snap.value.activeLocks.length).toBe(0);
        expect(snap.value.waitingQueue.length).toBe(0);
      }

      // Check internal engine state
      const internalWaitersMap = (engine as any).internalWaiters;
      const activeWatchdogsMap = (engine as any).activeWatchdogs;
      const seenMessagesSet = (engine as any).seenMessages;

      expect(internalWaitersMap.size).toBe(0);
      expect(activeWatchdogsMap.size).toBe(0);
      expect(seenMessagesSet.size).toBeLessThanOrEqual(500); // capped at 500
    });
  });
});
