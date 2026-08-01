import { Result } from '../../../../utils/result';
import { SignedSyncEnvelope, SyncError } from '../../model/syncMessage';
import { LwwSetState } from '../../model/crdtLwwSet';

export interface CrossDomainSyncPort {
  /**
   * Sets or merges a key-value pair in the local CRDT set and broadcasts to target origins.
   */
  synchronizeKey<T>(key: string, value: T): Promise<Result<void, SyncError>>;

  /**
   * Marks a key as deleted (adds a tombstone) in the local CRDT set and broadcasts tombstone.
   */
  removeKey(key: string): Promise<Result<void, SyncError>>;

  /**
   * Broadcasts current local CRDT state to all whitelisted peer origins.
   */
  broadcastState(): Promise<Result<void, SyncError>>;

  /**
   * Ingests and verifies a remote signed sync envelope, merging payload into local CRDT set if valid.
   */
  mergeRemoteState<T>(envelope: SignedSyncEnvelope): Promise<Result<boolean, SyncError>>;

  /**
   * Registers an allowed peer origin.
   */
  registerPeer(origin: string): Result<void, SyncError>;

  /**
   * Sets shared secret key used for HMAC signature generation and verification.
   */
  setSharedSecret(secret: string): Promise<Result<void, SyncError>>;

  /**
   * Returns current local state snapshot.
   */
  getLocalState<T>(): LwwSetState<T>;
}
