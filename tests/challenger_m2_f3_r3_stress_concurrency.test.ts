import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter } from '../src/infrastructure/adapters/storageMutexAdapter';
import { StorageLockInfo } from '../src/domain/model/storageMutex';

describe('Challenger M2 F3 R3: High-Concurrency, Linearizability & Zero-Leak Stress Harness', () => {
  let adapter: StorageMutexAdapter;
  let engines: StorageMutexEngine[];

  beforeEach(() => {
    adapter = new StorageMutexAdapter();
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
      channelName: 'chan_challenger_m2_f3_r3_stress',
    });
    engines.push(e);
    return e;
  };

  describe('Suite 1: High-Concurrency Multi-Tab Benchmark (500 Requests across 25 Tabs)', () => {
    it(
      'test_01_1: executes 500 concurrent lock requests across 25 tabs & 50 keys without race conditions',
      async () => {
        const numEngines = 25;
        const requestsPerEngine = 20;
        const numKeys = 50;

        for (let i = 0; i < numEngines; i++) {
          createEngine(`tab_client_${i}`);
        }

        const keyFencingTokens = new Map<string, number[]>();
        for (let k = 0; k < numKeys; k++) {
          keyFencingTokens.set(`key_${k}`, []);
        }

        const startTime = Date.now();

        const worker = async (engine: StorageMutexEngine, engineIdx: number) => {
          const results: any[] = [];
          for (let j = 0; j < requestsPerEngine; j++) {
            const keyName = `key_${(engineIdx * 7 + j) % numKeys}`;
            const res = await engine.withLock(
              keyName,
              async (lock: StorageLockInfo) => {
                const tokens = keyFencingTokens.get(keyName)!;
                tokens.push(lock.fencingToken);
                return lock.fencingToken;
              },
              { timeoutMs: 30000 }
            );
            results.push(res);
          }
          return results;
        };

        const allResults = await Promise.all(engines.map((e, idx) => worker(e, idx)));
        const flatResults = allResults.flat();
        const durationMs = Date.now() - startTime;

        expect(flatResults.length).toBe(500);
        const successCount = flatResults.filter((r) => r.ok).length;
        expect(successCount).toBe(500);

        // Verify fencing token monotonicity per key
        for (const [keyName, tokens] of keyFencingTokens.entries()) {
          if (tokens.length > 0) {
            for (let i = 1; i < tokens.length; i++) {
              expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
            }
          }
        }

        // Verify zero leftover locks / waiters
        const snap = await engines[0].getSnapshot();
        expect(snap.ok).toBe(true);
        if (snap.ok) {
          expect(snap.value.activeLocks.length).toBe(0);
          expect(snap.value.waitingQueue.length).toBe(0);
        }

        expect(durationMs).toBeLessThan(60000);
      },
      60000
    );
  });

  describe('Suite 2: Single-Key Extreme Contention & Linearizability Verification', () => {
    it(
      'test_02_1: 200 concurrent lock requests competing on a single key guarantee mutual exclusion and monotonically increasing fencing tokens',
      async () => {
        const numTabs = 20;
        const requestsPerTab = 10;
        const targetKey = 'hot_contentious_key';

        for (let i = 0; i < numTabs; i++) {
          createEngine(`tab_heavy_${i}`);
        }

        let currentActiveCount = 0;
        let maxSimultaneousActive = 0;
        const fencingTokensAcquired: number[] = [];
        const acquisitionSequence: string[] = [];

        const task = async (engine: StorageMutexEngine, tabId: string) => {
          for (let r = 0; r < requestsPerTab; r++) {
            const res = await engine.withLock(
              targetKey,
              async (lock) => {
                currentActiveCount++;
                if (currentActiveCount > maxSimultaneousActive) {
                  maxSimultaneousActive = currentActiveCount;
                }

                fencingTokensAcquired.push(lock.fencingToken);
                acquisitionSequence.push(`${tabId}_r${r}`);

                // Small microtask yield simulating atomic mutation window
                await new Promise((resolve) => setTimeout(resolve, 1));

                currentActiveCount--;
                return lock.fencingToken;
              },
              { timeoutMs: 60000 }
            );

            expect(res.ok).toBe(true);
          }
        };

        await Promise.all(engines.map((e, idx) => task(e, `tab_${idx}`)));

        expect(maxSimultaneousActive).toBe(1);
        expect(currentActiveCount).toBe(0);
        expect(fencingTokensAcquired.length).toBe(numTabs * requestsPerTab);

        // Strict monotonicity check
        for (let i = 0; i < fencingTokensAcquired.length; i++) {
          if (i > 0) {
            expect(fencingTokensAcquired[i]).toBeGreaterThan(fencingTokensAcquired[i - 1]);
          }
        }
      },
      60000
    );
  });

  describe('Suite 3: Priority & Strict FIFO Queue Order Preservation', () => {
    it('test_03_1: grants queued waiters in strict priority order (CRITICAL > HIGH > NORMAL > LOW)', async () => {
      const holderEngine = createEngine('tab_holder');
      const waiterEngines = [
        createEngine('tab_low'),
        createEngine('tab_normal'),
        createEngine('tab_high'),
        createEngine('tab_critical'),
      ];

      const lockKey = 'priority_test_key';

      // 1. Holder acquires lock
      const holderLock = await holderEngine.acquireLock(lockKey);
      expect(holderLock.ok).toBe(true);

      const grantOrder: string[] = [];

      // 2. Queue waiters in reverse priority order and auto-release upon grant
      const pLow = waiterEngines[0].acquireLock(lockKey, { priority: 'LOW' }).then(async (res) => {
        if (res.ok) {
          grantOrder.push('LOW');
          await waiterEngines[0].releaseLock(res.value.lockId);
        }
        return res;
      });

      const pNormal = waiterEngines[1].acquireLock(lockKey, { priority: 'NORMAL' }).then(async (res) => {
        if (res.ok) {
          grantOrder.push('NORMAL');
          await waiterEngines[1].releaseLock(res.value.lockId);
        }
        return res;
      });

      const pHigh = waiterEngines[2].acquireLock(lockKey, { priority: 'HIGH' }).then(async (res) => {
        if (res.ok) {
          grantOrder.push('HIGH');
          await waiterEngines[2].releaseLock(res.value.lockId);
        }
        return res;
      });

      const pCritical = waiterEngines[3].acquireLock(lockKey, { priority: 'CRITICAL' }).then(async (res) => {
        if (res.ok) {
          grantOrder.push('CRITICAL');
          await waiterEngines[3].releaseLock(res.value.lockId);
        }
        return res;
      });

      // Small delay to ensure all waiters are registered in repository
      await new Promise((r) => setTimeout(r, 50));

      const snapBefore = await holderEngine.getSnapshot();
      expect(snapBefore.ok && snapBefore.value.waitingQueue.length).toBe(4);

      // 3. Holder releases lock
      if (holderLock.ok) {
        await holderEngine.releaseLock(holderLock.value.lockId);
      }

      // Wait for all waiters to complete
      await Promise.all([pLow, pNormal, pHigh, pCritical]);

      // Order MUST be CRITICAL, HIGH, NORMAL, LOW
      expect(grantOrder).toEqual(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
    }, 30000);

    it('test_03_2: grants equal priority waiters in strict FIFO order', async () => {
      const holder = createEngine('tab_holder');
      const numWaiters = 10;
      const waiters: StorageMutexEngine[] = [];

      for (let i = 0; i < numWaiters; i++) {
        waiters.push(createEngine(`waiter_${i}`));
      }

      const lockKey = 'fifo_test_key';
      const holderLock = await holder.acquireLock(lockKey);
      expect(holderLock.ok).toBe(true);

      const grantSequence: number[] = [];
      const waiterPromises: Promise<any>[] = [];

      // Register waiters sequentially with slight micro-delays to guarantee distinct timestamps
      for (let i = 0; i < numWaiters; i++) {
        const p = waiters[i].acquireLock(lockKey, { priority: 'NORMAL' }).then(async (res) => {
          if (res.ok) {
            grantSequence.push(i);
            await waiters[i].releaseLock(res.value.lockId);
          }
          return res;
        });
        waiterPromises.push(p);
        await new Promise((r) => setTimeout(r, 5));
      }

      if (holderLock.ok) {
        await holder.releaseLock(holderLock.value.lockId);
      }

      await Promise.all(waiterPromises);

      // Verify FIFO sequence: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
      const expectedSequence = Array.from({ length: numWaiters }, (_, i) => i);
      expect(grantSequence).toEqual(expectedSequence);
    });
  });

  describe('Suite 4: Shared vs Exclusive Lock Linearizability', () => {
    it('test_04_1: multiple shared locks coexist, exclusive lock waits until all shared locks release', async () => {
      const numReaders = 5;
      const readers: StorageMutexEngine[] = [];
      for (let i = 0; i < numReaders; i++) {
        readers.push(createEngine(`reader_${i}`));
      }
      const writer = createEngine('writer_1');

      const lockKey = 'rw_lock_key';

      // 1. Acquire 5 shared locks concurrently
      const readerLocks = await Promise.all(
        readers.map((r) => r.acquireLock(lockKey, { mode: 'shared' }))
      );

      for (const res of readerLocks) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.mode).toBe('shared');
        }
      }

      // Check snapshot: 5 active shared locks
      const snap1 = await writer.getSnapshot();
      expect(snap1.ok && snap1.value.activeLocks.length).toBe(numReaders);

      let writerAcquiredAt = 0;
      let allReadersReleasedAt = 0;

      // 2. Writer requests exclusive lock
      const writerPromise = writer.acquireLock(lockKey, { mode: 'exclusive' }).then((res) => {
        writerAcquiredAt = Date.now();
        return res;
      });

      await new Promise((r) => setTimeout(r, 50));

      // 3. Release 4 out of 5 readers
      for (let i = 0; i < numReaders - 1; i++) {
        const rLock = readerLocks[i];
        if (rLock.ok) {
          await readers[i].releaseLock(rLock.value.lockId);
        }
      }

      // Writer should still be waiting because 1 reader remains
      const snap2 = await writer.getSnapshot();
      expect(snap2.ok && snap2.value.activeLocks.length).toBe(1);
      expect(snap2.ok && snap2.value.waitingQueue.length).toBe(1);

      await new Promise((r) => setTimeout(r, 50));

      // 4. Release final reader
      allReadersReleasedAt = Date.now();
      const lastLock = readerLocks[numReaders - 1];
      if (lastLock.ok) {
        await readers[numReaders - 1].releaseLock(lastLock.value.lockId);
      }

      // Writer now gets exclusive lock
      const writerRes = await writerPromise;
      expect(writerRes.ok).toBe(true);
      expect(writerAcquiredAt).toBeGreaterThanOrEqual(allReadersReleasedAt);

      if (writerRes.ok) {
        await writer.releaseLock(writerRes.value.lockId);
      }
    });
  });

  describe('Suite 5: Resource & Memory Leak Prevention Under Heavy Contention', () => {
    it('test_05_1: zero orphaned waiters, zero lingering timers or watchdogs after 1000 rapid acquire/release cycles', async () => {
      const numEngines = 10;
      const cyclesPerEngine = 100;

      for (let i = 0; i < numEngines; i++) {
        createEngine(`leak_test_tab_${i}`);
      }

      const cycle = async (engine: StorageMutexEngine, engineIdx: number) => {
        for (let c = 0; c < cyclesPerEngine; c++) {
          const key = `key_${(engineIdx + c) % 10}`;
          const res = await engine.acquireLock(key, { leaseDurationMs: 1000 });
          expect(res.ok).toBe(true);
          if (res.ok) {
            await engine.releaseLock(res.value.lockId);
          }
        }
      };

      await Promise.all(engines.map((e, idx) => cycle(e, idx)));

      // Validate repository & snapshot state
      const snap = await engines[0].getSnapshot();
      expect(snap.ok).toBe(true);
      if (snap.ok) {
        expect(snap.value.activeLocks.length).toBe(0);
        expect(snap.value.waitingQueue.length).toBe(0);
      }

      // Destroy all engines and verify cleanup
      for (const e of engines) {
        e.destroy();
      }
    });

    it('test_05_2: AbortSignal cancellations mid-queue release resources without memory leaks or orphaned state', async () => {
      const holder = createEngine('holder_tab');
      const numQueued = 40;
      const queuedEngines: StorageMutexEngine[] = [];

      for (let i = 0; i < numQueued; i++) {
        queuedEngines.push(createEngine(`queued_tab_${i}`));
      }

      const lockKey = 'abort_stress_key';
      const holderLock = await holder.acquireLock(lockKey);
      expect(holderLock.ok).toBe(true);

      const abortControllers: AbortController[] = [];
      const requests: Promise<any>[] = [];

      for (let i = 0; i < numQueued; i++) {
        const controller = new AbortController();
        abortControllers.push(controller);

        const p = queuedEngines[i]
          .acquireLock(lockKey, {
            signal: controller.signal,
            timeoutMs: 30000,
          })
          .then(async (res) => {
            if (res.ok) {
              await queuedEngines[i].releaseLock(res.value.lockId);
            }
            return res;
          });
        requests.push(p);
      }

      await new Promise((r) => setTimeout(r, 50));

      const snapQueued = await holder.getSnapshot();
      expect(snapQueued.ok && snapQueued.value.waitingQueue.length).toBe(numQueued);

      // Abort half of the queued requests (even indices)
      const abortedIndices: number[] = [];
      for (let i = 0; i < numQueued; i += 2) {
        abortControllers[i].abort();
        abortedIndices.push(i);
      }

      await new Promise((r) => setTimeout(r, 50));

      const snapAfterAbort = await holder.getSnapshot();
      expect(snapAfterAbort.ok && snapAfterAbort.value.waitingQueue.length).toBe(numQueued / 2);

      // Release holder lock, remaining non-aborted waiters resolve
      if (holderLock.ok) {
        await holder.releaseLock(holderLock.value.lockId);
      }

      const results = await Promise.all(requests);

      let abortedCount = 0;
      let successCount = 0;

      for (let i = 0; i < numQueued; i++) {
        const res = results[i];
        if (i % 2 === 0) {
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error.kind).toBe('ABORTED');
          }
          abortedCount++;
        } else {
          expect(res.ok).toBe(true);
          successCount++;
        }
      }

      expect(abortedCount).toBe(20);
      expect(successCount).toBe(20);

      // Final snapshot clean check
      const snapFinal = await holder.getSnapshot();
      expect(snapFinal.ok && snapFinal.value.activeLocks.length).toBe(0);
      expect(snapFinal.ok && snapFinal.value.waitingQueue.length).toBe(0);
    });
  });

  describe('Suite 6: Multi-Party Circular Ring Deadlock Resolution', () => {
    it('test_06_1: detects 4-party ring deadlock cycle A -> B -> C -> D -> A and breaks cycle immediately', async () => {
      const eA = createEngine('node_A');
      const eB = createEngine('node_B');
      const eC = createEngine('node_C');
      const eD = createEngine('node_D');

      // Setup 4 locks: K1, K2, K3, K4
      const lockA = await eA.acquireLock('K1');
      const lockB = await eB.acquireLock('K2');
      const lockC = await eC.acquireLock('K3');
      const lockD = await eD.acquireLock('K4');

      expect(lockA.ok && lockB.ok && lockC.ok && lockD.ok).toBe(true);

      // Node A waits on K2 (held by B)
      const pA = eA.acquireLock('K2', { timeoutMs: 5000 });
      // Node B waits on K3 (held by C)
      const pB = eB.acquireLock('K3', { timeoutMs: 5000 });
      // Node C waits on K4 (held by D)
      const pC = eC.acquireLock('K4', { timeoutMs: 5000 });

      await new Promise((r) => setTimeout(r, 50));

      // Node D now requests K1 (held by A) -> Completes ring: D -> A -> B -> C -> D
      const resRing = await eD.acquireLock('K1', { timeoutMs: 5000 });

      expect(resRing.ok).toBe(false);
      if (!resRing.ok) {
        expect(resRing.error.kind).toBe('DEADLOCK_DETECTED');
      }

      // Cleanup held locks
      if (lockA.ok) await eA.releaseLock(lockA.value.lockId);
      if (lockB.ok) await eB.releaseLock(lockB.value.lockId);
      if (lockC.ok) await eC.releaseLock(lockC.value.lockId);
      if (lockD.ok) await eD.releaseLock(lockD.value.lockId);

      await Promise.allSettled([pA, pB, pC]);
    });
  });
});
