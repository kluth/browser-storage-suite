import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrossDomainSyncEngine } from '../utils/crossDomainSyncEngine';
import { PostMessageRelayAdapter } from '../src/infrastructure/adapters/postMessageRelayAdapter';
import { HmacSignerAdapter } from '../src/infrastructure/adapters/hmacSignerAdapter';
import { SignedSyncEnvelope } from '../src/domain/model/syncMessage';

describe('CrossDomainSyncEngine & Infrastructure Adapters Deep Mutation Tests', () => {
  const SECRET = 'deep-mutation-secret-key-12345';
  const ORIGIN_1 = 'https://app1.test.com';
  const ORIGIN_2 = 'https://app2.test.com';

  beforeEach(() => {
    CrossDomainSyncEngine.resetInstance();
  });

  afterEach(() => {
    CrossDomainSyncEngine.resetInstance();
  });

  describe('CrossDomainSyncEngine Singleton & Configuration Tests', () => {
    it('should manage singleton instances via getInstance() and resetInstance()', () => {
      const inst1 = CrossDomainSyncEngine.getInstance({ peerId: 'p1', ownOrigin: ORIGIN_1 });
      const inst2 = CrossDomainSyncEngine.getInstance();
      expect(inst1).toBe(inst2);

      CrossDomainSyncEngine.resetInstance();
      const inst3 = CrossDomainSyncEngine.getInstance({ peerId: 'p3', ownOrigin: ORIGIN_2 });
      expect(inst3).not.toBe(inst1);
    });

    it('should handle setSharedSecret with empty/whitespace key error', async () => {
      const engine = new CrossDomainSyncEngine();
      const res = await engine.setSharedSecret('   ');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('CRYPTO_ERROR');
        expect(res.error.message).toContain('cannot be empty');
      }
    });

    it('should handle registerPeer with empty/whitespace origin error', () => {
      const engine = new CrossDomainSyncEngine();
      const res = engine.registerPeer('  ');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
        expect(res.error.message).toContain('cannot be empty');
      }
    });

    it('should register valid peers and track peer info', () => {
      const engine = new CrossDomainSyncEngine({ whitelistedOrigins: [ORIGIN_1] });
      engine.addWhitelistedOrigin(ORIGIN_2);

      const peerInfos = engine.getPeerInfos();
      expect(peerInfos.some((p) => p.origin === ORIGIN_2)).toBe(true);
      const peerObj = peerInfos.find((p) => p.origin === ORIGIN_2);
      expect(peerObj?.peerId).toBe(ORIGIN_2);
      expect(peerObj?.lastSeen).toBeGreaterThan(0);
    });

    it('should reject synchronizeKey and removeKey when key is empty', async () => {
      const engine = new CrossDomainSyncEngine();
      await engine.setSharedSecret(SECRET);

      const syncRes = await engine.synchronizeKey('', 'val');
      expect(syncRes.ok).toBe(false);
      if (!syncRes.ok) {
        expect(syncRes.error.code).toBe('INVALID_PAYLOAD');
        expect(syncRes.error.message).toBe('Key cannot be empty');
      }

      const removeRes = await engine.removeKey('');
      expect(removeRes.ok).toBe(false);
      if (!removeRes.ok) {
        expect(removeRes.error.code).toBe('INVALID_PAYLOAD');
        expect(removeRes.error.message).toBe('Key cannot be empty');
      }
    });

    it('should fail broadcastState if shared secret key is not set', async () => {
      const engine = new CrossDomainSyncEngine({ ownOrigin: ORIGIN_1 });
      const syncRes = await engine.synchronizeKey('key1', 'val1');
      expect(syncRes.ok).toBe(false);
      if (!syncRes.ok) {
        expect(syncRes.error.code).toBe('CRYPTO_ERROR');
        expect(syncRes.error.message).toContain('Shared secret key not configured');
      }
    });

    it('should fail mergeRemoteState if shared secret key is not set', async () => {
      const engine = new CrossDomainSyncEngine();
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_1',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: '*',
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      const mergeRes = await engine.mergeRemoteState(envelope);
      expect(mergeRes.ok).toBe(false);
      if (!mergeRes.ok) {
        expect(mergeRes.error.code).toBe('CRYPTO_ERROR');
        expect(mergeRes.error.message).toContain('Shared secret key not configured');
      }
    });

    it('should fail mergeRemoteState when envelope payload is invalid JSON', async () => {
      const engine = new CrossDomainSyncEngine();
      await engine.setSharedSecret(SECRET);

      const signer = new HmacSignerAdapter();
      const invalidJsonPayload = 'invalid-json-{';
      const sig = (await signer.sign(invalidJsonPayload, SECRET)).value!;

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_bad_json',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: '*',
        action: 'CRDT_SYNC_MERGE',
        payload: invalidJsonPayload,
        signature: sig,
      };

      const mergeRes = await engine.mergeRemoteState(envelope);
      expect(mergeRes.ok).toBe(false);
      if (!mergeRes.ok) {
        expect(mergeRes.error.code).toBe('INVALID_PAYLOAD');
        expect(mergeRes.error.message).toContain('Failed to parse remote state JSON payload');
      }
    });

    it('should update peer lastSeen in mergeRemoteState when sourceOrigin is present', async () => {
      const engine = new CrossDomainSyncEngine();
      await engine.setSharedSecret(SECRET);

      const payload = JSON.stringify({ addSet: {}, removeSet: {} });
      const signer = new HmacSignerAdapter();
      const sig = (await signer.sign(payload, SECRET)).value!;

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_peer_track_1',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_2,
        targetOrigin: '*',
        action: 'CRDT_SYNC_MERGE',
        payload,
        signature: sig,
      };

      const mergeRes = await engine.mergeRemoteState(envelope);
      expect(mergeRes.ok).toBe(true);
      expect(mergeRes.value).toBe(true);

      const peerInfos = engine.getPeerInfos();
      const peer = peerInfos.find((p) => p.origin === ORIGIN_2);
      expect(peer).toBeDefined();
      expect(peer?.lastSeen).toBeGreaterThan(0);
    });

    it('should manage key querying methods: getValue, hasKey, getKeys', async () => {
      const engine = new CrossDomainSyncEngine();
      await engine.setSharedSecret(SECRET);

      await engine.synchronizeKey('k1', { count: 10 });
      expect(engine.hasKey('k1')).toBe(true);
      expect(engine.getValue('k1')).toEqual({ count: 10 });
      expect(engine.getKeys()).toEqual(['k1']);

      await engine.removeKey('k1');
      expect(engine.hasKey('k1')).toBe(false);
      expect(engine.getValue('k1')).toBeUndefined();
    });

    it('should handle startListening and stopListening lifecycle correctly', async () => {
      const engine = new CrossDomainSyncEngine();
      const startRes1 = engine.startListening();
      expect(startRes1.ok).toBe(true);

      const startRes2 = engine.startListening();
      expect(startRes2.ok).toBe(true);

      engine.stopListening();
      engine.stopListening();
    });
  });

  describe('PostMessageRelayAdapter Deep Edge Case & Mutation Tests', () => {
    let relay: PostMessageRelayAdapter;

    beforeEach(() => {
      relay = new PostMessageRelayAdapter([ORIGIN_1]);
    });

    it('should allow adding origins via addWhitelistedOrigin()', () => {
      expect(relay.isOriginAllowed(ORIGIN_2)).toBe(false);
      relay.addWhitelistedOrigin(ORIGIN_2);
      expect(relay.isOriginAllowed(ORIGIN_2)).toBe(true);
    });

    it('should overwrite origins via setWhitelistedOrigins()', () => {
      relay.setWhitelistedOrigins([ORIGIN_2]);
      expect(relay.isOriginAllowed(ORIGIN_1)).toBe(false);
      expect(relay.isOriginAllowed(ORIGIN_2)).toBe(true);
    });

    it('should support wildcard "*" origin in isOriginAllowed', () => {
      const wildcardRelay = new PostMessageRelayAdapter(['*']);
      expect(wildcardRelay.isOriginAllowed('https://any-domain.com')).toBe(true);
      expect(wildcardRelay.isOriginAllowed('https://another-domain.com')).toBe(true);
    });

    it('should dispatch postMessage to custom targetWindow if provided', async () => {
      const mockWin = {
        postMessage: vi.fn(),
      };

      const validEnvelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_target_win',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: ORIGIN_1,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      const res = await relay.postMessage(validEnvelope, ORIGIN_1, mockWin);
      expect(res.ok).toBe(true);
      expect(mockWin.postMessage).toHaveBeenCalledWith(validEnvelope, ORIGIN_1);
    });

    it('should reject postMessage when envelope is invalid or missing fields', async () => {
      const badEnvelope = {} as SignedSyncEnvelope;
      const res = await relay.postMessage(badEnvelope, ORIGIN_1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD');
      }
    });

    it('should reject postMessage when target origin is not whitelisted', async () => {
      const validEnvelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_val',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: ORIGIN_2,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      const res = await relay.postMessage(validEnvelope, ORIGIN_2);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
        expect(res.error.message).toContain('is not whitelisted');
      }
    });

    it('should enforce setMaxDriftMs boundary window', async () => {
      relay.setMaxDriftMs(100);
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_drift_test',
        timestamp: Date.now() - 500, // 500ms ago > 100ms
        sourceOrigin: ORIGIN_1,
        targetOrigin: ORIGIN_1,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      const res = relay.simulateIncomingMessage(envelope, ORIGIN_1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TIMESTAMP_DRIFT');
      }
    });

    it('should reject simulateIncomingMessage when data is null, non-object, or missing required fields', () => {
      expect(relay.simulateIncomingMessage(null, ORIGIN_1).ok).toBe(false);
      expect(relay.simulateIncomingMessage('string-data', ORIGIN_1).ok).toBe(false);

      const partialEnvelope = { protocolVersion: '1.0' };
      const res = relay.simulateIncomingMessage(partialEnvelope, ORIGIN_1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD');
        expect(res.error.message).toContain('missing required fields');
      }
    });

    it('should reset nonces using resetNonces()', () => {
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_reset_test',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: '*',
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      expect(relay.simulateIncomingMessage(envelope, ORIGIN_1).ok).toBe(true);
      expect(relay.simulateIncomingMessage(envelope, ORIGIN_1).ok).toBe(false);

      relay.resetNonces();
      expect(relay.simulateIncomingMessage(envelope, ORIGIN_1).ok).toBe(true);
    });

    it('should unsubscribe listeners correctly', () => {
      let callCount = 0;
      const listenRes = relay.listen(() => {
        callCount++;
      });
      expect(listenRes.ok).toBe(true);

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_unsub_1',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_1,
        targetOrigin: '*',
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234',
      };

      relay.simulateIncomingMessage(envelope, ORIGIN_1);
      expect(callCount).toBe(1);

      if (listenRes.ok) {
        listenRes.value();
      }

      const envelope2 = { ...envelope, messageId: 'msg_unsub_2' };
      relay.simulateIncomingMessage(envelope2, ORIGIN_1);
      expect(callCount).toBe(1);
    });
  });

  describe('HmacSignerAdapter Deep Edge Case & Mutation Tests', () => {
    let signer: HmacSignerAdapter;

    beforeEach(() => {
      signer = new HmacSignerAdapter();
    });

    it('should reject importSecretKey with empty secret string', async () => {
      const res = await signer.importSecretKey('');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_KEY');
        expect(res.error.message).toContain('cannot be empty');
      }
    });

    it('should sign and verify payloads using imported CryptoKey objects directly', async () => {
      const importRes = await signer.importSecretKey(SECRET);
      expect(importRes.ok).toBe(true);
      if (importRes.ok) {
        const cryptoKey = importRes.value;

        const signRes = await signer.sign('crypto-key-payload', cryptoKey);
        expect(signRes.ok).toBe(true);
        if (signRes.ok) {
          const verifyRes = await signer.verify('crypto-key-payload', signRes.value, cryptoKey);
          expect(verifyRes.ok).toBe(true);
          expect(verifyRes.value).toBe(true);
        }
      }
    });

    it('should reject signing when payload is null or undefined', async () => {
      const res = await signer.sign(null as any, SECRET);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });

    it('should return false on verify when payload or signature is empty', async () => {
      expect((await signer.verify('', '1234', SECRET)).value).toBe(false);
      expect((await signer.verify('payload', '', SECRET)).value).toBe(false);
    });

    it('should return false on verify when signature hex format is invalid', async () => {
      expect((await signer.verify('payload', 'not-hex-chars', SECRET)).value).toBe(false);
      expect((await signer.verify('payload', '123', SECRET)).value).toBe(false); // odd length
    });
  });
});
