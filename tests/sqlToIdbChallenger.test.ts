import { describe, it, expect } from 'vitest';
import {
  parseProjection,
  parseWhereConditions,
  determineScanStrategy,
  extractFilterKeyPattern,
  translateSqlToIDBCursor,
  translateSqlToIDBCursorResult,
} from '../utils/sqlToIdb';

describe('Adversarial Verification Suite for SQL-to-IDBCursor (Challenger 2)', () => {
  describe('1. Field Projection Verification', () => {
    it('handles standard comma-separated fields', () => {
      const plan = translateSqlToIDBCursor('SELECT id, key, value FROM storage');
      expect(plan.parsedFields).toEqual(['id', 'key', 'value']);
    });

    it('handles uppercase/lowercase and irregular whitespace', () => {
      const plan = translateSqlToIDBCursor('   sElEcT   ID  ,   KeY  ,  vAlUe   fRoM   storage   ');
      expect(plan.parsedFields).toEqual(['id', 'key', 'value']);
    });

    it('handles wildcard projection (*)', () => {
      const plan = translateSqlToIDBCursor('SELECT * FROM storage');
      expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
    });

    it('tests aliased fields: SELECT key AS k, value AS v FROM storage', () => {
      const fields = parseProjection('SELECT key AS k, value AS v FROM storage');
      // If aliased, raw field should either be extracted or cleanly parsed as original field / alias
      // Currently returns ['key as k', 'value as v']
      expect(fields).toEqual(['key', 'value']); // Expecting clean field extraction
    });
  });

  describe('2. WHERE Operators Verification', () => {
    it('handles = operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'auth_token'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('auth_token');
    });

    it('handles LIKE operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key LIKE 'session_%'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('session_%');
    });

    it('tests > range operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key > 'user_100'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('user_100');
    });

    it('tests < range operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key < 'user_999'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('user_999');
    });

    it('tests >= range operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key >= 'a'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('a');
    });

    it('tests <= range operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key <= 'z'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('z');
    });

    it('tests IN operator on indexed field: WHERE key IN (\'token1\', \'token2\')', () => {
      const conds = parseWhereConditions("SELECT * FROM storage WHERE key IN ('token1', 'token2')");
      expect(conds.length).toBeGreaterThan(0);
      expect(conds[0].operator).toBe('IN');
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key IN ('token1', 'token2')");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
    });

    it('tests != operator on indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key != 'expired'");
      expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
    });

    it('tests IS NULL operator', () => {
      const conds = parseWhereConditions('SELECT * FROM storage WHERE key IS NULL');
      expect(conds.length).toBeGreaterThan(0);
      expect(conds[0].operator).toBe('IS NULL');
    });
  });

  describe('3. Multiple Conditions (AND / OR) & Scan Strategy Classification', () => {
    it('handles multiple AND conditions with at least one indexed field', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'session' AND value = 'active'");
      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('session');
    });

    it('handles OR condition where one side is unindexed (must be FULL_TABLE_SCAN)', () => {
      const plan = translateSqlToIDBCursor("SELECT * FROM storage WHERE key = 'session' OR value = 'active'");
      // Because value is unindexed, an OR condition cannot be satisfied by scanning index 'key' alone
      expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
    });
  });

  describe('4. Syntax Error & Invalid Query Handling', () => {
    it('returns Result.err SYNTAX_ERROR for invalid non-SELECT SQL statements', () => {
      const result = translateSqlToIDBCursorResult('DELETE FROM storage WHERE key = 1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('SYNTAX_ERROR');
      }
    });

    it('returns Result.err SYNTAX_ERROR for completely malformed query strings', () => {
      const result = translateSqlToIDBCursorResult('INVALID SQL STRING HERE');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('SYNTAX_ERROR');
      }
    });
  });
});
