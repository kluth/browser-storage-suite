import { Result } from '../../../../utils/result';
import { SignedSyncEnvelope, SyncError } from '../../model/syncMessage';

export interface PostMessageRelayPort {
  /**
   * Dispatches a signed sync envelope to a target window/frame or origin.
   */
  postMessage(
    envelope: SignedSyncEnvelope,
    targetOrigin: string,
    targetWindow?: unknown
  ): Promise<Result<void, SyncError>>;

  /**
   * Registers a message listener that intercepts postMessages, verifies origin/nonce, and triggers callback.
   * Returns an unsubscribe function wrapped in Result.
   */
  listen(
    callback: (envelope: SignedSyncEnvelope) => void
  ): Result<() => void, SyncError>;

  /**
   * Sets the full list of allowed origins.
   */
  setWhitelistedOrigins(origins: string[]): void;

  /**
   * Adds an origin to the allowed whitelist.
   */
  addWhitelistedOrigin(origin: string): void;

  /**
   * Checks if an origin is permitted under current whitelist settings.
   */
  isOriginAllowed(origin: string): boolean;

  /**
   * Configures max timestamp drift allowed in milliseconds (default: 30000ms).
   */
  setMaxDriftMs(driftMs: number): void;
}
