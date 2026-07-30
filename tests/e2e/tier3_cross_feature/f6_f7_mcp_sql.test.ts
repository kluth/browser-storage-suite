import { describe, it, expect } from 'vitest';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../../../utils/storageAggregate';
import { ExecutionPlan } from '../../../utils/sqlToIdb';

describe('Tier 3 Interaction: F6 (MCP Adapter) + F7 (SQL Translator)', () => {
  it('should process query_storage_sql tool call and return translated IDB execution plan', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const sqlQuery = "SELECT * FROM storage WHERE key LIKE '%auth%'";
    const toolResult = adapter.handleToolCall('query_storage_sql', { sql: sqlQuery });

    expect(toolResult.ok).toBe(true);
    if (toolResult.ok) {
      const data = toolResult.value as { plan: ExecutionPlan };
      expect(data.plan).toBeDefined();
      expect(data.plan.originalQuery).toBe(sqlQuery);
      expect(data.plan.scanStrategy).toBe('INDEX_SCAN');
      expect(data.plan.filterKeyPattern).toBe('%auth%');
      expect(data.plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
    }
  });

  it('should return error for unrecognized MCP tool call', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const result = adapter.handleToolCall('non_existent_tool', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown MCP tool call');
    }
  });
});
