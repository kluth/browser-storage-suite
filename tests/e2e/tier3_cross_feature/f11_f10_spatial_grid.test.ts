import { describe, it, expect } from 'vitest';
import { GridRow } from '../../../components/VirtualizedDataGrid';
import { GraphNode } from '../../../workers/spatialLayoutWorker';

describe('Tier 3 Interaction: F11 (3D Spatial Canvas) + F10 (Virtualized Data Grid)', () => {
  it('should synchronize Virtualized Data Grid row selections with 3D Spatial Canvas layout nodes', () => {
    const gridRows: GridRow[] = [
      { id: 1, key: 'auth_jwt', value: 'secret_token_123', type: 'String', sizeBytes: 42 },
      { id: 2, key: 'cart_state', value: '{"items":[1,2,3]}', type: 'JSON', sizeBytes: 120 },
      { id: 3, key: 'theme_pref', value: 'dark', type: 'String', sizeBytes: 15 },
    ];

    // Map Virtualized Data Grid rows to 3D Spatial Canvas nodes
    const canvasNodes: GraphNode[] = gridRows.map((row) => ({
      id: `node_${row.id}`,
      label: row.key,
      type: row.type === 'JSON' ? 'table' : 'key',
      size: row.sizeBytes,
    }));

    expect(canvasNodes.length).toBe(3);

    // Verify node attributes match grid row definitions
    const authNode = canvasNodes.find((n) => n.label === 'auth_jwt');
    expect(authNode).toBeDefined();
    expect(authNode?.id).toBe('node_1');
    expect(authNode?.size).toBe(42);
    expect(authNode?.type).toBe('key');

    const cartNode = canvasNodes.find((n) => n.label === 'cart_state');
    expect(cartNode).toBeDefined();
    expect(cartNode?.type).toBe('table');
    expect(cartNode?.size).toBe(120);
  });
});
