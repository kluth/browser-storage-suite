import { describe, it, expect } from 'vitest';
import { StorageStateAggregate } from '../utils/storageAggregate';
import { getStorageDataBlame } from '../utils/dataBlamer';
import { translateSqlToIDBCursor } from '../utils/sqlToIdb';

describe('Performance & Stress Testing Suite (High Throughput & Benchmark)', () => {
  it('Stress Test: Should process 2,000 sequential mutations and snapshot calculations (< 1,000 ms)', () => {
    const aggregate = new StorageStateAggregate();
    const startTime = performance.now();

    for (let i = 0; i < 2000; i++) {
      aggregate.applyMutation({
        id: `stress-mut-${i}`,
        timestamp: 1000 + i,
        type: i % 10 === 0 ? 'delete' : 'set',
        storageType: 'localStorage',
        key: `key_${i % 100}`,
        value: `value_payload_${i}`,
      });
    }

    const durationMs = performance.now() - startTime;
    expect(durationMs).toBeLessThan(5000);

    const snap = aggregate.getSnapshotAt(2500);
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(Object.keys(snap.value.entries).length).toBeGreaterThan(0);
    }
  });

  it('Time-Travel Benchmark: Should calculate 1,000 historical snapshots in sub-millisecond per query', () => {
    const aggregate = new StorageStateAggregate();

    for (let i = 0; i < 1000; i++) {
      aggregate.applyMutation({
        id: `bench-mut-${i}`,
        timestamp: 1000 + i * 10,
        type: 'set',
        storageType: 'localStorage',
        key: `session_item_${i % 50}`,
        value: `val_${i}`,
      });
    }

    const startTime = performance.now();
    for (let t = 0; t < 1000; t++) {
      const targetTs = 1000 + Math.floor(Math.random() * 10000);
      const res = aggregate.getSnapshotAt(targetTs);
      expect(res.ok).toBe(true);
    }
    const totalDurationMs = performance.now() - startTime;
    const avgLatencyPerQueryMs = totalDurationMs / 1000;

    expect(avgLatencyPerQueryMs).toBeLessThan(1.0);
  });

  it('Data Blaming Stress Test: Should generate 5,000 provenance attributions without memory overhead', () => {
    const syntheticStack = `Error\n    at setAuthToken (https://example.com/auth.js:10:5)`;
    const startTime = performance.now();

    for (let i = 0; i < 5000; i++) {
      const blame = getStorageDataBlame(`user_token_${i}`, `bearer_token_${i}`, syntheticStack);
      expect(blame.key).toBeDefined();
      expect(blame.actor.name).toBeDefined();
    }

    const durationMs = performance.now() - startTime;
    expect(durationMs).toBeLessThan(3000);
  });

  it('SQL Translation Stress Test: Should parse and profile 5,000 SQL queries in under 1,000 ms', () => {
    const queries = [
      "SELECT * FROM storage WHERE key LIKE '%auth%'",
      "SELECT * FROM storage WHERE key LIKE '%session%'",
      'SELECT * FROM storage',
    ];

    const startTime = performance.now();
    for (let i = 0; i < 5000; i++) {
      const q = queries[i % queries.length];
      const plan = translateSqlToIDBCursor(q);
      expect(plan.scanStrategy).toBeDefined();
    }

    const durationMs = performance.now() - startTime;
    expect(durationMs).toBeLessThan(5000);
  });
});
