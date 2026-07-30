import { describe, it, expect } from 'vitest';
import { getStorageDataBlame } from '../../../utils/dataBlamer';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';

describe('Tier 3 Interaction: F4 (Data Blamer) + F13 (OpenTelemetry Tracing)', () => {
  it('should instrument Data Blaming analysis inside OpenTelemetry trace spans', () => {
    const key = 'user_auth_token';
    const value = 'bearer_secret_123';
    const syntheticStack = `Error\n    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)`;

    const result = ExtensionTelemetry.traceOperation('DataBlamer.InspectKey', (span) => {
      expect(span).toBeDefined();
      const blame = getStorageDataBlame(key, value, syntheticStack);
      span.setAttribute('blame.key', blame.key);
      span.setAttribute('blame.actor_type', blame.actor.type);
      span.setAttribute('blame.revision_count', blame.revisionCount);
      return blame;
    });

    expect(result.key).toBe(key);
    expect(result.actor.name).toContain('setAuthToken');
    expect(result.actor.type).toBe('script');
    expect(result.revisionCount).toBeGreaterThan(0);
    expect(result.actor.stackTraceSnippet).toContain('auth-bundle.js');
  });

  it('should capture exceptions in OpenTelemetry spans when blame processing errors occur', () => {
    expect(() => {
      ExtensionTelemetry.traceOperation('DataBlamer.FaultyInspect', (span) => {
        span.setAttribute('test.step', 'initial');
        throw new Error('Simulated Blamer Processing Exception');
      });
    }).toThrow('Simulated Blamer Processing Exception');
  });
});
