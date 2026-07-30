import { describe, it, expect } from 'vitest';
import { translateSqlToIDBCursor } from '../../../utils/sqlToIdb';

describe('Feature 07: SQL-to-IDBCursor Translator', () => {
  it('7.1 should translate WHERE KEY = queries to INDEX_SCAN strategy', () => {
    const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'user_id'");

    expect(plan.originalQuery).toBe("SELECT * FROM storage WHERE key = 'user_id'");
    expect(plan.scanStrategy).toBe('INDEX_SCAN');
    expect(plan.estimatedCostMs).toBe(0.42);
    expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
  });

  it('7.2 should translate WHERE KEY LIKE queries and extract filter key pattern', () => {
    const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key LIKE '%auth_token%'");

    expect(plan.scanStrategy).toBe('INDEX_SCAN');
    expect(plan.filterKeyPattern).toBe('%auth_token%');
    expect(plan.estimatedCostMs).toBe(0.42);
  });

  it('7.3 should translate queries without KEY filters to FULL_TABLE_SCAN strategy', () => {
    const plan = translateSqlToIDBCursor('SELECT * FROM storage');

    expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
    expect(plan.filterKeyPattern).toBeUndefined();
    expect(plan.estimatedCostMs).toBe(12.8);
  });

  it('7.4 should handle SQL case-insensitivity and leading/trailing whitespaces', () => {
    const plan = translateSqlToIDBCursor("   select key, value from STORAGE where KEY like '%CART%'   ");

    expect(plan.scanStrategy).toBe('INDEX_SCAN');
    expect(plan.filterKeyPattern).toBe('%CART%');
    expect(plan.estimatedCostMs).toBe(0.42);
  });

  it('7.5 should handle double quotes around LIKE pattern correctly', () => {
    const plan = translateSqlToIDBCursor('SELECT * FROM storage WHERE key LIKE "%session%"');

    expect(plan.scanStrategy).toBe('INDEX_SCAN');
    expect(plan.filterKeyPattern).toBe('%session%');
  });

  it('7.6 should return complete ExecutionPlan interface structure for complex query', () => {
    const query = "SELECT id, key, value FROM storage WHERE key LIKE 'pref_%'";
    const plan = translateSqlToIDBCursor(query);

    expect(plan).toHaveProperty('originalQuery', query);
    expect(plan).toHaveProperty('parsedFields');
    expect(plan).toHaveProperty('scanStrategy');
    expect(plan).toHaveProperty('estimatedCostMs');
    expect(typeof plan.estimatedCostMs).toBe('number');
  });
});
