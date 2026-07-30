import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLocalhostDevPorts, getStandardApiSpecPaths, probeBackendEndpoint, DiscoveredBackend, NetworkRequestSniffer } from '../../../utils/backendDiscoverer';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../../../utils/storageAggregate';
import { translateSqlToIDBCursor, ExecutionPlan } from '../../../utils/sqlToIdb';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';

describe('Tier 4 Scenario 4: Backend Discovery & MCP SQL Query Profiling (F5, F6, F7, F13)', () => {
  beforeEach(() => {
    NetworkRequestSniffer.reset();
    NetworkRequestSniffer.captureRequestUrl('http://localhost:3000/api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    NetworkRequestSniffer.reset();
  });
  it('should discover dev backend endpoints and OpenAPI specifications under OpenTelemetry tracing', async () => {
    NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/api');
    const ports = getLocalhostDevPorts();
    const specPaths = getStandardApiSpecPaths();
    expect(ports.length).toBeGreaterThan(0);
    expect(specPaths.length).toBeGreaterThan(0);

    const mockOpenApiJson = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/products': {},
        '/api/v1/cart': {},
        '/api/v1/orders': {},
      },
      components: {
        schemas: {
          Product: { type: 'object' },
          Cart: { type: 'object' },
          Order: { type: 'object' },
        },
      },
    };

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenApiJson,
    } as Response);

    const discovered = ExtensionTelemetry.traceOperation('discover_backend_apis', () => {
      return probeBackendEndpoint('http://localhost:8080');
    });

    const result: DiscoveredBackend | null = await discovered;
    expect(result).not.toBeNull();
    if (result) {
      expect(result.baseUrl).toBe('http://localhost:8080');
      expect(result.type).toBe('openapi');
      expect(result.schemasCount).toBe(3);
      expect(result.endpointsFound).toContain('/api/v1/cart');
      expect(result.endpointsFound).toContain('/api/v1/products');
    }

    global.fetch = originalFetch;
  });

  it('should initialize MCP Server Adapter and handle SQL storage query tool calls', () => {
    const aggregate = new StorageStateAggregate();
    const mcpAdapter = new McpServerAdapter(aggregate);

    const tools = mcpAdapter.getTools();
    expect(tools.length).toBe(2);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('query_storage_sql');
    expect(toolNames).toContain('get_storage_snapshot');

    const sqlQuery = "SELECT * FROM storage WHERE key LIKE '%user_session%'";
    const toolResult = mcpAdapter.handleToolCall('query_storage_sql', { sql: sqlQuery });

    expect(toolResult.ok).toBe(true);
    if (toolResult.ok) {
      const data = toolResult.value as { plan: ExecutionPlan };
      expect(data.plan.originalQuery).toBe(sqlQuery);
      expect(data.plan.scanStrategy).toBe('INDEX_SCAN');
      expect(data.plan.filterKeyPattern).toBe('%user_session%');
      expect(data.plan.estimatedCostMs).toBeLessThan(1.0);
    }
  });

  it('should profile SQL query execution strategy via SQL-to-IDBCursor Translator', () => {
    const indexQueryPlan = translateSqlToIDBCursor("SELECT id, key, value FROM storage WHERE key = 'auth_token'");
    expect(indexQueryPlan.scanStrategy).toBe('INDEX_SCAN');
    expect(indexQueryPlan.estimatedCostMs).toBe(0.42);
    expect(indexQueryPlan.parsedFields).toEqual(['id', 'key', 'value']);

    const scanQueryPlan = translateSqlToIDBCursor("SELECT * FROM storage ORDER BY sizeBytes DESC");
    expect(scanQueryPlan.scanStrategy).toBe('FULL_TABLE_SCAN');
    expect(scanQueryPlan.estimatedCostMs).toBe(12.8);
    expect(scanQueryPlan.filterKeyPattern).toBeUndefined();
  });

  it('should handle MCP tool calls for time-travel snapshot retrieval', () => {
    const aggregate = new StorageStateAggregate();
    aggregate.applyMutation({ id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'setting_theme', value: 'dark' });
    aggregate.applyMutation({ id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'setting_lang', value: 'de-DE' });

    const mcpAdapter = new McpServerAdapter(aggregate);

    const snapshotResult = mcpAdapter.handleToolCall('get_storage_snapshot', { timestamp: 1500 });
    expect(snapshotResult.ok).toBe(true);
    if (snapshotResult.ok) {
      const snapshot = snapshotResult.value as { timestamp: number; entries: Record<string, string> };
      expect(snapshot.timestamp).toBe(1500);
      expect(snapshot.entries['setting_theme']).toBe('dark');
      expect(snapshot.entries['setting_lang']).toBeUndefined();
    }
  });
});
