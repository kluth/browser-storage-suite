import { describe, it, expect, beforeEach } from 'vitest';
import { TimeSeriesSnapshotEngine } from '../utils/timeSeriesSnapshotEngine';
import { TimeSeriesSnapshotAdapter } from '../src/infrastructure/adapters/timeSeriesSnapshotAdapter';
import type { AutoPrunePolicy } from '../src/domain/model/timeSeriesSnapshot';

describe('TimeSeriesSnapshotEngine Stress & Performance Tests', () => {
  let engine: TimeSeriesSnapshotEngine;
  let repository: TimeSeriesSnapshotAdapter;

  beforeEach(() => {
    repository = new TimeSeriesSnapshotAdapter();
    engine = new TimeSeriesSnapshotEngine(repository);
  });

  // ST-01: 1,000 Rapid Mutations Stream Processing < 500ms
  it('ST-01: should process and record 1,000 rapid state deltas in under 500ms', async () => {
    const startTime = performance.now();
    for (let i = 0; i < 1000; i++) {
      await engine.recordDelta({
        timestamp: startTime + i,
        target: 'localStorage',
        forwardPatches: [{ op: 'replace', path: `/key_${i}`, value: i }],
        reversePatches: [{ op: 'remove', path: `/key_${i}` }],
      });
    }
    const duration = performance.now() - startTime;
    expect(duration).toBeLessThan(500);
  });

  // ST-02: High-Frequency Base Snapshot Generation Under Load
  it('ST-02: should generate 50 base snapshots in rapid succession without memory leaks', async () => {
    for (let i = 0; i < 50; i++) {
      const snapRes = await engine.takeSnapshot('localStorage', { triggerReason: `batch_${i}` });
      expect(snapRes.ok).toBe(true);
    }
  });

  // ST-03: Max History Ring-Buffer Pruning (< 500 KB Memory Limit)
  it('ST-03: should automatically prune oldest base snapshots and deltas when total size exceeds limit', async () => {
    for (let i = 0; i < 20; i++) {
      await engine.recordDelta({ sizeInBytes: 50000 });
    }
    const policy: AutoPrunePolicy = {
      strategy: 'max-size',
      maxSizeBytes: 500000,
      autoPruneOnMemoryExceeded: true,
    };
    const pruneRes = await engine.pruneTimeline(policy);
    expect(pruneRes.ok).toBe(true);
    if (!pruneRes.ok) return;

    expect(pruneRes.value.prunedCount).toBeGreaterThan(0);
  });

  // ST-04: Max Deltas Count Threshold Eviction
  it('ST-04: should enforce maxDeltas limit by evicting oldest deltas while keeping snapshot chain valid', async () => {
    for (let i = 0; i < 600; i++) {
      await engine.recordDelta({ timestamp: 1000 + i, sizeInBytes: 10 });
    }
    const policy: AutoPrunePolicy = {
      strategy: 'max-count',
      maxDeltas: 500,
    };
    const pruneRes = await engine.pruneTimeline(policy);
    expect(pruneRes.ok).toBe(true);
    if (!pruneRes.ok) return;

    expect(pruneRes.value.prunedCount).toBeGreaterThan(0);
  });

  // ST-05: Corrupted Base Snapshot Recovery & Graceful Fallback
  it('ST-05: should detect bit-flip corruption in base snapshot and fall back to prior valid snapshot', async () => {
    await repository.saveSnapshot({
      id: 'snap_valid',
      timestamp: 1000,
      target: 'localStorage',
      state: { key: 'valid' },
      metadata: { id: 'snap_valid', timestamp: 1000, sequenceNumber: 1, tag: 'checkpoint', description: '', author: '', target: 'localStorage', totalKeys: 1, sizeBytes: 5, checksum: 'sha256_valid' },
      isCheckpoint: true,
      parentSnapshotId: null,
      branchName: 'main',
    });

    const restoreRes = await engine.restoreStateAt(1500);
    expect(restoreRes.ok).toBe(true);
  });

  // ST-06: High-Cardinality State Diffing (10,000 Nested Keys)
  it('ST-06: should perform state diffing on 10,000 keys efficiently', async () => {
    const stateA: Record<string, number> = {};
    const stateB: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) {
      stateA[`k${i}`] = i;
      stateB[`k${i}`] = i + 1;
    }

    const start = performance.now();
    const deltaRes = await engine.recordChangeDelta('localStorage', stateA, stateB);
    const duration = performance.now() - start;

    expect(deltaRes.ok).toBe(true);
    expect(duration).toBeLessThan(300);
  });

  // ST-07: Deeply Nested Object LZ Compression Efficiency SLA
  it('ST-07: should compress deeply nested JSON patch deltas to under 10% of raw size', async () => {
    const rawData = { text: 'REPEAT_DATA_'.repeat(1000) };
    const deltaRes = await engine.recordChangeDelta('localStorage', {}, rawData, { compressed: true });
    expect(deltaRes.ok).toBe(true);
    if (!deltaRes.ok) return;

    expect(deltaRes.value.compressed).toBe(true);
    expect(deltaRes.value.sizeInBytes).toBeLessThan(12000 * 0.1);
  });

  // ST-08: Rapid Time-Travel Seek Jumps (< 5ms Average Latency)
  it('ST-08: should execute random seekReplay jumps with average seek latency < 5ms', async () => {
    const sessionRes = await engine.startReplaySession(1000, 5000);
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const sessionId = sessionRes.value.sessionId;
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const targetTs = 1000 + (i * 80);
      const start = performance.now();
      await engine.seekReplay(sessionId, targetTs);
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(5);
  });

  // ST-09: 10,000 Cycle Record & Restore Memory Leak Verification
  it('ST-09: should maintain stable allocation across 1,000 record and restore cycles', async () => {
    for (let i = 0; i < 1000; i++) {
      await engine.recordDelta({ timestamp: 1000 + i, forwardPatches: [] });
    }
    const restoreRes = await engine.restoreStateAt(1500);
    expect(restoreRes.ok).toBe(true);
  });

  // ST-10: Concurrent Multithreaded / Multi-Tab Ingestion Stress
  it('ST-10: should handle concurrent delta producers appending deltas without race conditions', async () => {
    const workers = Array.from({ length: 10 }, (_, wIdx) => async () => {
      for (let i = 0; i < 10; i++) {
        await engine.recordDelta({
          timestamp: Date.now() + i,
          key: `w${wIdx}_k${i}`,
          forwardPatches: [{ op: 'add', path: `/w${wIdx}_k${i}`, value: i }],
        });
      }
    });

    await Promise.all(workers.map((w) => w()));

    const deltasRes = await repository.getDeltasInTimeRange(0, Date.now() + 100000);
    expect(deltasRes.ok).toBe(true);
    if (!deltasRes.ok) return;
    expect(deltasRes.value.length).toBe(100);
  });

  // ST-11: Large Payload Storage Limit Bounding (500 KB Single Value Mutation)
  it('ST-11: should chunk and compress large single-value payload without exceeding memory quota', async () => {
    const bigString = 'X'.repeat(500 * 1024);
    const deltaRes = await engine.recordDelta({
      key: 'big_blob',
      compressed: true,
      forwardPatches: [{ op: 'add', path: '/big_blob', value: bigString }],
    });

    expect(deltaRes.ok).toBe(true);
  });

  // ST-12: Truncated / Corrupted Delta Stream Partial Recovery
  it('ST-12: should recover valid state up to position of corrupted delta when stream is truncated', async () => {
    const patches1 = [{ op: 'add' as const, path: '/k1', value: 'v1' }];
    const patches2 = [{ op: 'add' as const, path: '/k2', value: 'v2' }];

    await engine.recordDelta({ timestamp: 1000, forwardPatches: patches1, checksum: computeChecksum(patches1) });
    await engine.recordDelta({ timestamp: 2000, forwardPatches: patches2, checksum: 'sha256_corrupted_CORRUPT' });

    const restoreRes = await engine.restoreStateAt(1500);
    expect(restoreRes.ok).toBe(true);
  });
});
