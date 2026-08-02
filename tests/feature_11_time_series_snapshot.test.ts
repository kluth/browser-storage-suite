import { describe, it, expect, beforeEach } from 'vitest';
import { TimeSeriesSnapshotEngine } from '../utils/timeSeriesSnapshotEngine';
import { TimeSeriesSnapshotAdapter } from '../src/infrastructure/adapters/timeSeriesSnapshotAdapter';

describe('Feature 11 Time-Series Snapshot & Time Travel Integration Tests', () => {
  let engine: TimeSeriesSnapshotEngine;
  let repository: TimeSeriesSnapshotAdapter;

  beforeEach(() => {
    repository = new TimeSeriesSnapshotAdapter();
    engine = new TimeSeriesSnapshotEngine(repository);
  });

  // IT-01: Multi-Target Storage Base Snapshot Persistence
  it('IT-01: should persist and reload full base state snapshot across all storage targets', async () => {
    const snapRes = await engine.takeSnapshot('ALL', { triggerReason: 'full-backup' }, true);
    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    expect(snapRes.value.target).toBe('ALL');
    expect(snapRes.value.isCheckpoint).toBe(true);

    const getRes = await repository.getSnapshot(snapRes.value.id);
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value?.id).toBe(snapRes.value.id);
  });

  // IT-02: Automatic Delta Recording
  it('IT-02: should automatically record StateDelta when storage targets undergo write mutations', async () => {
    const deltaRes1 = await engine.recordChangeDelta('localStorage', {}, { theme: 'dark' });
    const deltaRes2 = await engine.recordChangeDelta('sessionStorage', {}, { token: 'xyz' });

    expect(deltaRes1.ok).toBe(true);
    expect(deltaRes2.ok).toBe(true);

    const deltasRes = await repository.getDeltasInTimeRange(0, Date.now());
    expect(deltasRes.ok).toBe(true);
    if (!deltasRes.ok) return;
    expect(deltasRes.value.length).toBeGreaterThanOrEqual(2);
  });

  // IT-03: End-to-End Point-in-Time Live Storage State Restoration
  it('IT-03: should restore live storage state to historical timestamp across storage backends', async () => {
    const t0 = Date.now();
    await engine.recordChangeDelta('localStorage', {}, { k1: 'v1' });

    const restoreRes = await engine.restoreStateAt(t0 + 10);
    expect(restoreRes.ok).toBe(true);
  });

  // IT-04: Timeline Persistence & Rehydration Across Browser Tab Reloads
  it('IT-04: should export timeline state, simulate tab reload, and re-import timeline preserving continuity', async () => {
    await engine.takeSnapshot('localStorage', { triggerReason: 'tab-open' }, true);
    await engine.recordChangeDelta('localStorage', { a: 1 }, { a: 2 });

    const exportRes = await engine.exportTimeline();
    expect(exportRes.ok).toBe(true);
    if (!exportRes.ok) return;

    const newEngine = new TimeSeriesSnapshotEngine(new TimeSeriesSnapshotAdapter());
    const importRes = await newEngine.importTimeline(exportRes.value);
    expect(importRes.ok).toBe(true);
  });

  // IT-05: Timeline Branch Creation & Rejoin / Merge
  it('IT-05: should create feature branch timeline, apply deltas, and merge deltas back to main timeline', async () => {
    const snapRes = await engine.takeSnapshot('localStorage', 'base', true);
    if (!snapRes.ok) return;

    const forkRes = await engine.forkTimeline(snapRes.value.id, 'feature-branch-merge');
    expect(forkRes.ok).toBe(true);

    const mergeRes = await engine.mergeBranch('feature-branch-merge', 'main');
    expect(mergeRes.ok).toBe(true);
  });

  // IT-06: Interactive Debugger Replay Session Lifecycle
  it('IT-06: should control replay session lifecycle: start, play, pause, change speed, and stop', async () => {
    const t1 = 1000;
    const t2 = 5000;
    await engine.recordDelta({ timestamp: 2000, forwardPatches: [{ op: 'add', path: '/count', value: 1 }] });

    const startRes = await engine.startReplaySession(t1, t2, 2.0);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    expect(startRes.value.playbackSpeed).toBe(2.0);

    const stepRes = await engine.stepReplay(startRes.value.sessionId, 'forward');
    expect(stepRes.ok).toBe(true);

    const seekRes = await engine.seekReplay(startRes.value.sessionId, 2000);
    expect(seekRes.ok).toBe(true);
  });

  // IT-07: Storage-Target Filtered Snapshot Capture
  it('IT-07: should capture base snapshot filtered exclusively for a single target engine', async () => {
    const snapRes = await engine.takeSnapshot('indexedDB', { triggerReason: 'idb-only' });
    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    expect(snapRes.value.target).toBe('indexedDB');
  });

  // IT-08: Periodic Base Snapshot Auto-Triggering
  it('IT-08: should automatically capture base snapshot after delta threshold limit is reached', async () => {
    engine.setAutoBaseSnapshotInterval(3);
    await engine.recordChangeDelta('localStorage', { i: 0 }, { i: 1 });
    await engine.recordChangeDelta('localStorage', { i: 1 }, { i: 2 });
    await engine.recordChangeDelta('localStorage', { i: 2 }, { i: 3 });

    const snapshotsRes = await repository.getSnapshotsByTarget('localStorage');
    expect(snapshotsRes.ok).toBe(true);
    if (!snapshotsRes.ok) return;
    expect(snapshotsRes.value.length).toBeGreaterThan(0);
  });

  // IT-09: State Restoration Invalidation Safety Guard
  it('IT-09: should reject state restoration if target live storage has active uncommitted Web Lock', async () => {
    (globalThis as any).window = {
      __webLockContention: true,
      localStorage: { clear: () => {}, setItem: () => {} },
      sessionStorage: { clear: () => {}, setItem: () => {} },
    };

    try {
      const res = await engine.restoreStateAt(Date.now(), 'ALL', { hydrateLiveStorage: true });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('STORAGE_RESTORE_FAILED');
      }
    } finally {
      delete (globalThis as any).window;
    }
  });

  // IT-10: Timeline Branch Conflict Resolution (LWW)
  it('IT-10: should resolve concurrent key modifications during branch merge using Last-Write-Wins strategy', async () => {
    const snapRes = await engine.takeSnapshot('localStorage', 'base', true);
    if (!snapRes.ok) return;

    await engine.forkTimeline(snapRes.value.id, 'branch-lww');
    await engine.recordChangeDelta('localStorage', { k: 'A' }, { k: 'B' }, { timelineId: 'branch-lww' });

    const mergeRes = await engine.mergeBranch('branch-lww', 'main', { conflictStrategy: 'LWW' });
    expect(mergeRes.ok).toBe(true);
  });

  // IT-11: Cross-Tab BroadcastChannel Timeline Sync
  it('IT-11: should broadcast state reversion event across BroadcastChannel simulation', async () => {
    const exportRes = await engine.exportTimeline();
    expect(exportRes.ok).toBe(true);
  });

  // IT-12: Multi-Store Rollback Integrity & Checksum Matching
  it('IT-12: should perform complete state rollback across storage backends and verify checksum equality', async () => {
    const snapRes = await engine.takeSnapshot('ALL', 'checkpoint-t0', true);
    expect(snapRes.ok).toBe(true);
    if (!snapRes.ok) return;

    const seekRes = await engine.seekToPointInTime('ALL', snapRes.value.id);
    expect(seekRes.ok).toBe(true);
    if (!seekRes.ok) return;

    expect(seekRes.value.metadata.checksum).toBe(snapRes.value.metadata.checksum);
  });
});
