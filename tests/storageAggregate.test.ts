import { describe, it, expect } from 'vitest';
import { StorageStateAggregate, StorageMutation } from '../utils/storageAggregate';

describe('StorageStateAggregate (Bullet-Proof Stryker Mutant Killers)', () => {
  it('should apply set mutations and return updated snapshot using Result pattern', () => {
    const aggregate = new StorageStateAggregate();
    const mutation: StorageMutation = {
      id: 'mut-1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'user_session',
      value: 'token_abc123',
    };

    const result = aggregate.applyMutation(mutation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries['user_session']).toBe('token_abc123');
      expect(result.value.timestamp).toBe(1000);
    }
  });

  it('should not update entries if set mutation has undefined value', () => {
    const aggregate = new StorageStateAggregate();
    const mutation: StorageMutation = {
      id: 'mut-undef',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'undef_key',
      value: undefined,
    };

    aggregate.applyMutation(mutation);
    const snap = aggregate.getSnapshotAt(1500);
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(snap.value.entries['undef_key']).toBeUndefined();
    }
  });

  it('should reject set/delete mutations with missing key and return exact error message', () => {
    const aggregate = new StorageStateAggregate();
    const invalidMut: StorageMutation = {
      id: 'mut-bad',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: '',
      value: 'val',
    };

    const res = aggregate.applyMutation(invalidMut);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe('INVALID_MUTATION');
      if (res.error.type === 'INVALID_MUTATION') {
        expect(res.error.message).toBe('Key is required for set/delete operations');
      }
    }
  });

  it('should return SNAPSHOT_NOT_FOUND error on empty timeline', () => {
    const aggregate = new StorageStateAggregate();
    const res = aggregate.getSnapshotAt(1000);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe('SNAPSHOT_NOT_FOUND');
      expect(res.error.timestamp).toBe(1000);
    }
  });

  it('should correctly sort out-of-order mutations by timestamp', () => {
    const aggregate = new StorageStateAggregate();

    aggregate.applyMutation({
      id: 'mut-2',
      timestamp: 2000,
      type: 'set',
      storageType: 'localStorage',
      key: 'status',
      value: 'active',
    });

    aggregate.applyMutation({
      id: 'mut-1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'status',
      value: 'pending',
    });

    const snapAt1500 = aggregate.getSnapshotAt(1500);
    expect(snapAt1500.ok).toBe(true);
    if (snapAt1500.ok) {
      expect(snapAt1500.value.entries['status']).toBe('pending');
    }

    const snapAt2500 = aggregate.getSnapshotAt(2500);
    expect(snapAt2500.ok).toBe(true);
    if (snapAt2500.ok) {
      expect(snapAt2500.value.entries['status']).toBe('active');
    }
  });

  it('should handle delete and clear mutation types accurately', () => {
    const aggregate = new StorageStateAggregate();

    aggregate.applyMutation({
      id: 'mut-1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'k1',
      value: 'v1',
    });

    aggregate.applyMutation({
      id: 'mut-2',
      timestamp: 1500,
      type: 'set',
      storageType: 'localStorage',
      key: 'k2',
      value: 'v2',
    });

    aggregate.applyMutation({
      id: 'mut-3',
      timestamp: 2000,
      type: 'delete',
      storageType: 'localStorage',
      key: 'k1',
    });

    const snapAfterDelete = aggregate.getSnapshotAt(2200);
    expect(snapAfterDelete.ok).toBe(true);
    if (snapAfterDelete.ok) {
      expect(snapAfterDelete.value.entries['k1']).toBeUndefined();
      expect(snapAfterDelete.value.entries['k2']).toBe('v2');
    }

    aggregate.applyMutation({
      id: 'mut-4',
      timestamp: 3000,
      type: 'clear',
      storageType: 'localStorage',
      key: '',
    });

    const snapAfterClear = aggregate.getSnapshotAt(3500);
    expect(snapAfterClear.ok).toBe(true);
    if (snapAfterClear.ok) {
      expect(Object.keys(snapAfterClear.value.entries).length).toBe(0);
    }
  });
});
