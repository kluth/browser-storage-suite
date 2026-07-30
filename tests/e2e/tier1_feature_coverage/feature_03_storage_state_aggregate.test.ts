import { describe, it, expect } from 'vitest';
import { StorageStateAggregate, StorageMutation } from '../../../utils/storageAggregate';

describe('Feature 03: Storage State Aggregate & Time Travel', () => {
  it('3.1 should apply chronological mutations and compute snapshot at current time', () => {
    const aggregate = new StorageStateAggregate();
    const now = 1000;

    const mut1: StorageMutation = {
      id: 'm1',
      timestamp: now,
      type: 'set',
      storageType: 'localStorage',
      key: 'user_name',
      value: 'Alice',
    };

    const res = aggregate.applyMutation(mut1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.timestamp).toBe(now);
      expect(res.value.entries).toEqual({ user_name: 'Alice' });
    }
  });

  it('3.2 should perform time travel debugging to historical timestamps', () => {
    const aggregate = new StorageStateAggregate();

    aggregate.applyMutation({
      id: 'm1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'token',
      value: 'v1',
    });

    aggregate.applyMutation({
      id: 'm2',
      timestamp: 2000,
      type: 'set',
      storageType: 'localStorage',
      key: 'token',
      value: 'v2',
    });

    aggregate.applyMutation({
      id: 'm3',
      timestamp: 3000,
      type: 'set',
      storageType: 'localStorage',
      key: 'theme',
      value: 'dark',
    });

    // Time travel to t = 1500
    const snap1500 = aggregate.getSnapshotAt(1500);
    expect(snap1500.ok).toBe(true);
    if (snap1500.ok) {
      expect(snap1500.value.entries).toEqual({ token: 'v1' });
    }

    // Time travel to t = 2500
    const snap2500 = aggregate.getSnapshotAt(2500);
    expect(snap2500.ok).toBe(true);
    if (snap2500.ok) {
      expect(snap2500.value.entries).toEqual({ token: 'v2' });
    }

    // Time travel to t = 3500
    const snap3500 = aggregate.getSnapshotAt(3500);
    expect(snap3500.ok).toBe(true);
    if (snap3500.ok) {
      expect(snap3500.value.entries).toEqual({ token: 'v2', theme: 'dark' });
    }
  });

  it('3.3 should handle delete and clear mutation types properly in timeline', () => {
    const aggregate = new StorageStateAggregate();

    aggregate.applyMutation({
      id: 'm1',
      timestamp: 100,
      type: 'set',
      storageType: 'localStorage',
      key: 'k1',
      value: 'v1',
    });

    aggregate.applyMutation({
      id: 'm2',
      timestamp: 200,
      type: 'set',
      storageType: 'localStorage',
      key: 'k2',
      value: 'v2',
    });

    // Delete k1 at t = 300
    aggregate.applyMutation({
      id: 'm3',
      timestamp: 300,
      type: 'delete',
      storageType: 'localStorage',
      key: 'k1',
    });

    const snap300 = aggregate.getSnapshotAt(300);
    expect(snap300.ok).toBe(true);
    if (snap300.ok) {
      expect(snap300.value.entries).toEqual({ k2: 'v2' });
    }

    // Clear all at t = 400
    aggregate.applyMutation({
      id: 'm4',
      timestamp: 400,
      type: 'clear',
      storageType: 'localStorage',
      key: '',
    });

    const snap400 = aggregate.getSnapshotAt(400);
    expect(snap400.ok).toBe(true);
    if (snap400.ok) {
      expect(snap400.value.entries).toEqual({});
    }
  });

  it('3.4 should sort out-of-order mutations chronologically by timestamp', () => {
    const aggregate = new StorageStateAggregate();

    // Insert t=3000 first, then t=1000
    aggregate.applyMutation({
      id: 'm2',
      timestamp: 3000,
      type: 'set',
      storageType: 'localStorage',
      key: 'status',
      value: 'finished',
    });

    aggregate.applyMutation({
      id: 'm1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'status',
      value: 'started',
    });

    const snap1500 = aggregate.getSnapshotAt(1500);
    expect(snap1500.ok).toBe(true);
    if (snap1500.ok) {
      expect(snap1500.value.entries).toEqual({ status: 'started' });
    }

    const snap3500 = aggregate.getSnapshotAt(3500);
    expect(snap3500.ok).toBe(true);
    if (snap3500.ok) {
      expect(snap3500.value.entries).toEqual({ status: 'finished' });
    }
  });

  it('3.5 should return SNAPSHOT_NOT_FOUND error when timeline is empty', () => {
    const aggregate = new StorageStateAggregate();
    const res = aggregate.getSnapshotAt(1000);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toEqual({ type: 'SNAPSHOT_NOT_FOUND', timestamp: 1000 });
    }
  });

  it('3.6 should return INVALID_MUTATION error when key is missing for set or delete operation', () => {
    const aggregate = new StorageStateAggregate();

    const invalidSetRes = aggregate.applyMutation({
      id: 'inv1',
      timestamp: 100,
      type: 'set',
      storageType: 'localStorage',
      key: '',
      value: 'val',
    });

    expect(invalidSetRes.ok).toBe(false);
    if (!invalidSetRes.ok) {
      expect(invalidSetRes.error.type).toBe('INVALID_MUTATION');
      expect(invalidSetRes.error.message).toContain('Key is required');
    }
  });
});
