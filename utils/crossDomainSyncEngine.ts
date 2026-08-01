import { Result } from './result';
import { CrossDomainSyncPort } from '../src/domain/ports/primary/crossDomainSyncPort';
import { PostMessageRelayPort } from '../src/domain/ports/secondary/postMessageRelayPort';
import { HmacSignerPort } from '../src/domain/ports/secondary/hmacSignerPort';
import { CrdtLwwSet, LwwSetState } from '../src/domain/model/crdtLwwSet';
import { SignedSyncEnvelope, SyncError, SyncPeerInfo } from '../src/domain/model/syncMessage';
import { HmacSignerAdapter } from '../src/infrastructure/adapters/hmacSignerAdapter';
import { PostMessageRelayAdapter } from '../src/infrastructure/adapters/postMessageRelayAdapter';

export interface CrossDomainSyncEngineOptions {
  peerId?: string;
  ownOrigin?: string;
  sharedSecret?: string;
  whitelistedOrigins?: string[];
  relayAdapter?: PostMessageRelayPort;
  signerAdapter?: HmacSignerPort;
}

export class CrossDomainSyncEngine implements CrossDomainSyncPort {
  private static instance: CrossDomainSyncEngine | null = null;

  private crdtSet: CrdtLwwSet<any>;
  private relayAdapter: PostMessageRelayPort;
  private signerAdapter: HmacSignerPort;
  private sharedSecretKey: CryptoKey | string | null = null;
  private ownOrigin: string;
  private peers: Map<string, SyncPeerInfo> = new Map();
  private unsubscribeListener: (() => void) | null = null;
  private isListeningActive = false;

  constructor(options?: CrossDomainSyncEngineOptions) {
    this.ownOrigin =
      options?.ownOrigin ??
      (typeof window !== 'undefined' && window.location ? window.location.origin : 'https://localhost');
    this.crdtSet = new CrdtLwwSet(options?.peerId);
    this.relayAdapter =
      options?.relayAdapter ??
      new PostMessageRelayAdapter(options?.whitelistedOrigins ?? [this.ownOrigin, '*']);
    this.signerAdapter = options?.signerAdapter ?? new HmacSignerAdapter();

    if (options?.sharedSecret) {
      this.sharedSecretKey = options.sharedSecret;
    }

    if (options?.whitelistedOrigins) {
      for (const origin of options.whitelistedOrigins) {
        this.registerPeer(origin);
      }
    }
  }

  public static getInstance(options?: CrossDomainSyncEngineOptions): CrossDomainSyncEngine {
    if (!CrossDomainSyncEngine.instance) {
      CrossDomainSyncEngine.instance = new CrossDomainSyncEngine(options);
    }
    return CrossDomainSyncEngine.instance;
  }

  public static resetInstance(): void {
    if (CrossDomainSyncEngine.instance) {
      CrossDomainSyncEngine.instance.stopListening();
      CrossDomainSyncEngine.instance = null;
    }
  }

