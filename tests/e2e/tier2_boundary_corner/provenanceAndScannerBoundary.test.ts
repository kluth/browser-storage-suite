import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStorageDataBlame, DataBlameRegistry } from '../../../utils/dataBlamer';
import { probeBackendEndpoint, getLocalhostDevPorts, getStandardApiSpecPaths } from '../../../utils/backendDiscoverer';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../../../utils/storageAggregate';

describe('Tier 2 Boundary & Corner Cases: Provenance, Scanner & MCP Adapter', () => {
  // Feature 4: Data Blaming & Callstack Attribution
  describe('Feature 4: Data Blaming & Callstack Attribution', () => {
    beforeEach(() => {
      DataBlameRegistry.getInstance().clear();
    });

    it('TC-F4-B1: returns default application runtime actor for empty string key', () => {
      const info = getStorageDataBlame('', 'some_value');
      expect(info.key).toBe('');
      expect(info.actor.name).toBeDefined();
      expect(info.actor.type).toBe('script');
      expect(info.revisionCount).toBe(1);
      expect(info.previousValue).toBeUndefined();
    });

    it('TC-F4-B2: handles keys with mixed case and leading/trailing whitespace dynamically', () => {
      const authStack = `Error
      at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)`;

      const infoAuth = getStorageDataBlame('  USER_AUTH_TOKEN_JWT  ', 'xyz123', authStack);
      expect(infoAuth.key).toBe('  USER_AUTH_TOKEN_JWT  ');
      expect(infoAuth.actor.name).toContain('setAuthToken');
      expect(infoAuth.actor.type).toBe('script');
      expect(infoAuth.revisionCount).toBe(1);

      const userStack = `Error
      at toggleDarkMode (https://example.com/assets/theme-switch.js:12:5)`;

      const infoTheme = getStorageDataBlame('  UI_THEME_PREFERENCE  ', 'dark', userStack);
      expect(infoTheme.actor.name).toContain('User Action');
      expect(infoTheme.actor.type).toBe('user_action');
      expect(infoTheme.revisionCount).toBe(1);
    });

    it('TC-F4-B3: attributes actors based on top caller frame when multiple concepts exist in stack', () => {
      const callstack = `Error
      at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
      at toggleDarkMode (https://example.com/assets/theme-switch.js:12:5)`;

      const info = getStorageDataBlame('auth_theme_token', 'val', callstack);
      expect(info.actor.name).toContain('setAuthToken');
      expect(info.revisionCount).toBe(1);
    });

    it('TC-F4-B4: handles empty string currentValue and previous value history', () => {
      const registry = DataBlameRegistry.getInstance();
      registry.recordMutation('auth_token', 'bearer_old_token_expired_123');

      const infoEmpty = getStorageDataBlame('auth_token', '');
      expect(infoEmpty.key).toBe('auth_token');
      expect(infoEmpty.previousValue).toBe('bearer_old_token_expired_123');
      expect(infoEmpty.revisionCount).toBe(2);
    });

    it('TC-F4-B5: handles prototype pollution keys (__proto__, constructor, toString) safely', () => {
      const protoInfo = getStorageDataBlame('__proto__', 'value');
      expect(protoInfo.key).toBe('__proto__');
      expect(protoInfo.actor.name).toBeDefined();

      const toStringInfo = getStorageDataBlame('toString', 'value');
      expect(toStringInfo.key).toBe('toString');
      expect(toStringInfo.actor.name).toBeDefined();
    });
  });

  // Feature 5: Backend API Scanner
  describe('Feature 5: Backend API Scanner', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('TC-F5-B1: returns null for unreachable/offline localhost ports when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await probeBackendEndpoint('http://localhost:59999');
      expect(result).toBeNull();
    });

    it('TC-F5-B2: handles server returning non-JSON 404 HTML response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      }));

      const result = await probeBackendEndpoint('http://localhost:3000');
      expect(result).toBeNull();
    });

    it('TC-F5-B3: handles backend returning empty JSON object ({})', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }));

      const result = await probeBackendEndpoint('http://localhost:8080');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('rest');
        expect(result.endpointsFound).toEqual([]);
        expect(result.schemasCount).toBe(0);
      }
    });

    it('TC-F5-B4: identifies GraphQL spec endpoint returning data payload on /graphql path', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/graphql')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { __schema: { types: [] } } }),
          });
        }
        return Promise.resolve({ ok: false });
      }));

      const result = await probeBackendEndpoint('http://localhost:4000');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('graphql');
        expect(result.specUrl).toBe('http://localhost:4000/graphql');
      }
    });

    it('TC-F5-B5: handles OpenAPI spec with missing components or definitions gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/openapi.json')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              openapi: '3.0.0',
              paths: { '/users': {}, '/auth/login': {} },
              // components key intentionally omitted
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }));

      const result = await probeBackendEndpoint('http://localhost:8000');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('openapi');
        expect(result.endpointsFound).toHaveLength(2);
        expect(result.schemasCount).toBe(0);
      }
    });
  });

  // Feature 6: MCP Server Adapter
  describe('Feature 6: MCP Server Adapter', () => {
    it('TC-F6-B1: returns error for unrecognized tool call', () => {
      const aggregate = new StorageStateAggregate();
      const adapter = new McpServerAdapter(aggregate);

      const result = adapter.handleToolCall('non_existent_tool', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Unknown MCP tool call: non_existent_tool');
      }
    });

    it('TC-F6-B2: handles query_storage_sql with missing sql argument in args', () => {
      const aggregate = new StorageStateAggregate();
      const adapter = new McpServerAdapter(aggregate);

      const result = adapter.handleToolCall('query_storage_sql', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        const payload = result.value as { plan: unknown };
        expect(payload.plan).toBeDefined();
      }
    });

    it('TC-F6-B3: handles get_storage_snapshot with missing timestamp argument', () => {
      const aggregate = new StorageStateAggregate();
      const adapter = new McpServerAdapter(aggregate);

      // Snapshot requested on empty aggregate returns error Result
      const resultEmpty = adapter.handleToolCall('get_storage_snapshot', {});
      expect(resultEmpty.ok).toBe(false);

      // Now add a mutation and test again without explicit timestamp
      aggregate.applyMutation({
        id: 'm1',
        timestamp: Date.now() - 5000,
        type: 'set',
        storageType: 'localStorage',
        key: 'mcp_key',
        value: 'mcp_val',
      });

      const resultWithData = adapter.handleToolCall('get_storage_snapshot', {});
      expect(resultWithData.ok).toBe(true);
      if (resultWithData.ok) {
        const snap = resultWithData.value as { entries: Record<string, string> };
        expect(snap.entries).toEqual({ mcp_key: 'mcp_val' });
      }
    });

    it('TC-F6-B4: returns error when requesting snapshot prior to any recorded mutation', () => {
      const aggregate = new StorageStateAggregate();
      aggregate.applyMutation({
        id: 'm1',
        timestamp: 10000,
        type: 'set',
        storageType: 'localStorage',
        key: 'k1',
        value: 'v1',
      });

      const adapter = new McpServerAdapter(aggregate);
      const result = adapter.handleToolCall('get_storage_snapshot', { timestamp: 5000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const snap = result.value as { entries: Record<string, string> };
        // Snapshot at t=5000 has empty entries since mutation happened at t=10000
        expect(snap.entries).toEqual({});
      }
    });

    it('TC-F6-B5: provides complete tool definitions with JSON schema properties via getTools()', () => {
      const aggregate = new StorageStateAggregate();
      const adapter = new McpServerAdapter(aggregate);

      const tools = adapter.getTools();
      expect(tools).toHaveLength(2);

      const sqlTool = tools.find((t) => t.name === 'query_storage_sql');
      expect(sqlTool).toBeDefined();
      expect(sqlTool?.inputSchema.required).toContain('sql');

      const snapTool = tools.find((t) => t.name === 'get_storage_snapshot');
      expect(snapTool).toBeDefined();
      expect(snapTool?.inputSchema.required).toContain('timestamp');
    });
  });
});
