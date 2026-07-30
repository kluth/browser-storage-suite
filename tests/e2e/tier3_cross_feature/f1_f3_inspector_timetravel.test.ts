import { describe, it, expect } from 'vitest';
import { StorageStateAggregate, StorageMutation } from '../../../utils/storageAggregate';
import { StorageItem } from '../../../utils/browserApi';

describe('Tier 3 Interaction: F1 (Storage Inspector) + F3 (State Aggregate Time Travel)', () => {
  it('should track live inspected storage items in state aggregate timeline and compute accurate snapshots', () => {
    const aggregate = new StorageStateAggregate();
    const startTime = 1000;

    // Simulate F1 Storage Inspector detecting items and logging timeline mutations (F3)
    const inspectedItems: StorageItem[] = [
      { key: 'user_session', value: 'token_123', type: 'local', domain: 'example.com' },
      { key: 'theme', value: 'dark', type: 'local', domain: 'example.com' },
    ];

    // Apply first set of mutations
    inspectedItems.forEach((item, idx) => {
      const mutation: StorageMutation = {
        id: `mut-${idx + 1}`,
        timestamp: startTime + idx * 100,
        type: 'set',
        storageType: 'localStorage',
        key: item.key,
        value: item.value,
      };
      const res = aggregate.applyMutation(mutation);
      expect(res.ok).toBe(true);
    });

    // Verify snapshot at t=1100 contains both items
    const snapshotT1100 = aggregate.getSnapshotAt(1100);
    expect(snapshotT1100.ok).toBe(true);
    if (snapshotT1100.ok) {
      expect(snapshotT1100.value.entries['user_session']).toBe('token_123');
      expect(snapshotT1100.value.entries['theme']).toBe('dark');
    }

    // Live inspector performs a delete action at t=1500
    const deleteMutation: StorageMutation = {
      id: 'mut-3',
      timestamp: 1500,
      type: 'delete',
      storageType: 'localStorage',
      key: 'user_session',
    };
    aggregate.applyMutation(deleteMutation);

    // Time-travel back to t=1100: user_session should still exist
    const pastSnapshot = aggregate.getSnapshotAt(1100);
    expect(pastSnapshot.ok).toBe(true);
    if (pastSnapshot.ok) {
      expect(pastSnapshot.value.entries['user_session']).toBe('token_123');
    }

    // Time-travel to present (t=1500): user_session should be deleted
    const presentSnapshot = aggregate.getSnapshotAt(1500);
    expect(presentSnapshot.ok).toBe(true);
    if (presentSnapshot.ok) {
      expect(presentSnapshot.value.entries['user_session']).toBeUndefined();
      expect(presentSnapshot.value.entries['theme']).toBe('dark');
    }
  });

  it('should handle out-of-order inspector mutation arrivals gracefully during time-travel aggregation', () => {
    const aggregate = new StorageStateAggregate();

    const mut1: StorageMutation = { id: 'm1', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'counter', value: '2' };
    const mut2: StorageMutation = { id: 'm2', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'counter', value: '1' };

    aggregate.applyMutation(mut1);
    aggregate.applyMutation(mut2); // Out of order timestamp

    const snap1000 = aggregate.getSnapshotAt(1000);
    expect(snap1000.ok).toBe(true);
    if (snap1000.ok) {
      expect(snap1000.value.entries['counter']).toBe('1');
    }

    const snap2000 = aggregate.getSnapshotAt(2000);
    expect(snap2000.ok).toBe(true);
    if (snap2000.ok) {
      expect(snap2000.value.entries['counter']).toBe('2');
    }
  });
});
