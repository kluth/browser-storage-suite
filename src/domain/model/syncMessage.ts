export type SyncMessageAction =
  | 'CRDT_SYNC_MERGE'
  | 'CRDT_SYNC_REQUEST'
  | 'CRDT_SYNC_RESPONSE'
  | 'CRDT_PING';

export interface SignedSyncEnvelope {
  protocolVersion: string;
  messageId: string;
  timestamp: number;
  sourceOrigin: string;
  targetOrigin: string;
  action: SyncMessageAction;
  payload: string;
  signature: string;
}

export interface SyncPeerInfo {
  peerId: string;
  origin: string;
  lastSeen: number;
}

export type SyncErrorCode =
  | 'INVALID_SIGNATURE'
  | 'ORIGIN_NOT_ALLOWED'
  | 'REPLAY_DETECTED'
  | 'TIMESTAMP_DRIFT'
  | 'INVALID_PAYLOAD'
  | 'CRYPTO_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
