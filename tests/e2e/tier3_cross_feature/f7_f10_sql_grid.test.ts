import { describe, it, expect } from 'vitest';
import { translateSqlToIDBCursor } from '../../../utils/sqlToIdb';
import { GridRow } from '../../../components/VirtualizedDataGrid';

describe('Tier 3 Interaction: F7 (SQL Translator) + F10 (Virtualized Data Grid)', () => {
  it('should translate SQL query and filter Virtualized Data Grid rows according to plan strategy', () => {
    const rawStorageEntries = [
      { key: 'user_session', value: '{"id": 1, "role": "admin"}', type: 'JSON' },
      { key: 'cart_item_1', value: '{"price": 99.99}', type: 'JSON' },
      { key: 'user_pref_theme', value: 'dark', type: 'String' },
      { key: 'app_version', value: '2.4.0', type: 'String' },
    ];

    // F7: Translate SQL with key pattern filter
    const sqlQuery = "SELECT * FROM storage WHERE key LIKE 'user%'";
    const executionPlan = translateSqlToIDBCursor(sqlQuery);

    expect(executionPlan.scanStrategy).toBe('INDEX_SCAN');
    expect(executionPlan.filterKeyPattern).toBe('user%');

    // Convert matching entries into F10 GridRow dataset based on execution plan filter pattern
    const pattern = new RegExp('^' + (executionPlan.filterKeyPattern || '').replace(/%/g, '.*'), 'i');
    const filteredEntries = rawStorageEntries.filter((e) => pattern.test(e.key));

    const gridRows: GridRow[] = filteredEntries.map((e, idx) => ({
      id: idx + 1,
      key: e.key,
      value: e.value,
      type: e.type,
      sizeBytes: new Blob([e.key + e.value]).size,
    }));

    expect(gridRows.length).toBe(2);
    expect(gridRows[0].key).toBe('user_session');
    expect(gridRows[1].key).toBe('user_pref_theme');
    expect(gridRows[0].sizeBytes).toBeGreaterThan(0);
  });

  it('should perform FULL_TABLE_SCAN when query has no indexed key filter', () => {
    const sqlQuery = 'SELECT * FROM storage';
    const executionPlan = translateSqlToIDBCursor(sqlQuery);

    expect(executionPlan.scanStrategy).toBe('FULL_TABLE_SCAN');
    expect(executionPlan.filterKeyPattern).toBeUndefined();
    expect(executionPlan.estimatedCostMs).toBeGreaterThan(1);
  });
});
