import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageMutexEngine } from '../utils/storageMutexEngine';
import { StorageMutexAdapter, InMemoryStorageBackend } from '../src/infrastructure/adapters/storageMutexAdapter';

describe('Feature 08: Cross-Tab Multi-Process Storage Mutex Protocol', () => {
  let sharedAdapter: StorageMutexAdapter;
  let tabA: StorageMutexEngine;
  let tabB: StorageMutexEngine;
  let tabC: StorageMutexEngine;

  beforeEach(() => {
    sharedAdapter = new StorageMutexAdapter(new InMemoryStorageBackend());
    sharedAdapter.clearAll();
    const chan = 'chan_storage_mutex_feature8';
    tabA = new StorageMutexEngine({ clientId: 'tab_A', driverType: 'broadcast-channel', repository: sharedAdapter, channelName: chan });
    tabB = new StorageMutexEngine({ clientId: 'tab_B', driverType: 'broadcast-channel', repository: sharedAdapter, channelName: chan });
    tabC = new StorageMutexEngine({ clientId: 'tab_C', driverType: 'broadcast-channel', repository: sharedAdapter, channelName: chan });
  });

  afterEach(() => {
    tabA.destroy();
    tabB.destroy();
    tabC.destroy();
  });

  describe('Suite 1: Cross-Tab Lock Coordination via BroadcastChannel Protocol', () => {
    it('test_01_1: Tab A acquires lock, Tab B and Tab C queue and receive grants sequentially', async () => {
      const lockA = await tabA.acquireLock('cross_tab_lock', { timeoutMs: 15000 });
      expect(lockA.ok).toBe(true);

      const sequence: string[] = [];

      const promiseB = tabB.acquireLock('cross_tab_lock', { timeoutMs: 15000 }).then((res) => {
        if (res.ok) sequence.push('tab_B');
        return res;
      });

      const promiseC = tabC.acquireLock('cross_tab_lock', { timeoutMs: 15000 }).then((res) => {
        if (res.ok) sequence.push('tab_C');
        return res;
      });

      if (lockA.ok) {
        await tabA.releaseLock(lockA.value.lockId);
      }

      const resB = await promiseB;
      expect(resB.ok).toBe(true);

      if (resB.ok) {
        await tabB.releaseLock(resB.value.lockId);
      }

      const resC = await promiseC;
      expect(resC.ok).toBe(true);

      if (resC.ok) {
        await tabC.releaseLock(resC.value.lockId);
      }

      expect(sequence).toEqual(['tab_B', 'tab_C']);
    }, 15000);
  });

  describe('Suite 2: Tab Crash & Lease Expiration Recovery', () => {
    it('test_02_1: simulated tab crash (destroyed tab) allows waiting tab to reclaim lock after lease TTL', async () => {
      const chan = 'chan_storage_mutex_feature8';
      const crashedTab = new StorageMutexEngine({
        clientId: 'crashed_tab',
        driverType: 'broadcast-channel',
        repository: sharedAdapter,
        channelName: chan,
      });

      const crashedLock = await crashedTab.acquireLock('crash_resource', { leaseDurationMs: 50 });
      expect(crashedLock.ok).toBe(true);

      crashedTab.destroy();

      const lockB = await tabB.acquireLock('crash_resource', { timeoutMs: 1000 });
      expect(lockB.ok).toBe(true);

      if (lockB.ok) {
        await tabB.releaseLock(lockB.value.lockId);
      }
    });
  });

  describe('Suite 3: Atomic Read-Modify-Write Storage Integrity', () => {
    it('test_03_1: concurrent atomic counter mutations under mutex protection produce accurate total count', async () => {
      let counter = 0;
      const iterations = 50;

      const incrementWorker = async (engine: StorageMutexEngine) => {
        for (let i = 0; i < iterations; i++) {
          const res = await engine.withLock(
            'counter_mutex',
            async () => {
              const current = counter;
              await new Promise((r) => setTimeout(r, 1));
              counter = current + 1;
              return counter;
            },
            { timeoutMs: 30000 }
          );
          expect(res.ok).toBe(true);
        }
      };

      await Promise.all([
        incrementWorker(tabA),
        incrementWorker(tabB),
        incrementWorker(tabC),
      ]);

      expect(counter).toBe(iterations * 3);
    }, 60000);
  });
});
