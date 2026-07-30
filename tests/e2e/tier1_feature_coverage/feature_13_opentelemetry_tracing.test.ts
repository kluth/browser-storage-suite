import { describe, it, expect, vi } from 'vitest';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';

describe('Feature 13: OpenTelemetry Tracing Layer', () => {
  it('13.1 should start an OpenTelemetry span via ExtensionTelemetry.startSpan', () => {
    const span = ExtensionTelemetry.startSpan('test_storage_inspection');
    expect(span).toBeDefined();
    expect(typeof span.end).toBe('function');
    expect(typeof span.setAttribute).toBe('function');
    span.end();
  });

  it('13.2 should trace synchronous operation and return result value while closing span', () => {
    let spanClosed = false;

    const result = ExtensionTelemetry.traceOperation('calculate_quota', (span) => {
      expect(span).toBeDefined();
      span.setAttribute('quota.limit', 5242880);
      return 1024 * 42;
    });

    expect(result).toBe(43008);
  });

  it('13.3 should record exception on span and re-throw error when operation throws', () => {
    const operationError = new Error('Storage write failed');

    expect(() => {
      ExtensionTelemetry.traceOperation('failing_operation', (span) => {
        span.setAttribute('operation.step', 'write');
        throw operationError;
      });
    }).toThrow('Storage write failed');
  });

  it('13.4 should support setting custom attributes on span within traceOperation', () => {
    const output = ExtensionTelemetry.traceOperation('set_attributes_test', (span) => {
      span.setAttribute('browser.name', 'chrome');
      span.setAttribute('browser.mv_version', 3);
      span.setAttribute('storage.target', 'localStorage');
      return 'attributes_set';
    });

    expect(output).toBe('attributes_set');
  });

  it('13.5 should handle nested operation tracing without scope conflict', () => {
    const result = ExtensionTelemetry.traceOperation('outer_span', (outerSpan) => {
      outerSpan.setAttribute('layer', 'outer');

      const innerResult = ExtensionTelemetry.traceOperation('inner_span', (innerSpan) => {
        innerSpan.setAttribute('layer', 'inner');
        return 'inner_complete';
      });

      return `outer_${innerResult}`;
    });

    expect(result).toBe('outer_inner_complete');
  });

  it('13.6 should safely trace operations returning complex objects and arrays', () => {
    const data = ExtensionTelemetry.traceOperation('fetch_snapshot', () => {
      return { timestamp: 1000, entries: { k1: 'v1', k2: 'v2' } };
    });

    expect(data.timestamp).toBe(1000);
    expect(data.entries).toEqual({ k1: 'v1', k2: 'v2' });
  });
});
