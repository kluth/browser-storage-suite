import { describe, it, expect, beforeEach } from 'vitest';
import { HmacSignerAdapter } from '../src/infrastructure/adapters/hmacSignerAdapter';
import { PostMessageRelayAdapter } from '../src/infrastructure/adapters/postMessageRelayAdapter';
import { CrossDomainSyncEngine } from '../utils/crossDomainSyncEngine';
import { SignedSyncEnvelope } from '../src/domain/model/syncMessage';

describe('ADR-0002 Cross-Domain Sync Security & Transport Adversarial Suite', () => {
  const MASTER_KEY = 'super-secret-master-key-32-chars-long!!';
  const FORGED_KEY = 'wrong-attacker-secret-key-32-chars!!';
  const VALID_ORIGIN = 'https://app.example.com';
  const TRUSTED_PEER = 'https://auth.example.com';
  const ATTACKER_SUBDOMAIN = 'https://app.example.com.attacker.com';
  const ATTACKER_PREFIX = 'https://attacker-app.example.com';
  const ATTACKER_PORT = 'https://app.example.com:8443';
  const MALICIOUS_ORIGIN = 'https://evil.com';

  let signer: HmacSignerAdapter;
  let relay: PostMessageRelayAdapter;
  let engine: CrossDomainSyncEngine;

  beforeEach(async () => {
    signer = new HmacSignerAdapter();
    relay = new PostMessageRelayAdapter([VALID_ORIGIN, TRUSTED_PEER]);
    CrossDomainSyncEngine.resetInstance();

    engine = new CrossDomainSyncEngine({
      peerId: 'victim_engine',
      ownOrigin: VALID_ORIGIN,
      relayAdapter: relay,
      whitelistedOrigins: [VALID_ORIGIN, TRUSTED_PEER],
    });
    await engine.setSharedSecret(MASTER_KEY);
  });

  // --------------------------------------------------------------------------
  // 1. FORGED HMAC SIGNATURES
  // --------------------------------------------------------------------------
  describe('1. Forged HMAC Signatures & Key Boundaries', () => {
    it('should reject signatures generated with an invalid/wrong secret key', async () => {
      const attackerSigner = new HmacSignerAdapter();
      const payload = JSON.stringify({ addSet: { secret_data: { value: 'hacked', timestamp: Date.now(), peerId: 'attacker', sequenceNumber: 1 } }, tombstones: {} });
      const forgedSignRes = await attackerSigner.sign(payload, FORGED_KEY);
      expect(forgedSignRes.ok).toBe(true);

      if (forgedSignRes.ok) {
        const verifyRes = await signer.verify(payload, forgedSignRes.value, MASTER_KEY);
        expect(verifyRes.ok).toBe(true);
        if (verifyRes.ok) {
          expect(verifyRes.value).toBe(false);
        }

        const envelope: SignedSyncEnvelope = {
          protocolVersion: '1.0',
          messageId: 'msg_forged_key_1',
          timestamp: Date.now(),
          sourceOrigin: TRUSTED_PEER,
          targetOrigin: VALID_ORIGIN,
          action: 'CRDT_SYNC_MERGE',
          payload,
          signature: forgedSignRes.value,
        };

        const mergeRes = await engine.mergeRemoteState(envelope);
        expect(mergeRes.ok).toBe(false);
        if (!mergeRes.ok) {
          expect(mergeRes.error.code).toBe('INVALID_SIGNATURE');
        }
      }
    });

    it('should reject payloads with single-bit alterations', async () => {
      const validPayload = JSON.stringify({ addSet: { balance: { value: 100, timestamp: Date.now(), peerId: 'bank', sequenceNumber: 1 } }, tombstones: {} });
      const signRes = await signer.sign(validPayload, MASTER_KEY);
      expect(signRes.ok).toBe(true);

      if (signRes.ok) {
        const alteredPayload = JSON.stringify({ addSet: { balance: { value: 101, timestamp: Date.now(), peerId: 'bank', sequenceNumber: 1 } }, tombstones: {} });

        const verifyRes = await signer.verify(alteredPayload, signRes.value, MASTER_KEY);
        expect(verifyRes.ok).toBe(true);
        if (verifyRes.ok) {
          expect(verifyRes.value).toBe(false);
        }

        const tamperedEnvelope: SignedSyncEnvelope = {
          protocolVersion: '1.0',
          messageId: 'msg_altered_bit_1',
          timestamp: Date.now(),
          sourceOrigin: TRUSTED_PEER,
          targetOrigin: VALID_ORIGIN,
          action: 'CRDT_SYNC_MERGE',
          payload: alteredPayload,
          signature: signRes.value,
        };

        const mergeRes = await engine.mergeRemoteState(tamperedEnvelope);
        expect(mergeRes.ok).toBe(false);
        if (!mergeRes.ok) {
          expect(mergeRes.error.code).toBe('INVALID_SIGNATURE');
        }
      }
    });

    it('should reject non-hex and malformed signature strings safely without throwing', async () => {
      const payload = '{"test":true}';
      const malformedSignatures = [
        'not_hex_at_all!',
        '12345g', // invalid hex char 'g'
        'abc', // odd length hex string
        '', // empty signature
        '0'.repeat(63), // odd length 63 hex digits
        'ZZZZ'.repeat(16),
      ];

      for (const sig of malformedSignatures) {
        const verifyRes = await signer.verify(payload, sig, MASTER_KEY);
        expect(verifyRes.ok).toBe(true);
        if (verifyRes.ok) {
          expect(verifyRes.value).toBe(false);
        }

        const envelope: SignedSyncEnvelope = {
          protocolVersion: '1.0',
          messageId: `msg_malformed_sig_${Math.random()}`,
          timestamp: Date.now(),
          sourceOrigin: TRUSTED_PEER,
          targetOrigin: VALID_ORIGIN,
          action: 'CRDT_SYNC_MERGE',
          payload,
          signature: sig,
        };

        const mergeRes = await engine.mergeRemoteState(envelope);
        expect(mergeRes.ok).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. ORIGIN SPOOFING & WHITELIST BYPASS ATTEMPTS
  // --------------------------------------------------------------------------
  describe('2. Origin Spoofing & Subdomain Matching Bypasses', () => {
    it('should reject subdomain suffixes (app.example.com.attacker.com)', () => {
      expect(relay.isOriginAllowed(ATTACKER_SUBDOMAIN)).toBe(false);

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_spoof_subdomain_1',
        timestamp: Date.now(),
        sourceOrigin: ATTACKER_SUBDOMAIN,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(envelope, ATTACKER_SUBDOMAIN);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
      }
    });

    it('should reject prefix origin spoofing (attacker-app.example.com)', () => {
      expect(relay.isOriginAllowed(ATTACKER_PREFIX)).toBe(false);

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_spoof_prefix_1',
        timestamp: Date.now(),
        sourceOrigin: ATTACKER_PREFIX,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(envelope, ATTACKER_PREFIX);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
      }
    });

    it('should reject different port origin (app.example.com:8443)', () => {
      expect(relay.isOriginAllowed(ATTACKER_PORT)).toBe(false);

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_spoof_port_1',
        timestamp: Date.now(),
        sourceOrigin: ATTACKER_PORT,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(envelope, ATTACKER_PORT);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
      }
    });

    it('should reject empty or null origin parameters', () => {
      expect(relay.isOriginAllowed('')).toBe(false);

      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_spoof_empty_1',
        timestamp: Date.now(),
        sourceOrigin: '',
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(envelope, '');
      expect(res.ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. REPLAY ATTACKS & SLIDING LRU NONCE WINDOW
  // --------------------------------------------------------------------------
  describe('3. Replay Attacks & Nonce Deduplication', () => {
    it('should reject duplicate messageId nonces immediately', () => {
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'nonce_replay_001',
        timestamp: Date.now(),
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res1 = relay.simulateIncomingMessage(envelope, TRUSTED_PEER);
      expect(res1.ok).toBe(true);

      const res2 = relay.simulateIncomingMessage(envelope, TRUSTED_PEER);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.code).toBe('REPLAY_DETECTED');
      }
    });

    it('should maintain sliding window LRU eviction behavior up to 1000 nonces', () => {
      // Send 1000 unique nonces
      for (let i = 0; i < 1000; i++) {
        const env: SignedSyncEnvelope = {
          protocolVersion: '1.0',
          messageId: `nonce_batch_${i}`,
          timestamp: Date.now(),
          sourceOrigin: TRUSTED_PEER,
          targetOrigin: VALID_ORIGIN,
          action: 'CRDT_SYNC_MERGE',
          payload: '{}',
          signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        };
        const res = relay.simulateIncomingMessage(env, TRUSTED_PEER);
        expect(res.ok).toBe(true);
      }

      // Replay of the 999th nonce should be rejected
      const envRecent: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'nonce_batch_999',
        timestamp: Date.now(),
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      const resRecent = relay.simulateIncomingMessage(envRecent, TRUSTED_PEER);
      expect(resRecent.ok).toBe(false);
      if (!resRecent.ok) {
        expect(resRecent.error.code).toBe('REPLAY_DETECTED');
      }

      // Adding 1001st nonce will trigger LRU eviction of the 0th nonce ('nonce_batch_0')
      const env1001: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'nonce_batch_1000',
        timestamp: Date.now(),
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      expect(relay.simulateIncomingMessage(env1001, TRUSTED_PEER).ok).toBe(true);

      // Verify earliest nonce was evicted from LRU cache
      const envEvicted: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'nonce_batch_0',
        timestamp: Date.now(),
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      const resEvicted = relay.simulateIncomingMessage(envEvicted, TRUSTED_PEER);
      expect(resEvicted.ok).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. TIMESTAMP DRIFT BOUNDS (+/- 30,000 ms)
  // --------------------------------------------------------------------------
  describe('4. Timestamp Drift Bounds Enforcement', () => {
    it('should accept timestamps exactly within +/- 30,000 ms envelope', () => {
      const now = Date.now();

      const validFutureEnv: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_ts_future_valid',
        timestamp: now + 29990,
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      expect(relay.simulateIncomingMessage(validFutureEnv, TRUSTED_PEER).ok).toBe(true);

      const validPastEnv: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_ts_past_valid',
        timestamp: now - 29990,
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      expect(relay.simulateIncomingMessage(validPastEnv, TRUSTED_PEER).ok).toBe(true);
    });

    it('should reject future timestamps exceeding +30,000 ms boundary', () => {
      const now = Date.now();
      const futureDriftEnv: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_ts_future_invalid',
        timestamp: now + 30005,
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(futureDriftEnv, TRUSTED_PEER);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TIMESTAMP_DRIFT');
      }
    });

    it('should reject past timestamps exceeding -30,000 ms boundary', () => {
      const now = Date.now();
      const pastDriftEnv: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_ts_past_invalid',
        timestamp: now - 35000,
        sourceOrigin: TRUSTED_PEER,
        targetOrigin: VALID_ORIGIN,
        action: 'CRDT_SYNC_MERGE',
        payload: '{}',
        signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const res = relay.simulateIncomingMessage(pastDriftEnv, TRUSTED_PEER);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TIMESTAMP_DRIFT');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. MALFORMED / CORRUPTED POSTMESSAGE PAYLOADS
  // --------------------------------------------------------------------------
  describe('5. Malformed & Corrupted PostMessage Payloads', () => {
    it('should handle primitive and non-object postMessage inputs gracefully', () => {
      const badInputs = [null, undefined, 'raw_string_payload', 12345, true, [1, 2, 3]];

      for (const input of badInputs) {
        const res = relay.simulateIncomingMessage(input, TRUSTED_PEER);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('INVALID_PAYLOAD');
        }
      }
    });

    it('should reject partial envelopes with missing required fields', () => {
      const partialEnvelopes: Partial<SignedSyncEnvelope>[] = [
        { messageId: 'm1', timestamp: Date.now() }, // missing signature, action, etc.
        { protocolVersion: '1.0', messageId: 'm2', timestamp: Date.now(), sourceOrigin: TRUSTED_PEER },
        { protocolVersion: '1.0', messageId: 'm3', timestamp: Date.now(), sourceOrigin: TRUSTED_PEER, action: 'CRDT_SYNC_MERGE', payload: '{}' }, // missing signature
      ];

      for (const partial of partialEnvelopes) {
        const res = relay.simulateIncomingMessage(partial, TRUSTED_PEER);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('INVALID_PAYLOAD');
        }
      }
    });

    it('should reject invalid non-JSON remote state payloads in engine merge', async () => {
      const corruptPayloads = [
        '{ invalid_json: ',
        'undefined',
        '<html><body>404 Not Found</body></html>',
        '<<<XML HEADER>>>',
      ];

      for (const corruptPayload of corruptPayloads) {
        const signRes = await signer.sign(corruptPayload, MASTER_KEY);
        expect(signRes.ok).toBe(true);

        if (signRes.ok) {
          const envelope: SignedSyncEnvelope = {
            protocolVersion: '1.0',
            messageId: `msg_corrupt_json_${Math.random()}`,
            timestamp: Date.now(),
            sourceOrigin: TRUSTED_PEER,
            targetOrigin: VALID_ORIGIN,
            action: 'CRDT_SYNC_MERGE',
            payload: corruptPayload,
            signature: signRes.value,
          };

          const mergeRes = await engine.mergeRemoteState(envelope);
          expect(mergeRes.ok).toBe(false);
          if (!mergeRes.ok) {
            expect(mergeRes.error.code).toBe('INVALID_PAYLOAD');
          }
        }
      }
    });
  });
});
