import { describe, it, expect, vi } from 'vitest';
import { probeBackendEndpoint } from '../../../utils/backendDiscoverer';
import { McpServerAdapter } from '../../../src/infrastructure/mcp/mcpServerAdapter';
import { StorageStateAggregate } from '../../../utils/storageAggregate';

describe('Tier 3 Interaction: F5 (Backend Scanner) + F6 (MCP Server Adapter)', () => {
  it('should probe backend schemas and make discovered API endpoints accessible via MCP agent tool integration', async () => {
    // 1. Mock F5 Backend Scanner HTTP probe
    const mockOpenApiSpec = {
      openapi: '3.0.1',
      paths: {
        '/api/v1/storage/snapshot': {},
        '/api/v1/users': {},
      },
      components: {
        schemas: {
          SnapshotSchema: { type: 'object' },
          UserSchema: { type: 'object' },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenApiSpec,
    } as Response);

    const backendInfo = await probeBackendEndpoint('http://localhost:3000');
    expect(backendInfo).not.toBeNull();
    expect(backendInfo?.endpointsFound).toContain('/api/v1/storage/snapshot');

    // 2. Initialize F6 MCP Adapter and verify schema synergy
    const aggregate = new StorageStateAggregate();
    aggregate.applyMutation({
      id: 'm1',
      timestamp: 5000,
      type: 'set',
      storageType: 'localStorage',
      key: 'api_endpoint',
      value: backendInfo?.specUrl,
    });

    const mcpAdapter = new McpServerAdapter(aggregate);
    const snapshotToolRes = mcpAdapter.handleToolCall('get_storage_snapshot', { timestamp: 5000 });

    expect(snapshotToolRes.ok).toBe(true);
    if (snapshotToolRes.ok) {
      const snap = snapshotToolRes.value as { entries: Record<string, string> };
      expect(snap.entries['api_endpoint']).toBe('http://localhost:3000/swagger.json');
    }
  });
});
