import { Result } from '../../../utils/result';
import { PostMessageRelayPort } from '../../domain/ports/secondary/postMessageRelayPort';
import { SignedSyncEnvelope, SyncError } from '../../domain/model/syncMessage';

export class PostMessageRelayAdapter implements PostMessageRelayPort {
  private whitelistedOrigins: Set<string> = new Set(['*']);
  private seenNonces: Set<string> = new Set();
  private maxNonceHistory: number = 1000;
  private maxDriftMs: number = 30000; // 30 seconds default timestamp drift limit
  private localListeners: Set<(envelope: SignedSyncEnvelope) => void> = new Set();

  constructor(whitelistedOrigins?: string[], maxDriftMs?: number) {
    if (whitelistedOrigins && whitelistedOrigins.length > 0) {
      this.whitelistedOrigins = new Set(whitelistedOrigins);
    }
    if (maxDriftMs !== undefined) {
      this.maxDriftMs = maxDriftMs;
    }
  }

  public setWhitelistedOrigins(origins: string[]): void {
    this.whitelistedOrigins = new Set(origins);
  }

  public addWhitelistedOrigin(origin: string): void {
    this.whitelistedOrigins.add(origin);
  }

  public isOriginAllowed(origin: string): boolean {
    if (this.whitelistedOrigins.has('*')) return true;
    return this.whitelistedOrigins.has(origin);
  }

  public setMaxDriftMs(driftMs: number): void {
    this.maxDriftMs = driftMs;
  }

  public async postMessage(
    envelope: SignedSyncEnvelope,
    targetOrigin: string,
    targetWindow?: unknown
  ): Promise<Result<void, SyncError>> {
    try {
      if (!envelope || !envelope.messageId || !envelope.signature) {
        return Result.err(
          new SyncError('INVALID_PAYLOAD', 'Cannot send invalid signed sync envelope')
        );
      }

      if (targetOrigin !== '*' && !this.isOriginAllowed(targetOrigin)) {
        return Result.err(
          new SyncError('ORIGIN_NOT_ALLOWED', `Target origin '${targetOrigin}' is not whitelisted`)
        );
      }

      const win = (targetWindow as { postMessage?: Function }) ?? (typeof window !== 'undefined' ? window : undefined);

      if (win && typeof win.postMessage === 'function') {
        win.postMessage(envelope, targetOrigin);
      }

      // Also notify local listeners attached directly to this adapter instance
      await this.notifyLocalListeners(envelope, envelope.sourceOrigin);

      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new SyncError(
          'NETWORK_ERROR',
          `Failed to dispatch postMessage: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public listen(
    callback: (envelope: SignedSyncEnvelope) => void
  ): Result<() => void, SyncError> {
    try {
      this.localListeners.add(callback);

      let handleMessageEvent: ((event: { origin: string; data: unknown }) => void) | null = null;

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        handleMessageEvent = (event: { origin: string; data: unknown }) => {
          // Pass event data and origin to incoming message processing
          this.processIncomingMessage(event.data, event.origin);
        };
        window.addEventListener('message', handleMessageEvent);
      }

      const unsubscribe = () => {
        this.localListeners.delete(callback);
        if (handleMessageEvent && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('message', handleMessageEvent);
        }
      };

      return Result.ok(unsubscribe);
    } catch (err) {
      return Result.err(
        new SyncError(
          'UNKNOWN_ERROR',
          `Failed to attach message listener: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  /**
   * Helper to manually simulate incoming messages in unit/integration tests.
   */
  public simulateIncomingMessage(data: unknown, origin?: string): Result<boolean, SyncError> {
    return this.processIncomingMessage(data, origin);
  }

  private processIncomingMessage(data: unknown, origin?: string): Result<boolean, SyncError> {
    if (!data || typeof data !== 'object') {
      return Result.err(new SyncError('INVALID_PAYLOAD', 'Message data must be an object'));
    }

    const envelope = data as SignedSyncEnvelope;
    if (
      !envelope.protocolVersion ||
      !envelope.messageId ||
      !envelope.timestamp ||
      !envelope.sourceOrigin ||
      !envelope.action ||
      !envelope.payload ||
      !envelope.signature
    ) {
      return Result.err(
        new SyncError('INVALID_PAYLOAD', 'Message envelope is missing required fields')
      );
    }

    // Determine message origin (prioritize envelope sourceOrigin, fallback to event origin)
    const effectiveOrigin = envelope.sourceOrigin || origin || '';
    if (!this.isOriginAllowed(effectiveOrigin)) {
      return Result.err(
        new SyncError('ORIGIN_NOT_ALLOWED', `Incoming origin '${effectiveOrigin}' is not whitelisted`)
      );
    }

    // Timestamp drift check
    const now = Date.now();
    if (Math.abs(now - envelope.timestamp) > this.maxDriftMs) {
      return Result.err(
        new SyncError(
          'TIMESTAMP_DRIFT',
          `Message timestamp drift (${Math.abs(now - envelope.timestamp)}ms) exceeds limit (${this.maxDriftMs}ms)`
        )
      );
    }

    // Anti-replay nonce check
    if (this.seenNonces.has(envelope.messageId)) {
      return Result.err(
        new SyncError('REPLAY_DETECTED', `Replay attack detected: message ID '${envelope.messageId}' already processed`)
      );
    }

    this.recordNonce(envelope.messageId);

    // Dispatch to local listeners
    for (const listener of Array.from(this.localListeners)) {
      listener(envelope);
    }

    return Result.ok(true);
  }

  private async notifyLocalListeners(envelope: SignedSyncEnvelope, origin: string): Promise<void> {
    const effectiveOrigin = envelope.sourceOrigin || origin || '';
    if (!this.isOriginAllowed(effectiveOrigin)) return;
    if (this.seenNonces.has(envelope.messageId)) return;

    const now = Date.now();
    if (Math.abs(now - envelope.timestamp) > this.maxDriftMs) return;

    this.recordNonce(envelope.messageId);

    const promises: Promise<unknown>[] = [];
    for (const listener of Array.from(this.localListeners)) {
      const res: unknown = listener(envelope);
      if (res && typeof (res as { then?: unknown }).then === 'function') {
        promises.push(res as Promise<unknown>);
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  private recordNonce(nonce: string): void {
    this.seenNonces.add(nonce);
    if (this.seenNonces.size > this.maxNonceHistory) {
      const firstNonce = this.seenNonces.values().next().value;
      if (firstNonce) {
        this.seenNonces.delete(firstNonce);
      }
    }
  }

  public resetNonces(): void {
    this.seenNonces.clear();
  }
}
