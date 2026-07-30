import { describe, it, expect } from 'vitest';
import { StorageInterceptorAdapter } from '../../../src/infrastructure/adapters/storageInterceptorAdapter';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';
import { StorageMutation } from '../../../utils/storageAggregate';

describe('Tier 3 Interaction: F14 (Native Interceptor) + F13 (OpenTelemetry Tracing)', () => {
  it('should trace storage interception events using OpenTelemetry spans', () => {
    const eventTarget = new EventTarget();
    let tracedSpansCount = 0;

    const onMutation = (mutation: StorageMutation) => {
      ExtensionTelemetry.traceOperation('StorageInterceptor.OnMutation', (span) => {
        span.setAttribute('mutation.id', mutation.id);
        span.setAttribute('mutation.key', mutation.key);
        span.setAttribute('mutation.storage_type', mutation.storageType);
        tracedSpansCount++;
      });
    };

    const interceptor = new StorageInterceptorAdapter(onMutation, eventTarget);
    interceptor.attach();

    // Dispatch intercepted storage write event
    const event1 = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: {
        id: 'evt-trace-1',
        timestamp: Date.now(),
        type: 'set',
        storageType: 'localStorage',
        key: 'cart_items',
        value: '["item1"]',
      },
    });
    eventTarget.dispatchEvent(event1);

    const event2 = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: {
        id: 'evt-trace-2',
        timestamp: Date.now(),
        type: 'delete',
        storageType: 'sessionStorage',
        key: 'temp_flag',
      },
    });
    eventTarget.dispatchEvent(event2);

    expect(tracedSpansCount).toBe(2);

    interceptor.detach();
  });
});
