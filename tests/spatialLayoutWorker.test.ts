import { describe, it, expect } from 'vitest';
import {
  GraphNode,
  GraphLink,
  calculateSpatialLayout,
  handleWorkerMessage,
  WorkerLayoutResponse,
} from '../workers/spatialLayoutWorker';

describe('Spatial Layout Worker Engine (M2)', () => {
  it('should return Result.ok with calculated 3D positions for valid nodes and links', () => {
    const nodes: GraphNode[] = [
      { id: 'root', label: 'LocalStorage (Root)', type: 'storage', size: 10 },
      { id: 'jwt', label: 'UserSession (JWT)', type: 'entity', size: 5 },
      { id: 'cart', label: 'CartItems (IndexedDB)', type: 'table', size: 8 },
    ];
    const links: GraphLink[] = [
      { source: 'root', target: 'jwt', strength: 1.0 },
      { source: 'root', target: 'cart', strength: 0.5 },
    ];

    const res = calculateSpatialLayout(nodes, links);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.type).toBe('LAYOUT_COMPLETE');
      expect(res.value.positions).toHaveLength(3);
      expect(res.value.positions[0].id).toBe('root');
      expect(res.value.positions[1].id).toBe('jwt');
      expect(res.value.positions[2].id).toBe('cart');

      res.value.positions.forEach((pos) => {
        expect(typeof pos.x).toBe('number');
        expect(typeof pos.y).toBe('number');
        expect(typeof pos.z).toBe('number');
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
        expect(isFinite(pos.z)).toBe(true);
      });
    }
  });

  it('should gracefully protect against zero-length nodes array without division by zero NaN', () => {
    const res = calculateSpatialLayout([], []);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.type).toBe('LAYOUT_COMPLETE');
      expect(res.value.positions).toEqual([]);
    }
  });

  it('should return Result.err for invalid or non-array payload', () => {
    // @ts-expect-error testing invalid payload
    const res = calculateSpatialLayout(null, []);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('nodes must be an array');
    }
  });

  it('should process handleWorkerMessage payload and return Result wrapped response', () => {
    const payload = {
      nodes: [{ id: 'n1', label: 'Node 1', type: 'key' as const, size: 2 }],
      links: [],
    };

    const res = handleWorkerMessage(payload);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.positions).toHaveLength(1);
      expect(res.value.positions[0].id).toBe('n1');
    }
  });

  it('should apply force-directed simulation forces so linked nodes interact physically', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', label: 'Node 1', type: 'storage', size: 10 },
      { id: 'n2', label: 'Node 2', type: 'storage', size: 10 },
      { id: 'n3', label: 'Node 3', type: 'storage', size: 10 },
    ];
    // Strong link between n1 and n2, n3 is unlinked
    const links: GraphLink[] = [{ source: 'n1', target: 'n2', strength: 2.0 }];

    const res = calculateSpatialLayout(nodes, links);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const p1 = res.value.positions.find((p) => p.id === 'n1')!;
      const p2 = res.value.positions.find((p) => p.id === 'n2')!;
      const p3 = res.value.positions.find((p) => p.id === 'n3')!;

      const dist12 = Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
      const dist13 = Math.hypot(p1.x - p3.x, p1.y - p3.y, p1.z - p3.z);

      // Linked nodes should be pulled closer than unlinked nodes
      expect(dist12).toBeLessThan(dist13);
    }
  });
});
