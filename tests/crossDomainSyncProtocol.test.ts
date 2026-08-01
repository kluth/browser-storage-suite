import { describe, it, expect, beforeEach } from 'vitest';
import { HmacSignerAdapter } from '../src/infrastructure/adapters/hmacSignerAdapter';
import { PostMessageRelayAdapter } from '../src/infrastructure/adapters/postMessageRelayAdapter';
import { CrossDomainSyncEngine } from '../utils/crossDomainSyncEngine';
import { SignedSyncEnvelope } from '../src/domain/model/syncMessage';

describe('Cross-Domain Sync Protocol & Security Unit Tests', () => {
  const SECRET_KEY = 'super-secret-master-key-1234567890';
  const ORIGIN_A = 'https://app.example.com';
  const ORIGIN_B = 'https://auth.example.com';
  const UNTRUSTED_ORIGIN = 'https://malicious-site.com';

  let hmacSigner: HmacSignerAdapter;
  let relayAdapter: PostMessageRelayAdapter;

  beforeEach(() => {
    hmacSigner = new HmacSignerAdapter();
    relayAdapter = new PostMessageRelayAdapter([ORIGIN_A, ORIGIN_B]);
    CrossDomainSyncEngine.resetInstance();
  });

  describe('HmacSignerAdapter Unit Tests', () => {
    it('should generate valid HMAC-SHA-256 signatures for payloads', async () => {
      const payload = '{"key":"session","value":"xyz"}';
      const signRes = await hmacSigner.sign(payload, SECRET_KEY);

      expect(signRes.ok).toBe(true);
      if (signRes.ok) {
        expect(signRes.value).toMatch(/^[0-9a-fA-F]{64}$/);
      }
    });

    it('should verify valid signatures correctly', async () => {
      const payload = '{"key":"theme","value":"dark"}';
      const signRes = await hmacSigner.sign(payload, SECRET_KEY);
      expect(signRes.ok).toBe(true);

      if (signRes.ok) {
        const verifyRes = await hmacSigner.verify(payload, signRes.value, SECRET_KEY);
        expect(verifyRes.ok).toBe(true);
        if (verifyRes.ok) {
          expect(verifyRes.value).toBe(true);
        }
      }
    });

    it('should reject tampered payload or modified signature', async () => {
      const originalPayload = '{"amount":100}';
      const tamperedPayload = '{"amount":999999}';

      const signRes = await hmacSigner.sign(originalPayload, SECRET_KEY);
      expect(signRes.ok).toBe(true);

      if (signRes.ok) {
        const verifyTampered = await hmacSigner.verify(tamperedPayload, signRes.value, SECRET_KEY);
        expect(verifyTampered.ok).toBe(true);
        if (verifyTampered.ok) {
          expect(verifyTampered.value).toBe(false);
        }

        const invalidSig = signRes.value.replace(/^./, '0');
        const verifyInvalidSig = await hmacSigner.verify(originalPayload, invalidSig, SECRET_KEY);
        expect(verifyInvalidSig.ok).toBe(true);
        if (verifyInvalidSig.ok) {
          expect(verifyInvalidSig.value).toBe(false);
        }
      }
    });

    it('should handle empty secret key gracefully with Result.err', async () => {
      const signRes = await hmacSigner.sign('test', '');
      expect(signRes.ok).toBe(false);
      if (!signRes.ok) {
        expect(signRes.error.code).toBe('INVALID_KEY');
      }
    });
  });

  describe('PostMessageRelayAdapter Security & Whitelisting Tests', () => {
    it('should enforce origin whitelisting', () => {
      expect(relayAdapter.isOriginAllowed(ORIGIN_A)).toBe(true);
      expect(relayAdapter.isOriginAllowed(ORIGIN_B)).toBe(true);
      expect(relayAdapter.isOriginAllowed(UNTRUSTED_ORIGIN)).toBe(false);
    });

    it('should block message processing from non-whitelisted origin', () => {
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_001',
        timestamp: Date.now(),
        sourceOrigin: UNTRUSTED_ORIGIN,
        targetOrigin: ORIGIN_A,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relayAdapter.simulateIncomingMessage(envelope, UNTRUSTED_ORIGIN);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
      }
    });

    it('should detect and reject replayed message IDs', () => {
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_replay_test_100',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_A,
        targetOrigin: ORIGIN_B,
        action: 'CRDT_SYNC_MERGE',
        payload: '{"addSet":{}}',
        signature: 'abcdef',
      };

      const res1 = relayAdapter.simulateIncomingMessage(envelope, ORIGIN_A);
      expect(res1.ok).toBe(true);

      const res2 = relayAdapter.simulateIncomingMessage(envelope, ORIGIN_A);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.code).toBe('REPLAY_DETECTED');
      }
    });

    it('should reject messages with timestamps exceeding max drift window', () => {
      relayAdapter.setMaxDriftMs(5000);

      const expiredEnvelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_expired_1',
        timestamp: Date.now() - 60000,
        sourceOrigin: ORIGIN_A,
        targetOrigin: ORIGIN_B,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: 'abcdef',
      };

      const res = relayAdapter.simulateIncomingMessage(expiredEnvelope, ORIGIN_A);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TIMESTAMP_DRIFT');
      }
    });
  });

  describe('CrossDomainSyncEngine Facade Integration Tests', () => {
    let engineA: CrossDomainSyncEngine;
    let engineB: CrossDomainSyncEngine;
    let relayA: PostMessageRelayAdapter;
    let relayB: PostMessageRelayAdapter;

    beforeEach(async () => {
      relayA = new PostMessageRelayAdapter([ORIGIN_A, ORIGIN_B]);
      relayB = new PostMessageRelayAdapter([ORIGIN_A, ORIGIN_B]);

      engineA = new CrossDomainSyncEngine({
        peerId: 'peer_engine_A',
        ownOrigin: ORIGIN_A,
        relayAdapter: relayA,
        whitelistedOrigins: [ORIGIN_A, ORIGIN_B],
      });

      engineB = new CrossDomainSyncEngine({
        peerId: 'peer_engine_B',
        ownOrigin: ORIGIN_B,
        relayAdapter: relayB,
        whitelistedOrigins: [ORIGIN_A, ORIGIN_B],
      });

      await engineA.setSharedSecret(SECRET_KEY);
      await engineB.setSharedSecret(SECRET_KEY);

      relayA.listen(async (envelope) => {
        await engineB.mergeRemoteState(envelope);
      });

      relayB.listen(async (envelope) => {
        await engineA.mergeRemoteState(envelope);
      });
    });

    it('should synchronize key updates between Engine A and Engine B', async () => {
      const syncRes = await engineA.synchronizeKey('auth_token', 'jwt_token_value_999', ORIGIN_B);
      expect(syncRes.ok).toBe(true);

      expect(engineB.hasKey('auth_token')).toBe(true);
      expect(engineB.getValue('auth_token')).toBe('jwt_token_value_999');
    });

    it('should reject state merge if envelope signature is tampered', async () => {
      const payloadState = JSON.stringify(engineA.getLocalState());

      const tamperedEnvelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_tampered_test',
        timestamp: Date.now(),
        sourceOrigin: ORIGIN_A,
        targetOrigin: ORIGIN_B,
        action: 'CRDT_SYNC_MERGE',
        payload: payloadState,
        signature: '0000000000000000000000000000000000000000000000000000000000000000',
      };

      const mergeRes = await engineB.mergeRemoteState(tamperedEnvelope);
      expect(mergeRes.ok).toBe(false);
      if (!mergeRes.ok) {
        expect(mergeRes.error.code).toBe('INVALID_SIGNATURE');
      }
    });
  });
});
