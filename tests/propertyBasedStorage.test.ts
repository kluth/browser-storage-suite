import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { StorageStateAggregate } from '../utils/storageAggregate';

describe('Property-Based Testing (Storage Invariants & Cross-Storage Consistency)', () => {
  it('Invariant: Independent set mutations on unique keys yield identical final storage state regardless of insertion order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 10 }),
            value: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { selector: (item) => item.key, minLength: 5, maxLength: 20 }
        ),
        (mutations) => {
          const agg1 = new StorageStateAggregate();
          const agg2 = new StorageStateAggregate();

          // Apply forward order to agg1 with timestamp = 1000
          mutations.forEach((m, idx) => {
            agg1.applyMutation({
              id: `mut-${idx}`,
              timestamp: 1000,
              type: 'set',
              storageType: 'localStorage',
              key: m.key,
              value: m.value,
            });
          });

          // Apply in reverse order to agg2 with timestamp = 1000
          [...mutations].reverse().forEach((m, idx) => {
            agg2.applyMutation({
              id: `mut-rev-${idx}`,
              timestamp: 1000,
              type: 'set',
              storageType: 'localStorage',
              key: m.key,
              value: m.value,
            });
          });

          const snap1 = agg1.getSnapshotAt(2000);
          const snap2 = agg2.getSnapshotAt(2000);

          expect(snap1.ok).toBe(true);
          expect(snap2.ok).toBe(true);

          if (snap1.ok && snap2.ok) {
            const keys1 = Object.keys(snap1.value.entries).sort();
            const keys2 = Object.keys(snap2.value.entries).sort();

            expect(keys1).toEqual(keys2);
            keys1.forEach((k) => {
              expect(snap1.value.entries[k]).toBe(snap2.value.entries[k]);
            });
          }
        }
      )
    );
  });
});
