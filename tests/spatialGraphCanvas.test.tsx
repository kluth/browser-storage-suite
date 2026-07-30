import { describe, it, expect } from 'vitest';
import {
  getNodeColor,
  getDefaultGraphNodes,
  deriveGraphNodesFromEntries,
  generateExplodingChildNodes,
  checkWebGlSupport,
} from '../components/SpatialGraphCanvas';
import { GraphNode } from '../workers/spatialLayoutWorker';

describe('SpatialGraphCanvas Pure Logic Suite (M2)', () => {
  it('should compute correct node colors based on storage node type', () => {
    expect(getNodeColor('storage')).toBe('#38bdf8');
    expect(getNodeColor('table')).toBe('#10b981');
    expect(getNodeColor('entity')).toBe('#a855f7');
    expect(getNodeColor('key')).toBe('#f59e0b');
    expect(getNodeColor('unknown')).toBe('#ec4899');
  });

  it('should generate dynamic default storage engine graph nodes without static coordinate hardcoding', () => {
    const defaultNodes = getDefaultGraphNodes();
    expect(defaultNodes).toHaveLength(5);
    expect(defaultNodes[0].label).toBe('localStorage Engine');
    expect(defaultNodes[0].type).toBe('storage');

    defaultNodes.forEach((node) => {
      // @ts-expect-error position should not exist on GraphNode
      expect(node.position).toBeUndefined();
    });
  });

  it('should derive graph nodes dynamically from inspected browser storage entries', () => {
    const entries = [
      { key: 'user_jwt', value: 'secret_token_val', target: 'localStorage' as const },
      { key: 'cart_data', value: '{"items":[1,2]}', target: 'indexedDB' as const },
    ];

    const nodes = deriveGraphNodesFromEntries(entries);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].label).toBe('user_jwt');
    expect(nodes[0].type).toBe('entity');
    expect(nodes[1].label).toBe('cart_data');
    expect(nodes[1].type).toBe('table');
  });

  it('should generate exploding child nodes and 3D link connections for a target storage engine', () => {
    const idbExplosion = generateExplodingChildNodes('node_indexedDB');
    expect(idbExplosion.nodes.length).toBeGreaterThan(1);
    expect(idbExplosion.links.length).toBeGreaterThan(0);
    expect(idbExplosion.nodes.some((n) => n.label.toUpperCase().includes('INDEXEDDB'))).toBe(true);
    expect(idbExplosion.links[0].source).toBe('node_indexedDB');
  });

  it('should evaluate WebGL context availability safely', () => {
    const isSupported = checkWebGlSupport();
    expect(typeof isSupported).toBe('boolean');
  });
});
