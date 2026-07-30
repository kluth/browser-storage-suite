import { describe, it, expect } from 'vitest';
import { McpServerAdapter } from '../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../utils/storageAggregate';
import { analyzeStoragePerformance } from '../utils/performanceAdvisor';

describe('MCP Server Adapter (Model Context Protocol for AI Agents)', () => {
  it('should return available MCP tools schema', () => {
    const agg = new StorageStateAggregate();
    const mcp = new McpServerAdapter(agg);

    const tools = mcp.getTools();
    expect(tools.length).toBeGreaterThanOrEqual(2);
    expect(tools.map((t) => t.name)).toContain('query_storage_sql');
    expect(tools.map((t) => t.name)).toContain('get_storage_snapshot');
  });

  it('should execute query_storage_sql tool call and return result', () => {
    const agg = new StorageStateAggregate();
    const mcp = new McpServerAdapter(agg);

    const res = mcp.handleToolCall('query_storage_sql', { sql: "SELECT * FROM storage WHERE key LIKE '%session%'" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.value as { plan: { scanStrategy: string } };
      expect(data.plan.scanStrategy).toBe('INDEX_SCAN');
    }
  });
});

describe('Storage Performance & Anti-Pattern Advisor', () => {
  it('should detect large objects in LocalStorage and generate optimization warning', () => {
    const largeValue = 'x'.repeat(150 * 1024); // 150 KB string
    const localRecord = {
      large_cached_state: largeValue,
    };

    const metrics = analyzeStoragePerformance(localRecord, []);
    expect(metrics.localStorageBytes).toBeGreaterThan(100 * 1024);
    expect(metrics.insights.some((i) => i.type === 'warning')).toBe(true);
    expect(metrics.insights.some((i) => i.title.includes('Großes Objekt'))).toBe(true);
  });

  it('should generate security tip when auth token is stored in LocalStorage', () => {
    const localRecord = {
      user_auth_token: 'secret_jwt_token',
    };

    const metrics = analyzeStoragePerformance(localRecord, []);
    expect(metrics.insights.some((i) => i.title.includes('Sicherheitshinweis'))).toBe(true);
  });
});
