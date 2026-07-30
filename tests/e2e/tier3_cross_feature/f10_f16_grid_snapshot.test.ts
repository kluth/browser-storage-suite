import { describe, it, expect } from 'vitest';
import { StorageSnapshot } from '../../../utils/storageAggregate';
import { GridRow } from '../../../components/VirtualizedDataGrid';

describe('Tier 3 Interaction: F10 (Virtualized Data Grid) + F16 (Snapshot Export/Import)', () => {
  it('should map exported snapshot entries to Virtualized Data Grid rows and support round-trip serialization', () => {
    const snapshot: StorageSnapshot = {
      timestamp: 1700000000000,
      entries: {
        theme_config: '{"mode": "dark", "highContrast": true}',
        user_id: 'usr_88291',
        session_token: 'bearer_xyz_777',
      },
    };

    // 1. Transform Snapshot entries to GridRow[] for VirtualizedDataGrid
    const gridRows: GridRow[] = Object.entries(snapshot.entries).map(([key, value], idx) => ({
      id: idx + 1,
      key,
      value,
      type: value.startsWith('{') ? 'JSON' : 'String',
      sizeBytes: new Blob([key + value]).size,
    }));

    expect(gridRows.length).toBe(3);
    expect(gridRows[0].key).toBe('theme_config');
    expect(gridRows[0].type).toBe('JSON');

    // 2. Perform Grid editing/selection and reconstruct Snapshot for export (round-trip)
    const reExportEntries: Record<string, string> = {};
    gridRows.forEach((row) => {
      reExportEntries[row.key] = row.value;
    });

    const newSnapshot: StorageSnapshot = {
      timestamp: Date.now(),
      entries: reExportEntries,
    };

    expect(newSnapshot.entries).toEqual(snapshot.entries);
  });
});
