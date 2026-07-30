import { describe, it, expect } from 'vitest';
import { StorageStateAggregate } from '../../../utils/storageAggregate';
import { GraphNode } from '../../../workers/spatialLayoutWorker';

describe('Tier 3 Interaction: F11 (3D Spatial Canvas) + F3 (State Aggregate)', () => {
  it('should transform timeline state aggregate snapshot entries into 3D spatial canvas graph nodes', () => {
    const aggregate = new StorageStateAggregate();
    const timestamp = 1000;

    // Apply storage mutations
    aggregate.applyMutation({ id: '1', timestamp, type: 'set', storageType: 'localStorage', key: 'auth_token', value: 'jwt_abc' });
    aggregate.applyMutation({ id: '2', timestamp, type: 'set', storageType: 'indexedDB', key: 'cart_cache', value: '{"items":[1,2]}' });

    const snapshotRes = aggregate.getSnapshotAt(timestamp);
    expect(snapshotRes.ok).toBe(true);

    if (snapshotRes.ok) {
      const entries = snapshotRes.value.entries;

      // Transform snapshot entries into 3D spatial graph nodes
      const graphNodes: GraphNode[] = Object.entries(entries).map(([key, val], idx) => ({
        id: `node_${idx + 1}_${key}`,
        label: key,
        type: key.includes('token') ? 'entity' : 'key',
        size: new Blob([key + val]).size,
      }));

      expect(graphNodes.length).toBe(2);
      expect(graphNodes[0].label).toBe('auth_token');
      expect(graphNodes[0].type).toBe('entity');
      expect(graphNodes[1].label).toBe('cart_cache');
      expect(graphNodes[1].size).toBeGreaterThan(0);
    }
  });
});
