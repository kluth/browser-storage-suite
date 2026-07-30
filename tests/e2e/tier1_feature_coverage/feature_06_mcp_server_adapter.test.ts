import { describe, it, expect } from 'vitest';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../../../utils/storageAggregate';

describe('Feature 06: MCP Server Adapter', () => {
  it('6.1 should return schema definition for available MCP tools', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const tools = adapter.getTools();
    expect(tools).toHaveLength(2);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('query_storage_sql');
    expect(toolNames).toContain('get_storage_snapshot');

    const sqlTool = tools.find((t) => t.name === 'query_storage_sql');
    expect(sqlTool?.inputSchema).toHaveProperty('required', ['sql']);

    const snapshotTool = tools.find((t) => t.name === 'get_storage_snapshot');
    expect(snapshotTool?.inputSchema).toHaveProperty('required', ['timestamp']);
  });

  it('6.2 should handle query_storage_sql tool call and return execution plan', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const res = adapter.handleToolCall('query_storage_sql', {
      sql: "SELECT * FROM storage WHERE key LIKE '%session%'",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const payload = res.value as { plan: any };
      expect(payload.plan).toBeDefined();
      expect(payload.plan.scanStrategy).toBe('INDEX_SCAN');
      expect(payload.plan.filterKeyPattern).toBe('%session%');
    }
  });

  it('6.3 should handle get_storage_snapshot tool call and return historical snapshot', () => {
    const aggregate = new StorageStateAggregate();
    aggregate.applyMutation({
      id: 'm1',
      timestamp: 1000,
      type: 'set',
      storageType: 'localStorage',
      key: 'auth_token',
      value: 'secret_token_123',
    });

    const adapter = new McpServerAdapter(aggregate);

    const res = adapter.handleToolCall('get_storage_snapshot', { timestamp: 1500 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const snap = res.value as { timestamp: number; entries: Record<string, string> };
      expect(snap.timestamp).toBe(1500);
      expect(snap.entries).toEqual({ auth_token: 'secret_token_123' });
    }
  });

  it('6.4 should return Result.err when get_storage_snapshot is called on empty timeline', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const res = adapter.handleToolCall('get_storage_snapshot', { timestamp: 5000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('SNAPSHOT_NOT_FOUND');
    }
  });

  it('6.5 should return Result.err when an unknown tool name is invoked', () => {
    const aggregate = new StorageStateAggregate();
    const adapter = new McpServerAdapter(aggregate);

    const res = adapter.handleToolCall('invalid_unknown_tool', {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Unknown MCP tool call: invalid_unknown_tool');
    }
  });

  it('6.6 should handle missing or default arguments in tool calls safely', () => {
    const aggregate = new StorageStateAggregate();
    aggregate.applyMutation({
      id: 'm1',
      timestamp: 500,
      type: 'set',
      storageType: 'localStorage',
      key: 'init_key',
      value: 'init_val',
    });
    const adapter = new McpServerAdapter(aggregate);

    // Call query_storage_sql with empty args
    const sqlRes = adapter.handleToolCall('query_storage_sql', {});
    expect(sqlRes.ok).toBe(true);
    if (sqlRes.ok) {
      const payload = sqlRes.value as { plan: any };
      expect(payload.plan.scanStrategy).toBe('FULL_TABLE_SCAN');
    }

    // Call get_storage_snapshot without timestamp (defaults to Date.now())
    const snapRes = adapter.handleToolCall('get_storage_snapshot', {});
    expect(snapRes.ok).toBe(true);
  });
});
