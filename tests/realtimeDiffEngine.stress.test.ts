import { describe, it, expect } from 'vitest';
import { RealtimeDiffEngine, escapePointerToken, unescapePointerToken } from '../utils/realtimeDiffEngine';
import { JSONPatchOperation } from '../src/domain/model/storageDiff';

describe('RealtimeDiffEngine Empirical Stress Harness (ADR-0003)', () => {
  describe('1. 10,000 Key/Value Diff Calculations Benchmark', () => {
    it('should calculate 10,000 key/value diffs accurately and under 3000ms', () => {
      const startTime = performance.now();
      const iterations = 10000;
      let totalPatches = 0;

      for (let i = 0; i < iterations; i++) {
        const oldState = {
          id: `user_${i}`,
          key: `key_${i % 100}`,
          value: `val_${i}`,
          count: i,
          active: i % 2 === 0,
        };

        const newState = {
          id: `user_${i}`,
          key: `key_${i % 100}`,
          value: `val_${i}_updated`,
          count: i + 1,
          active: i % 2 === 0,
          newField: `field_${i}`,
        };

        const diffRes = RealtimeDiffEngine.createDiff(oldState, newState);
        expect(diffRes.ok).toBe(true);
        if (diffRes.ok) {
          totalPatches += diffRes.value.globalPatches.length;
          expect(diffRes.value.summary.keysModified).toBe(2); // value & count
          expect(diffRes.value.summary.keysAdded).toBe(1); // newField
          expect(diffRes.value.summary.keysUnchanged).toBe(3); // id, key, active
        }
      }

      const durationMs = performance.now() - startTime;
      const opsPerSec = (iterations / durationMs) * 1000;

      console.log(`[STRESS BENCHMARK] 10k Diff Calculations: ${durationMs.toFixed(2)}ms (${opsPerSec.toFixed(0)} ops/sec), total patches generated: ${totalPatches}`);
      expect(durationMs).toBeLessThan(3000);
      expect(totalPatches).toBe(30000); // 3 patches per iteration (2 replace + 1 add)
    });

    it('should process a single large object diff with 10,000 keys efficiently', () => {
      const oldObj: Record<string, any> = {};
      const newObj: Record<string, any> = {};

      for (let i = 0; i < 10000; i++) {
        oldObj[`k_${i}`] = i;
        // Modify half, add some, delete some
        if (i % 2 === 0) {
          newObj[`k_${i}`] = i * 2;
        } else if (i % 5 === 0) {
          // deleted (don't set in newObj)
        } else {
          newObj[`k_${i}`] = i;
        }
      }
      for (let i = 10000; i < 11000; i++) {
        newObj[`k_${i}`] = i; // 1000 added keys
      }

      const startTime = performance.now();
      const res = RealtimeDiffEngine.createDiff(oldObj, newObj);
      const durationMs = performance.now() - startTime;

      expect(res.ok).toBe(true);
      if (res.ok) {
        console.log(`[STRESS BENCHMARK] 10,000 key object diff took ${durationMs.toFixed(2)}ms, summary:`, res.value.summary);
        expect(res.value.summary.totalKeysCompared).toBe(11000);
        expect(res.value.summary.keysAdded).toBe(1000);
        expect(durationMs).toBeLessThan(15000);
      }
    }, 20000);
  });

  describe('2. Patch Inversion Correctness & 100% Roundtrip Guarantee', () => {
    it('should maintain 100% state restoration roundtrip across 1,000 randomized complex state transformations', () => {
      const roundtrips = 1000;

      for (let i = 0; i < roundtrips; i++) {
        const initialState = {
          user: {
            id: i,
            tokens: ['t1', 't2', 't3'],
            meta: { loginCount: i * 3, lastIp: '192.168.1.1' },
          },
          config: { theme: 'dark', retries: 5 },
          flags: [true, false, true],
        };

        const targetState = {
          user: {
            id: i,
            tokens: ['t1', 't2_updated', 't3', 't4'],
            meta: { loginCount: i * 3 + 1, lastIp: '10.0.0.1', newRole: 'admin' },
          },
          config: { theme: 'light', retries: 5 },
          flags: [false, true],
        };

        // 1. Create Diff
        const diffRes = RealtimeDiffEngine.createDiff(initialState, targetState);
        expect(diffRes.ok).toBe(true);
        if (!diffRes.ok) continue;

        // 2. Apply Forward Patches
        const forwardRes = RealtimeDiffEngine.applyPatch(initialState, diffRes.value.globalPatches);
        expect(forwardRes.ok).toBe(true);
        if (forwardRes.ok) {
          expect(forwardRes.value).toEqual(targetState);
        }

        // 3. Apply Global Inverse Patches
        const rollbackRes = RealtimeDiffEngine.applyPatch(targetState, diffRes.value.globalInversePatches);
        expect(rollbackRes.ok).toBe(true);
        if (rollbackRes.ok) {
          expect(rollbackRes.value).toEqual(initialState);
        }

        // 4. Invert Patches explicitly via invertPatches
        const explicitInvRes = RealtimeDiffEngine.invertPatches(diffRes.value.globalPatches, initialState);
        expect(explicitInvRes.ok).toBe(true);
        if (explicitInvRes.ok) {
          const explicitRollbackRes = RealtimeDiffEngine.applyPatch(targetState, explicitInvRes.value);
          expect(explicitRollbackRes.ok).toBe(true);
          if (explicitRollbackRes.ok) {
            expect(explicitRollbackRes.value).toEqual(initialState);
          }
        }
      }
    });

    it('should handle complex array mutations (splices, appends, deletions) with zero data loss', () => {
      const initialArray = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item_${i}` }));
      const modifiedArray = initialArray.filter((item) => item.id % 2 === 0); // remove odd items
      modifiedArray.push({ id: 9999, name: 'new_item' });
      modifiedArray[0] = { id: 0, name: 'updated_item_0' };

      const diffRes = RealtimeDiffEngine.createDiff(initialArray, modifiedArray);
      expect(diffRes.ok).toBe(true);
      if (diffRes.ok) {
        const forwardRes = RealtimeDiffEngine.applyPatch(initialArray, diffRes.value.globalPatches);
        expect(forwardRes.ok).toBe(true);
        if (forwardRes.ok) {
          expect(forwardRes.value).toEqual(modifiedArray);
        }

        const rollbackRes = RealtimeDiffEngine.applyPatch(modifiedArray, diffRes.value.globalInversePatches);
        expect(rollbackRes.ok).toBe(true);
        if (rollbackRes.ok) {
          expect(rollbackRes.value).toEqual(initialArray);
        }
      }
    });
  });

  describe('3. Memory & Garbage Collection Stability', () => {
    it('should complete 5,000 diff operations without heap inflation or memory leaks', () => {
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 5000; i++) {
        const a = { data: Array.from({ length: 100 }, (_, idx) => idx + i) };
        const b = { data: Array.from({ length: 100 }, (_, idx) => idx + i + 1) };
        RealtimeDiffEngine.createDiff(a, b);
      }

      if (typeof globalThis.gc === 'function') globalThis.gc();
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowthMb = (finalMemory - initialMemory) / (1024 * 1024);

      console.log(`[MEMORY BENCHMARK] Heap delta after 5,000 diff cycles: ${memoryGrowthMb.toFixed(2)} MB`);
      // Heap growth should remain bounded (less than 25MB overall delta after GC or execution)
      expect(memoryGrowthMb).toBeLessThan(25);
    }, 30000);
  });

  describe('4. Boundary & RFC 6901 Escaping Stress', () => {
    it('should correctly handle keys containing slashes, tildes, unicode, and whitespace', () => {
      const oldState = {
        'foo/bar': 1,
        'a~b': 2,
        '~/~1/~0': 3,
        '🔑_emoji': 'value',
        '   whitespace   ': true,
      };

      const newState = {
        'foo/bar': 100,
        'a~b': 200,
        '~/~1/~0': 300,
        '🔑_emoji': 'value_updated',
        '   whitespace   ': false,
      };

      const diffRes = RealtimeDiffEngine.createDiff(oldState, newState);
      expect(diffRes.ok).toBe(true);
      if (diffRes.ok) {
        expect(diffRes.value.globalPatches).toContainEqual({
          op: 'replace',
          path: '/foo~1bar',
          value: 100,
          oldValue: 1,
        });
        expect(diffRes.value.globalPatches).toContainEqual({
          op: 'replace',
          path: '/a~0b',
          value: 200,
          oldValue: 2,
        });
        expect(diffRes.value.globalPatches).toContainEqual({
          op: 'replace',
          path: '/~0~1~01~1~00',
          value: 300,
          oldValue: 3,
        });

        const forward = RealtimeDiffEngine.applyPatch(oldState, diffRes.value.globalPatches);
        expect(forward.ok).toBe(true);
        if (forward.ok) {
          expect(forward.value).toEqual(newState);
        }

        const rollback = RealtimeDiffEngine.applyPatch(newState, diffRes.value.globalInversePatches);
        expect(rollback.ok).toBe(true);
        if (rollback.ok) {
          expect(rollback.value).toEqual(oldState);
        }
      }
    });
  });
});
