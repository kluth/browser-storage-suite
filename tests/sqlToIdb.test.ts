import { describe, it, expect } from 'vitest';
import { translateSqlToIDBCursor, translateSqlToIDBCursorResult } from '../utils/sqlToIdb';

describe('SQL-to-IDBCursor Translator & Execution Profiler (Milestone M3 Suite)', () => {
  describe('1. Dynamic Field Projection Parsing', () => {
    it('should extract specific requested fields for SELECT key, value query', () => {
      const plan = translateSqlToIDBCursor('SELECT key, value FROM storage');
      expect(plan.parsedFields).toEqual(['key', 'value']);
    });

    it('should extract single field projection for SELECT id FROM storage', () => {
      const plan = translateSqlToIDBCursor('SELECT id FROM storage');
      expect(plan.parsedFields).toEqual(['id']);
    });

    it('should default to full field set for SELECT * FROM storage', () => {
      const plan = translateSqlToIDBCursor('SELECT * FROM storage');
      expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
    });

    it('should handle case insensitivity and whitespace in field projection', () => {
      const plan = translateSqlToIDBCursor('   sElEcT   KEY ,   VALUE   fRoM   storage   ');
      expect(plan.parsedFields).toEqual(['key', 'value']);
    });
  });

  describe('2. Scan Strategy & Filter Pattern Extraction', () => {
    it('should parse index scan strategy for key filtering and return parsed fields', () => {
      const plan = translateSqlToIDBCursor("  SELECT * FROM storage WHERE key LIKE 'session_token'  ");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('session_token');
      expect(plan.estimatedCostMs).toBeLessThan(1.0);
      expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
    });

    it('should parse index scan with extra whitespace between LIKE and pattern', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key LIKE    'user_id'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('user_id');
    });

    it('should set INDEX_SCAN for exact equality query on key (WHERE key = ...)', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'auth_token'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('auth_token');
    });

    it('should set INDEX_SCAN for pattern matching query on key (WHERE key LIKE ...)', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key LIKE '%session%'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('%session%');
    });

    it('should set INDEX_SCAN for primary key lookup (WHERE id = ...)', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE id = 'rec_1001'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('rec_1001');
    });

    it('should set FULL_TABLE_SCAN for unindexed field filtering (WHERE value LIKE ...)', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE value LIKE '%admin%'");
      expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
      expect(plan.filterKeyPattern).toBeUndefined();
    });

    it('should fall back to FULL_TABLE_SCAN for unindexed queries and include parsed fields', () => {
      const plan = translateSqlToIDBCursor('SELECT * FROM storage');
      expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
      expect(plan.estimatedCostMs).toBeGreaterThan(1.0);
      expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
      expect(plan.filterKeyPattern).toBeUndefined();
    });

    it('should honor custom indexedFields option when provided', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE category = 'settings'", {
        indexedFields: ['category'],
      });
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('settings');
    });
  });

  describe('3. Dynamic Execution Cost Heuristics & Performance Scaling', () => {
    it('should compute calibrated baseline costs for default totalEntries = 100', () => {
      const indexPlan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'user_id'");
      expect(indexPlan.estimatedCostMs).toBe(0.42);

      const tableScanPlan = translateSqlToIDBCursor('SELECT * FROM storage');
      expect(tableScanPlan.estimatedCostMs).toBe(12.8);
    });

    it('should scale FULL_TABLE_SCAN cost linearly with totalEntries parameter', () => {
      const plan100 = translateSqlToIDBCursor('SELECT * FROM storage', { totalEntries: 100 });
      const plan1000 = translateSqlToIDBCursor('SELECT * FROM storage', { totalEntries: 1000 });
      const plan10000 = translateSqlToIDBCursor('SELECT * FROM storage', { totalEntries: 10000 });

      expect(plan100.estimatedCostMs).toBe(12.8);
      expect(plan1000.estimatedCostMs).toBe(127.1);
      expect(plan10000.estimatedCostMs).toBe(1270.1);
      expect(plan10000.estimatedCostMs).toBeGreaterThan(plan1000.estimatedCostMs);
    });

    it('should calculate higher INDEX_SCAN cost for wildcard pattern matching in large databases', () => {
      const exactPlan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'token'", {
        totalEntries: 5000,
      });
      const wildcardPlan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key LIKE '%token%'", {
        totalEntries: 5000,
      });

      expect(exactPlan.estimatedCostMs).toBe(0.42);
      expect(wildcardPlan.estimatedCostMs).toBe(1.67);
      expect(wildcardPlan.estimatedCostMs).toBeGreaterThan(exactPlan.estimatedCostMs);
    });
  });

  describe('4. Functional Result<T, E> Error Handling', () => {
    it('should return Result.ok with ExecutionPlan for valid queries', () => {
      const result = translateSqlToIDBCursorResult("SELECT key FROM storage WHERE key = 'token'");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.scanStrategy).toBe('INDEX_SCAN');
        expect(result.value.parsedFields).toEqual(['key']);
      }
    });

    it('should return Result.err for empty or whitespace-only queries', () => {
      const emptyRes = translateSqlToIDBCursorResult('');
      expect(emptyRes.ok).toBe(false);
      if (!emptyRes.ok) {
        expect(emptyRes.error.type).toBe('EMPTY_QUERY');
      }

      const whitespaceRes = translateSqlToIDBCursorResult('   \n\t  ');
      expect(whitespaceRes.ok).toBe(false);
    });

    it('should fall back safely in translateSqlToIDBCursor wrapper without throwing exceptions', () => {
      expect(() => {
        const plan = translateSqlToIDBCursor('');
        expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
        expect(plan.estimatedCostMs).toBe(12.8);
      }).not.toThrow();
    });
  });

  describe('5. Complex Clauses & High Throughput Benchmark', () => {
    it('should parse complex queries with ORDER BY and LIMIT clauses', () => {
      const query = "SELECT key, value FROM storage WHERE key LIKE 'pref_%' ORDER BY key DESC LIMIT 50";
      const plan = translateSqlToIDBCursor(query);

      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('pref_%');
      expect(plan.parsedFields).toEqual(['key', 'value']);
    });

    it('should profile 5,000 queries sequentially in under 1,000ms', () => {
      const queries = [
        "SELECT key, value FROM storage WHERE key = 'token'",
        "SELECT * FROM storage WHERE key LIKE '%auth%'",
        "SELECT id FROM storage WHERE value LIKE '%data%'",
        'SELECT * FROM storage',
      ];

      const start = performance.now();
      let lastPlan: ReturnType<typeof translateSqlToIDBCursor> | undefined;
      for (let i = 0; i < 5000; i++) {
        lastPlan = translateSqlToIDBCursor(queries[i % queries.length], { totalEntries: (i % 100) * 10 });
      }
      const duration = performance.now() - start;
      expect(lastPlan?.scanStrategy).toBeDefined();
      expect(duration).toBeLessThan(1000);
    });
  });
});
