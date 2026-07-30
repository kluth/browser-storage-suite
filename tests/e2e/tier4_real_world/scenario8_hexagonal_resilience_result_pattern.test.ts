import { describe, it, expect } from 'vitest';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { translateSqlToIDBCursor, ExecutionPlan } from '../../../utils/sqlToIdb';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate, StorageMutation, StorageError } from '../../../utils/storageAggregate';

class InMemoryResilienceAdapter implements StorageRepositoryPort {
  private store: Map<string, string> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.entries()).map(([k, v]) => ({ key: k, value: v, target }));
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(key.value, value.value);
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(key.value);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    this.store.clear();
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 8: Hexagonal Domain Validation & Result Pattern Resilience (F12, F7, F6, F3)', () => {
  it('should enforce domain key/value validation in Hexagonal Service without throwing control flow exceptions', async () => {
    const adapter = new InMemoryResilienceAdapter();
    const service = new StorageApplicationService(adapter);

    const emptyKeyRes = await service.setStorageItem('localStorage', '', 'valid_value');
    expect(emptyKeyRes.ok).toBe(false);
    if (!emptyKeyRes.ok) {
      expect(emptyKeyRes.error).toBe('StorageKey cannot be empty');
    }

    const whitespaceKeyRes = await service.setStorageItem('localStorage', '   \t  ', 'valid_value');
    expect(whitespaceKeyRes.ok).toBe(false);
    if (!whitespaceKeyRes.ok) {
      expect(whitespaceKeyRes.error).toBe('StorageKey cannot be empty');
    }

    const removeEmptyKeyRes = await service.removeStorageItem('localStorage', '');
    expect(removeEmptyKeyRes.ok).toBe(false);
    if (!removeEmptyKeyRes.ok) {
      expect(removeEmptyKeyRes.error).toBe('StorageKey cannot be empty');
    }

    const domainKeyRes = StorageKey.create('');
    expect(domainKeyRes.ok).toBe(false);

    const validKeyRes = StorageKey.create('  valid_key_name  ');
    expect(validKeyRes.ok).toBe(true);
    if (validKeyRes.ok) {
      expect(validKeyRes.value.value).toBe('valid_key_name');
    }

    const valueRes = StorageValue.create('hello world');
    expect(valueRes.ok).toBe(true);
    if (valueRes.ok) {
      expect(valueRes.value.value).toBe('hello world');
      expect(valueRes.value.sizeInBytes).toBe(11);
    }
  });

  it('should handle malformed SQL queries and return fallback execution plans in SQL-to-IDBCursor Translator', () => {
    const emptyQueryPlan: ExecutionPlan = translateSqlToIDBCursor('');
    expect(emptyQueryPlan.scanStrategy).toBe('FULL_TABLE_SCAN');
    expect(emptyQueryPlan.originalQuery).toBe('');

    const garbageQueryPlan: ExecutionPlan = translateSqlToIDBCursor('FOOBAR INVALID SQL SYNTAX !!! *** 123');
    expect(garbageQueryPlan.scanStrategy).toBe('FULL_TABLE_SCAN');
    expect(garbageQueryPlan.estimatedCostMs).toBe(12.8);

    const matchCaseQueryPlan: ExecutionPlan = translateSqlToIDBCursor("select * from store where key like '%test%'");
    expect(matchCaseQueryPlan.scanStrategy).toBe('INDEX_SCAN');
    expect(matchCaseQueryPlan.filterKeyPattern).toBe('%test%');
  });

  it('should handle unknown tool names and invalid arguments cleanly in MCP Server Adapter', () => {
    const aggregate = new StorageStateAggregate();
    const mcpAdapter = new McpServerAdapter(aggregate);

    const unknownToolResult = mcpAdapter.handleToolCall('non_existent_mcp_tool', { foo: 'bar' });
    expect(unknownToolResult.ok).toBe(false);
    if (!unknownToolResult.ok) {
      expect(unknownToolResult.error).toBe('Unknown MCP tool call: non_existent_mcp_tool');
    }

    const emptySnapshotResult = mcpAdapter.handleToolCall('get_storage_snapshot', { timestamp: 999999 });
    expect(emptySnapshotResult.ok).toBe(false);
    if (!emptySnapshotResult.ok) {
      expect(emptySnapshotResult.error).toBe('SNAPSHOT_NOT_FOUND');
    }
  });

  it('should reject invalid mutations in StorageStateAggregate using explicit StorageError union', () => {
    const aggregate = new StorageStateAggregate();

    const invalidSetMutation: StorageMutation = {
      id: 'bad-1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: '',
      value: 'val',
    };

    const res1 = aggregate.applyMutation(invalidSetMutation);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.error.type).toBe('INVALID_MUTATION');
      if (res1.error.type === 'INVALID_MUTATION') {
        expect(res1.error.message).toBe('Key is required for set/delete operations');
      }
    }

    const invalidDeleteMutation: StorageMutation = {
      id: 'bad-2',
      timestamp: 2000,
      type: 'delete',
      storageType: 'localStorage',
      key: '',
    };

    const res2 = aggregate.applyMutation(invalidDeleteMutation);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error.type).toBe('INVALID_MUTATION');
    }

    const validClearMutation: StorageMutation = {
      id: 'clear-1',
      timestamp: 3000,
      type: 'clear',
      storageType: 'localStorage',
      key: '',
    };

    const res3 = aggregate.applyMutation(validClearMutation);
    expect(res3.ok).toBe(true);
  });
});
