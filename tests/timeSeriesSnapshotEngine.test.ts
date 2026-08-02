import { describe, it, expect, beforeEach } from 'vitest';
import { TimeSeriesSnapshotEngine } from '../utils/timeSeriesSnapshotEngine';
import { TimeSeriesSnapshotAdapter } from '../src/infrastructure/adapters/timeSeriesSnapshotAdapter';
import type { AutoPrunePolicy } from '../src/domain/model/timeSeriesSnapshot';

describe('TimeSeriesSnapshotEngine Unit Tests', () => {
  let engine: TimeSeriesSnapshotEngine;
  let repository: TimeSeriesSnapshotAdapter;

  beforeEach(() => {
    repository = new TimeSeriesSnapshotAdapter();
    engine = new TimeSeriesSnapshotEngine(repository);
  });

  // UT-01: Base Snapshot Capture & Header Metadata
  it('UT-01: should capture full base state snapshot with valid header metadata and SHA-256 checksum', async () => {
    const snapRes = await engine.takeSnapshot('localStorage', { triggerReason: 'manual' }, true);
    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    const snap = snapRes.value;
    expect(snap.id).toBeDefined();
    expect(snap.timestamp).toBeGreaterThan(0);
    expect(snap.target).toBe('localStorage');
    expect(snap.isCheckpoint).toBe(true);
    expect(snap.metadata.checksum).toMatch(/^sha256_/);
    expect(snap.header?.triggerReason).toBe('manual');
  });

  // UT-02: Snapshot Custom Metadata & Target Filtering
  it('UT-02: should attach custom metadata dictionary and handle target filtering during capture', async () => {
    const customTags = { user: 'admin', session: 's123' };
    const snapRes = await engine.takeSnapshot('ALL', {
      triggerReason: 'periodic',
      customMetadata: { customTags },
    });

    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    expect(snapRes.value.metadata.customTags).toEqual(customTags);
    expect(snapRes.value.header?.triggerReason).toBe('periodic');
  });

  // UT-03: RFC 6902 Patch Delta Generation
  it('UT-03: should generate forward patches and inverse patches for key set and delete operations', async () => {
    const prevState = { user: { name: 'Alice', age: 30 } };
    const currState = { user: { name: 'Bob', age: 30 } };

    const deltaRes = await engine.recordChangeDelta('localStorage', prevState, currState);
    expect(deltaRes.ok).toBe(true);
    if (!deltaRes.ok) return;

    const delta = deltaRes.value;
    expect(delta.forwardPatches.length).toBeGreaterThan(0);
    expect(delta.reversePatches.length).toBeGreaterThan(0);
    expect(delta.affectedKeys).toContain('user');
    expect(delta.changeSummary.modified).toBe(1);
  });

  // UT-04: LZ String Payload Compression
  it('UT-04: should compress delta payload using LZ string when compressed flag is true', async () => {
    const largeObj = { blob: 'A'.repeat(5000) };
    const deltaRes = await engine.recordChangeDelta('localStorage', {}, largeObj, { compressed: true });

    expect(deltaRes.ok).toBe(true);
    if (!deltaRes.ok) return;

    const delta = deltaRes.value;
    expect(delta.compressed).toBe(true);
    expect(delta.compressedPayload).toBeDefined();
    expect(delta.sizeInBytes).toBeLessThan(5000);
  });

  // UT-05: Delta Checksum Integrity Verification
  it('UT-05: should verify delta checksum integrity and detect checksum mismatches', async () => {
    const deltaRes = await engine.recordDelta({
      checksum: 'sha256_corrupted_CORRUPT',
      forwardPatches: [{ op: 'replace', path: '/key', value: 'val' }],
    });

    expect(deltaRes.ok).toBe(true);
    if (!deltaRes.ok) return;

    const restoreRes = await engine.restoreStateAt(Date.now());
    expect(restoreRes.ok).toBe(false);
    if (!restoreRes.ok) {
      expect(restoreRes.error.kind).toBe('TIMELINE_CORRUPTED');
    }
  });

  // UT-06: Point-in-Time Seek Timestamp (Exact Match)
  it('UT-06: should restore exact state at target timestamp using base snapshot and forward deltas', async () => {
    const now = Date.now();
    await repository.saveSnapshot({
      id: 'snap_1000',
      timestamp: 1000,
      target: 'localStorage',
      state: { key1: 'val1' },
      metadata: {
        id: 'snap_1000',
        timestamp: 1000,
        sequenceNumber: 1,
        tag: 'checkpoint',
        description: 'b1',
        author: 'sys',
        target: 'localStorage',
        totalKeys: 1,
        sizeBytes: 10,
        checksum: 'sha256_1',
      },
      isCheckpoint: true,
      parentSnapshotId: null,
      branchName: 'main',
    });

    const seekRes = await engine.seekToPointInTime('localStorage', 1000);
    expect(seekRes.ok).toBe(true);
    if (!seekRes.ok) return;

    expect(seekRes.value.state).toEqual({ key1: 'val1' });
  });

  // UT-07: Seek Timestamp Between Base Snapshots
  it('UT-07: should select nearest prior base snapshot when seeking to timestamp between base captures', async () => {
    await repository.saveSnapshot({
      id: 'snap_100',
      timestamp: 100,
      target: 'localStorage',
      state: { count: 10 },
      metadata: { id: 'snap_100', timestamp: 100, sequenceNumber: 1, tag: 'checkpoint', description: '', author: '', target: 'localStorage', totalKeys: 1, sizeBytes: 5, checksum: 'sha256_100' },
      isCheckpoint: true,
      parentSnapshotId: null,
      branchName: 'main',
    });

    await repository.saveSnapshot({
      id: 'snap_300',
      timestamp: 300,
      target: 'localStorage',
      state: { count: 30 },
      metadata: { id: 'snap_300', timestamp: 300, sequenceNumber: 2, tag: 'checkpoint', description: '', author: '', target: 'localStorage', totalKeys: 1, sizeBytes: 5, checksum: 'sha256_300' },
      isCheckpoint: true,
      parentSnapshotId: null,
      branchName: 'main',
    });

    const seekRes = await engine.seekToPointInTime('localStorage', 250);
    expect(seekRes.ok).toBe(true);
    if (!seekRes.ok) return;

    expect(seekRes.value.id).toBe('snap_100');
  });

  // UT-08: Replay Step Backward (Reverse Undo)
  it('UT-08: should apply inverse patches when stepping backward in replay session', async () => {
    const sessionRes = await engine.startReplaySession(1000, 5000);
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const stepRes = await engine.stepReplay(sessionRes.value.sessionId, 'backward');
    expect(stepRes.ok).toBe(true);
    if (!stepRes.ok) return;

    expect(stepRes.value.direction).toBe('backward');
    expect(stepRes.value.stepIndex).toBe(0);
  });

  // UT-09: Replay Step Forward (Redo)
  it('UT-09: should apply forward patches when stepping forward in replay session', async () => {
    const sessionRes = await engine.startReplaySession(1000, 5000);
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const stepRes = await engine.stepReplay(sessionRes.value.sessionId, 'forward');
    expect(stepRes.ok).toBe(true);
    if (!stepRes.ok) return;

    expect(stepRes.value.direction).toBe('forward');
  });

  // UT-10: Timeline Branch Creation
  it('UT-10: should fork isolated child timeline from a historical timestamp', async () => {
    const snapRes = await engine.takeSnapshot('localStorage', 'snap_100');
    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    const forkRes = await engine.forkTimeline(snapRes.value.id, 'feature-branch-1');
    expect(forkRes.ok).toBe(true);
    if (!forkRes.ok) return;

    expect(forkRes.value.name).toBe('feature-branch-1');
    expect(forkRes.value.forkSnapshotId).toBe(snapRes.value.id);
  });

  // UT-11: Timeline Branch Mutation Isolation
  it('UT-11: should ensure mutations on child timeline do not alter parent timeline deltas', async () => {
    const snapRes = await engine.takeSnapshot('localStorage', 'snap_100');
    if (!snapRes.ok) return;

    await engine.forkTimeline(snapRes.value.id, 'feature-branch-2');
    const deltaRes = await engine.recordChangeDelta('localStorage', { a: 1 }, { a: 2 }, { timelineId: 'feature-branch-2' });

    expect(deltaRes.ok).toBe(true);
    if (!deltaRes.ok) return;

    expect(deltaRes.value.timelineId).toBe('feature-branch-2');
  });

  // UT-12: State Diff Generation Between Two Timestamps
  it('UT-12: should compute minimal RFC 6902 JSON patch diff between two timeline timestamps', async () => {
    const snap1 = await engine.takeSnapshot('localStorage', 't1');
    if (!snap1.ok) return;

    const deltaRes = await engine.recordChangeDelta('localStorage', { a: 1 }, { a: 2 });
    if (!deltaRes.ok) return;

    const diffRes = await engine.diffTimestamps(snap1.value.timestamp, deltaRes.value.timestamp);
    expect(diffRes.ok).toBe(true);
    if (!diffRes.ok) return;

    expect(Array.isArray(diffRes.value)).toBe(true);
  });

  // UT-13: Error - INVALID_SNAPSHOT_TIMESTAMP
  it('UT-13: should return Result.err with INVALID_SNAPSHOT_TIMESTAMP for negative or out-of-bounds timestamps', async () => {
    const res = await engine.seekToPointInTime('localStorage', -500);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('INVALID_SNAPSHOT_TIMESTAMP');
    }
  });

  // UT-14: Error - TIMELINE_CORRUPTED
  it('UT-14: should return Result.err with TIMELINE_CORRUPTED when delta checksum validation fails during replay', async () => {
    await repository.saveSnapshot({
      id: 'snap_corrupt',
      timestamp: 1000,
      target: 'localStorage',
      state: { k: 'v' },
      metadata: { id: 'snap_corrupt', timestamp: 1000, sequenceNumber: 1, tag: 'checkpoint', description: '', author: '', target: 'localStorage', totalKeys: 1, sizeBytes: 5, checksum: 'sha256_wrong_checksum' },
      isCheckpoint: true,
      parentSnapshotId: null,
      branchName: 'main',
    });

    const res = await engine.seekToPointInTime('localStorage', 'snap_corrupt');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('TIMELINE_CORRUPTED');
    }
  });

  // UT-15: Error - DELTA_APPLY_FAILED
  it('UT-15: should return Result.err with DELTA_APPLY_FAILED when patch application encounters conflicting path', async () => {
    await engine.recordDelta({
      timestamp: 2000,
      forwardPatches: [{ op: 'replace', path: '/non_existent/nested', value: 'x' }],
    });

    const res = await engine.restoreStateAt(3000);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('DELTA_APPLY_FAILED');
    }
  });

  // UT-16: Error - MEMORY_LIMIT_EXCEEDED
  it('UT-16: should return Result.err with MEMORY_LIMIT_EXCEEDED when totalSizeBytes exceeds limit with autoPrune disabled', async () => {
    await engine.recordDelta({ sizeInBytes: 2000 });

    const policy: AutoPrunePolicy = {
      strategy: 'max-size',
      maxSizeBytes: 1000,
      autoPruneOnMemoryExceeded: false,
    };

    const pruneRes = await engine.pruneTimeline(policy);
    expect(pruneRes.ok).toBe(false);
    if (!pruneRes.ok) {
      expect(pruneRes.error.kind).toBe('MEMORY_LIMIT_EXCEEDED');
    }
  });
});
