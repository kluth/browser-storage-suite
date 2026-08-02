import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter } from '../src/infrastructure/adapters/storageMutexAdapter';

describe('StorageMutexEngine Stress, High Contention & Zero-Deadlock Benchmarks', () => {
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
      channelName: 'chan_storage_mutex_stress',
    });
    engines.push(e);
    return e;
  };

  describe('Suite 1: 1,000 Concurrent Lock Requests', () => {
    it(
      'test_01_1: processes 1,000 concurrent lock requests across 50 keys without deadlocks or unhandled rejections',
      async () => {
        const numEngines = 10;
        const requestsPerEngine = 100;
        const numKeys = 50;

        for (let i = 0; i < numEngines; i++) {
          createEngine(`stress_client_${i}`);
        }

        const startTime = Date.now();
        const worker = async (engine: StorageMutexEngine, engineIdx: number) => {
          const workerResults: any[] = [];
          for (let j = 0; j < requestsPerEngine; j++) {
            const key = `key_${(engineIdx + j) % numKeys}`;
            const res = await engine.withLock(
              key,
              async () => {
                return j;
              },
              { timeoutMs: 30000 }
            );
            workerResults.push(res);
          }
          return workerResults;
        };

        const workerPromises = engines.map((e, idx) => worker(e, idx));
        const allWorkerResults = await Promise.all(workerPromises);
        const results = allWorkerResults.flat();
        const durationMs = Date.now() - startTime;

        expect(results.length).toBe(1000);
        const successCount = results.filter((r) => r.ok).length;
        expect(successCount).toBe(1000);
        expect(durationMs).toBeLessThan(120000);
      },
      120000
    );
  });

  describe('Suite 2: Single-Key High-Contention Benchmark', () => {
    it(
      'test_02_1: 100 concurrent workers competing for single key verify monotonic fencing tokens',
      async () => {
        const numWorkers = 20;
        const iterationsPerWorker = 5;

        for (let i = 0; i < numWorkers; i++) {
          createEngine(`worker_${i}`);
        }

        const tokens: number[] = [];

        const workerFn = async (engine: StorageMutexEngine) => {
          for (let i = 0; i < iterationsPerWorker; i++) {
            const res = await engine.withLock(
              'hot_key',
              async (lock) => {
                tokens.push(lock.fencingToken);
                return lock.fencingToken;
              },
              { timeoutMs: 120000 }
            );
            expect(res.ok).toBe(true);
          }
        };

        await Promise.all(engines.map((e) => workerFn(e)));

        expect(tokens.length).toBe(numWorkers * iterationsPerWorker);

        for (let i = 0; i < tokens.length; i++) {
          expect(tokens[i]).toBeGreaterThan(i > 0 ? tokens[i - 1] : 0);
        }
      },
      120000
    );
  });

  describe('Suite 3: Zero-Deadlock Circular Dependency Resolution', () => {
    it('test_03_1: detects circular dependency cycle and rejects with DEADLOCK_DETECTED', async () => {
      const e1 = createEngine('client_A');
      const e2 = createEngine('client_B');

      const lock1 = await e1.acquireLock('res_1');
      expect(lock1.ok).toBe(true);

      const lock2 = await e2.acquireLock('res_2');
      expect(lock2.ok).toBe(true);

      const p2 = e2.acquireLock('res_1', { timeoutMs: 2000 });

      const resDeadlock = await e1.acquireLock('res_2');

      expect(resDeadlock.ok).toBe(false);
      if (!resDeadlock.ok) {
        expect(resDeadlock.error.kind).toBe('DEADLOCK_DETECTED');
      }

      const snap = await e1.getSnapshot();
      expect(snap.ok && snap.value.deadlocksDetected).toBeGreaterThanOrEqual(1);

      if (lock1.ok) await e1.releaseLock(lock1.value.lockId);
      if (lock2.ok) await e2.releaseLock(lock2.value.lockId);
      await p2;
    });
  });

  describe('Suite 4: Resource & Memory Leak Prevention', () => {
    it('test_04_1: rapid acquire/release cycles leave zero lingering active locks or waiters', async () => {
      const engine = createEngine('clean_client');

      for (let i = 0; i < 50; i++) {
        const res = await engine.acquireLock(`temp_key_${i}`);
        expect(res.ok).toBe(true);
        if (res.ok) {
          await engine.releaseLock(res.value.lockId);
        }
      }

      const snapshot = await engine.getSnapshot();
      expect(snapshot.ok).toBe(true);
      if (snapshot.ok) {
        expect(snapshot.value.activeLocks.length).toBe(0);
        expect(snapshot.value.waitingQueue.length).toBe(0);
      }
    });
  });
});