  public async setSharedSecret(secret: string): Promise<Result<void, SyncError>> {
    try {
      if (!secret || secret.trim().length === 0) {
        return Result.err(new SyncError('CRYPTO_ERROR', 'Shared secret key cannot be empty'));
      }
      const importRes = await this.signerAdapter.importSecretKey(secret);
      if (!importRes.ok) {
        return Result.err(
          new SyncError('CRYPTO_ERROR', 'Failed to import secret key', importRes.error)
        );
      }
      this.sharedSecretKey = importRes.value;
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new SyncError(
          'CRYPTO_ERROR',
          `Error setting shared secret: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public registerPeer(origin: string): Result<void, SyncError> {
    try {
      if (!origin || origin.trim().length === 0) {
        return Result.err(new SyncError('ORIGIN_NOT_ALLOWED', 'Peer origin cannot be empty'));
      }
      this.relayAdapter.addWhitelistedOrigin(origin);
      this.peers.set(origin, {
        peerId: origin,
        origin,
        lastSeen: Date.now(),
      });
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new SyncError(
          'UNKNOWN_ERROR',
          `Failed to register peer: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public addWhitelistedOrigin(origin: string): void {
    this.registerPeer(origin);
  }

  public async synchronizeKey<T>(
    key: string,
    value: T,
    targetOrigin: string = '*'
  ): Promise<Result<void, SyncError>> {
    try {
      if (!key) {
        return Result.err(new SyncError('INVALID_PAYLOAD', 'Key cannot be empty'));
      }

      this.crdtSet.add(key, value);
      return await this.broadcastState(targetOrigin);
    } catch (err) {
      return Result.err(
        new SyncError(
          'UNKNOWN_ERROR',
          `Synchronize key failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async removeKey(
    key: string,
    targetOrigin: string = '*'
  ): Promise<Result<void, SyncError>> {
    try {
      if (!key) {
        return Result.err(new SyncError('INVALID_PAYLOAD', 'Key cannot be empty'));
      }

      this.crdtSet.remove(key);
      return await this.broadcastState(targetOrigin);
    } catch (err) {
      return Result.err(
        new SyncError(
          'UNKNOWN_ERROR',
          `Remove key failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async broadcastState(targetOrigin: string = '*'): Promise<Result<void, SyncError>> {
    try {
      if (!this.sharedSecretKey) {
        return Result.err(
          new SyncError('CRYPTO_ERROR', 'Shared secret key not configured for HMAC signing')
        );
      }

      const payloadState = JSON.stringify(this.crdtSet.getState());
      const signRes = await this.signerAdapter.sign(payloadState, this.sharedSecretKey);

      if (!signRes.ok) {
        return Result.err(
          new SyncError('CRYPTO_ERROR', 'Failed to generate HMAC signature', signRes.error)
        );
      }

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: `msg_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
        timestamp: Date.now(),
        sourceOrigin: this.ownOrigin,
        targetOrigin,
        action: 'CRDT_SYNC_MERGE',
        payload: payloadState,
        signature: signRes.value,
      };

      const sendRes = await this.relayAdapter.postMessage(envelope, targetOrigin);
      if (!sendRes.ok) return sendRes;

      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new SyncError(
          'NETWORK_ERROR',
          `Broadcast state failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async mergeRemoteState<T>(
    envelope: SignedSyncEnvelope
  ): Promise<Result<boolean, SyncError>> {
    try {
      if (!envelope || !envelope.signature || !envelope.payload) {
        return Result.err(new SyncError('INVALID_PAYLOAD', 'Invalid envelope for state merge'));
      }

      if (!this.sharedSecretKey) {
        return Result.err(
          new SyncError('CRYPTO_ERROR', 'Shared secret key not configured for verification')
        );
      }

      // Cryptographic signature verification
      const verifyRes = await this.signerAdapter.verify(
        envelope.payload,
        envelope.signature,
        this.sharedSecretKey
      );

      if (!verifyRes.ok || !verifyRes.value) {
        return Result.err(
          new SyncError('INVALID_SIGNATURE', 'HMAC signature verification failed - tamper detected')
        );
      }

      // Parse payload
      let remoteState: LwwSetState<T>;
      try {
        remoteState = JSON.parse(envelope.payload);
      } catch (e) {
        return Result.err(
          new SyncError('INVALID_PAYLOAD', 'Failed to parse remote state JSON payload', e)
        );
      }

      // Perform CRDT LWW-Element-Set merge
      this.crdtSet.merge(remoteState as any);

      // Update peer tracking
      if (envelope.sourceOrigin) {
        this.peers.set(envelope.sourceOrigin, {
          peerId: envelope.sourceOrigin,
          origin: envelope.sourceOrigin,
          lastSeen: Date.now(),
        });
      }

      return Result.ok(true);
    } catch (err) {
      return Result.err(
        new SyncError(
          'UNKNOWN_ERROR',
          `Merge remote state failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public startListening(): Result<void, SyncError> {
    if (this.isListeningActive) return Result.ok(undefined);

    const listenRes = this.relayAdapter.listen(async (envelope) => {
      await this.mergeRemoteState(envelope);
    });

    if (!listenRes.ok) return Result.err(listenRes.error);

    this.unsubscribeListener = listenRes.value;
    this.isListeningActive = true;
    return Result.ok(undefined);
  }

  public stopListening(): void {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
    }
    this.isListeningActive = false;
  }

  public getLocalState<T>(): LwwSetState<T> {
    return this.crdtSet.getState();
  }

  public getValue<T>(key: string): T | undefined {
    return this.crdtSet.get(key);
  }

  public hasKey(key: string): boolean {
    return this.crdtSet.has(key);
  }

  public getKeys(): string[] {
    return this.crdtSet.keys();
  }

  public getPeerInfos(): SyncPeerInfo[] {
    return Array.from(this.peers.values());
  }

  public getRelayAdapter(): PostMessageRelayPort {
    return this.relayAdapter;
  }
}
