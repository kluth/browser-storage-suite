import { describe, it, expect, beforeEach } from 'vitest';
import { TimeSeriesSnapshotAdapter } from '../src/infrastructure/adapters/timeSeriesSnapshotAdapter';
import type { StorageSnapshot, StateDelta, TimelineBranch } from '../src/domain/model/timeSeriesSnapshot';

describe('TimeSeriesSnapshotAdapter Tests', () => {
  let adapter: TimeSeriesSnapshotAdapter;

  beforeEach(() => {
    adapter = new TimeSeriesSnapshotAdapter();
  });

  const dummySnapshot: StorageSnapshot = {
    id: 's1',
    timestamp: 1000,
    target: 'localStorage',
    state: { key: 'val' },
    metadata: {
      id: 's1',
      timestamp: 1000,
      sequenceNumber: 1,
      tag: 'checkpoint',
      description: 'd',
      author: 'a',
      target: 'localStorage',
      totalKeys: 1,
      sizeBytes: 10,
      checksum: 'sha256_s1',
    },
    isCheckpoint: true,
    parentSnapshotId: null,
    branchName: 'main',
  };

  const dummyDelta: StateDelta = {
    id: 'd1',
    fromSnapshotId: 's1',
    toSnapshotId: 's2',
    timestamp: 1500,
    target: 'localStorage',
    forwardPatches: [{ op: 'replace', path: '/key', value: 'val2' }],
    reversePatches: [{ op: 'replace', path: '/key', value: 'val' }],
    affectedKeys: ['key'],
    changeSummary: { added: 0, modified: 1, removed: 0 },
  };

  const dummyBranch: TimelineBranch = {
    name: 'feature-1',
    createdAt: 1000,
    forkSnapshotId: 's1',
    parentBranchName: 'main',
    headSnapshotId: 's1',
    snapshotIds: ['s1'],
    isCurrent: true,
  };

  it('AT-01: should save and retrieve snapshot', async () => {
    const saveRes = await adapter.saveSnapshot(dummySnapshot);
    expect(saveRes.ok).toBe(true);

    const getRes = await adapter.getSnapshot('s1');
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value).toEqual(dummySnapshot);
  });

  it('AT-02: should support saveBaseSnapshot alias', async () => {
    const saveRes = await adapter.saveBaseSnapshot('s1', dummySnapshot);
    expect(saveRes.ok).toBe(true);
  });

  it('AT-03: should support loadBaseSnapshot alias', async () => {
    await adapter.saveSnapshot(dummySnapshot);
    const loadRes = await adapter.loadBaseSnapshot('s1');
    expect(loadRes.ok).toBe(true);
    if (!loadRes.ok) return;
    expect(loadRes.value?.id).toBe('s1');
  });

  it('AT-04: should filter getSnapshotsByTarget correctly', async () => {
    await adapter.saveSnapshot(dummySnapshot);
    const listRes = await adapter.getSnapshotsByTarget('localStorage');
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value.length).toBe(1);
  });

  it('AT-05: should save and retrieve delta', async () => {
    const saveRes = await adapter.saveDelta(dummyDelta);
    expect(saveRes.ok).toBe(true);

    const getRes = await adapter.getDelta('d1');
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value).toEqual(dummyDelta);
  });

  it('AT-06: should getDeltasBetween snapshot ids', async () => {
    await adapter.saveDelta(dummyDelta);
    const listRes = await adapter.getDeltasBetween('s1', 's2');
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value.length).toBe(1);
  });

  it('AT-07: should getDeltasInTimeRange', async () => {
    await adapter.saveDelta(dummyDelta);
    const listRes = await adapter.getDeltasInTimeRange(1000, 2000);
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value.length).toBe(1);
  });

  it('AT-08: should save and get branch', async () => {
    const saveRes = await adapter.saveBranch(dummyBranch);
    expect(saveRes.ok).toBe(true);

    const getRes = await adapter.getBranch('feature-1');
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value?.name).toBe('feature-1');
  });

  it('AT-09: should getAllBranches', async () => {
    await adapter.saveBranch(dummyBranch);
    const listRes = await adapter.getAllBranches();
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value.length).toBe(1);
  });

  it('AT-10: should deleteSnapshots', async () => {
    await adapter.saveSnapshot(dummySnapshot);
    const delRes = await adapter.deleteSnapshots(['s1']);
    expect(delRes.ok).toBe(true);
    if (!delRes.ok) return;
    expect(delRes.value).toBe(1);
  });

  it('AT-11: should deleteDeltas', async () => {
    await adapter.saveDelta(dummyDelta);
    const delRes = await adapter.deleteDeltas(['d1']);
    expect(delRes.ok).toBe(true);
    if (!delRes.ok) return;
    expect(delRes.value).toBe(1);
  });

  it('AT-12: should deleteTimeline', async () => {
    await adapter.saveBranch(dummyBranch);
    const delRes = await adapter.deleteTimeline('feature-1');
    expect(delRes.ok).toBe(true);
  });

  it('AT-13: should clearRepository completely', async () => {
    await adapter.saveSnapshot(dummySnapshot);
    await adapter.saveDelta(dummyDelta);
    await adapter.saveBranch(dummyBranch);

    const clearRes = await adapter.clearRepository();
    expect(clearRes.ok).toBe(true);

    const branchesRes = await adapter.getAllBranches();
    if (!branchesRes.ok) return;
    expect(branchesRes.value.length).toBe(0);
  });

  it('AT-14: should cover globalThis.window storage paths when window is mocked', async () => {
    const mockStorage = {
      getItem: (k: string) => (k === 'bsse_snapshot_s1' ? JSON.stringify(dummySnapshot) : null),
      setItem: () => {},
      removeItem: () => {},
      length: 0,
      key: () => null,
      clear: () => {},
    };
    (globalThis as any).window = {
      localStorage: mockStorage,
      sessionStorage: mockStorage,
    };

    try {
      const getRes = await adapter.getSnapshot('s1');
      expect(getRes.ok).toBe(true);
      if (!getRes.ok) return;
      expect(getRes.value?.id).toBe('s1');
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('AT-15: should handle storage exception on getItem and return zero-throw Result.err', async () => {
    const failingStorage = {
      getItem: () => {
        throw new Error('Access denied');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    (globalThis as any).window = {
      localStorage: failingStorage,
      sessionStorage: failingStorage,
    };

    try {
      const getRes = await adapter.getSnapshot('s1');
      expect(getRes.ok).toBe(false);
      if (!getRes.ok) {
        expect(getRes.error.kind).toBe('STORAGE_RESTORE_FAILED');
      }
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('AT-16: should handle storage exception on setItem and return zero-throw Result.err', async () => {
    const failingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    (globalThis as any).window = {
      localStorage: failingStorage,
      sessionStorage: failingStorage,
    };

    try {
      const saveRes = await adapter.saveSnapshot(dummySnapshot);
      expect(saveRes.ok).toBe(false);
      if (!saveRes.ok) {
        expect(saveRes.error.kind).toBe('STORAGE_RESTORE_FAILED');
      }
    } finally {
      delete (globalThis as any).window;
    }
  });
});
