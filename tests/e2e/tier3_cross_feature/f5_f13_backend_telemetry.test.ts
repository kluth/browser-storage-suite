import { describe, it, expect, vi } from 'vitest';
import { probeBackendEndpoint } from '../../../utils/backendDiscoverer';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';

describe('Tier 3 Interaction: F5 (Backend Scanner) + F13 (OpenTelemetry Tracing)', () => {
  it('should trace backend endpoint discovery probes with OpenTelemetry spans', async () => {
    const mockOpenApiSpec = {
      swagger: '2.0',
      paths: {
        '/v1/users': {},
        '/v1/auth': {},
      },
      definitions: {
        User: { type: 'object' },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenApiSpec,
    } as Response);

    const baseUrl = 'http://localhost:8080';

    const discoveryResult = await ExtensionTelemetry.traceOperation('BackendDiscoverer.Probe', async (span) => {
      span.setAttribute('backend.base_url', baseUrl);
      const result = await probeBackendEndpoint(baseUrl);
      if (result) {
        span.setAttribute('backend.type', result.type);
        span.setAttribute('backend.endpoints_count', result.endpointsFound.length);
        span.setAttribute('backend.schemas_count', result.schemasCount);
      }
      return result;
    });

    expect(discoveryResult).not.toBeNull();
    if (discoveryResult) {
      expect(discoveryResult.type).toBe('openapi');
      expect(discoveryResult.endpointsFound.length).toBe(2);
      expect(discoveryResult.schemasCount).toBe(1);
    }
  });

  it('should trace backend probe failures gracefully without throwing unhandled exceptions', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network connection failed'));

    const baseUrl = 'http://localhost:9999';

    const discoveryResult = await ExtensionTelemetry.traceOperation('BackendDiscoverer.ProbeFailure', async (span) => {
      span.setAttribute('backend.base_url', baseUrl);
      const result = await probeBackendEndpoint(baseUrl);
      span.setAttribute('backend.success', result !== null);
      return result;
    });

    expect(discoveryResult).toBeNull();
  });
});
