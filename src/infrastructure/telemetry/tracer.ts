import { trace, Tracer, Span } from '@opentelemetry/api';

const TRACER_NAME = 'browser-storage-suite-telemetry';

export class ExtensionTelemetry {
  private static tracer: Tracer = trace.getTracer(TRACER_NAME);

  public static startSpan(name: string): Span {
    return this.tracer.startSpan(name);
  }

  public static traceOperation<T>(spanName: string, operation: (span: Span) => T): T {
    const span = this.startSpan(spanName);
    try {
      const result = operation(span);
      span.end();
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.end();
      throw err;
    }
  }
}
