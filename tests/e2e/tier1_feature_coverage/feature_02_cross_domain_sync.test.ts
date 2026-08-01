import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageTestHarness } from '../../../utils/storageTestHarness';
import { CrossDomainSyncEngine } from '../../../utils/crossDomainSyncEngine';
import { PostMessageRelayAdapter } from '../../../src/infrastructure/adapters/postMessageRelayAdapter';
import { HmacSignerAdapter } from '../../../src/infrastructure/adapters/hmacSignerAdapter';
import { SignedSyncEnvelope } from '../../../src/domain/model/syncMessage';

describe('Feature 02 Tier 1 E2E Coverage: Cross-Domain Storage Synchronization Protocol (ADR-0002)', () => {
  const MASTER_SECRET = 'e2e-sync-master-secret-key-999';
  const DOMAIN_A = 'https://app.suite.local';
  const DOMAIN_B = 'https://checkout.suite.local';
  const DOMAIN_EVIL = 'https://phishing.suite.local';

  let storageA: StorageTestHarness;
  let storageB: StorageTestHarness;
  let engineA: CrossDomainSyncEngine;
  let engineB: CrossDomainSyncEngine;
  let relayA: PostMessageRelayAdapter;
  let relayB: PostMessageRelayAdapter;

  beforeEach(async () => {
    CrossDomainSyncEngine.resetInstance();

    storageA = new StorageTestHarness();
    storageB = new StorageTestHarness();

    relayA = new PostMessageRelayAdapter([DOMAIN_A, DOMAIN_B]);
    relayB = new PostMessageRelayAdapter([DOMAIN_A, DOMAIN_B]);

    engineA = new CrossDomainSyncEngine({
      peerId: 'peer_domain_A',
      ownOrigin: DOMAIN_A,
      whitelistedOrigins: [DOMAIN_A, DOMAIN_B],
      relayAdapter: relayA,
    });

    engineB = new CrossDomainSyncEngine({
      peerId: 'peer_domain_B',
      ownOrigin: DOMAIN_B,
      whitelistedOrigins: [DOMAIN_A, DOMAIN_B],
      relayAdapter: relayB,
    });

    await engineA.setSharedSecret(MASTER_SECRET);
    await engineB.setSharedSecret(MASTER_SECRET);

    // Cross-link relays so postMessage on A invokes mergeRemoteState on B and vice-versa
    relayA.listen(async (envelope) => {
      await engineB.mergeRemoteState(envelope);
    });

    relayB.listen(async (envelope) => {
      await engineA.mergeRemoteState(envelope);
    });
  });

  afterEach(() => {
    CrossDomainSyncEngine.resetInstance();
  });

  it('2.1 should synchronize key-value additions from Domain A to Domain B and local storage harness', async () => {
    await storageA.setItem('local', 'session_id', 'sess_abc123');

    const syncRes = await engineA.synchronizeKey('session_id', 'sess_abc123', DOMAIN_B);
    expect(syncRes.ok).toBe(true);

    expect(engineB.hasKey('session_id')).toBe(true);
    expect(engineB.getValue('session_id')).toBe('sess_abc123');

    await storageB.setItem('local', 'session_id', engineB.getValue<string>('session_id')!);
    const valB = await storageB.getItem('local', 'session_id');
    expect(valB.ok && valB.value).toBe('sess_abc123');
  });

  it('2.2 should propagate deletion tombstones across domains and remove keys', async () => {
    await engineA.synchronizeKey('cart_items', JSON.stringify([{ id: 1, qty: 2 }]), DOMAIN_B);
    const cartVal = engineB.getValue<string>('cart_items');
    expect(cartVal).toBeDefined();
    expect(cartVal).toContain('qty":2');

    const removeRes = await engineA.removeKey('cart_items', DOMAIN_B);
    expect(removeRes.ok).toBe(true);

    expect(engineB.hasKey('cart_items')).toBe(false);
    expect(engineB.getValue('cart_items')).toBeUndefined();
  });

  it('2.3 should reject tampered payload envelope sent to Domain B', async () => {
    const signer = new HmacSignerAdapter();
    const payload = JSON.stringify(engineA.getLocalState());

    const tamperedEnvelope: SignedSyncEnvelope = {
      protocolVersion: '1.0',
      messageId: 'msg_tamper_e2e_1',
      timestamp: Date.now(),
      sourceOrigin: DOMAIN_A,
      targetOrigin: DOMAIN_B,
      action: 'CRDT_SYNC_MERGE',
      payload: '{"addSet":{"hacked_key":{"key":"hacked_key","value":"malicious","timestamp":999999999,"peerId":"evil","sequence":1}}}',
      signature: (await signer.sign(payload, MASTER_SECRET)).value || 'invalid_sig',
    };

    const mergeRes = await engineB.mergeRemoteState(tamperedEnvelope);
    expect(mergeRes.ok).toBe(false);
    if (!mergeRes.ok) {
      expect(mergeRes.error.code).toBe('INVALID_SIGNATURE');
    }
    expect(engineB.hasKey('hacked_key')).toBe(false);
  });

  it('2.4 should reject replayed envelope with identical message ID', async () => {
    const envelope: SignedSyncEnvelope = {
      protocolVersion: '1.0',
      messageId: 'msg_replay_e2e_001',
      timestamp: Date.now(),
      sourceOrigin: DOMAIN_A,
      targetOrigin: DOMAIN_B,
      action: 'CRDT_SYNC_MERGE',
      payload: JSON.stringify({ addSet: {}, removeSet: {} }),
      signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    const res1 = relayB.simulateIncomingMessage(envelope, DOMAIN_A);
    expect(res1.ok).toBe(true);

    const res2 = relayB.simulateIncomingMessage(envelope, DOMAIN_A);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error.code).toBe('REPLAY_DETECTED');
    }
  });

  it('2.5 should reject messages originating from non-whitelisted domain', () => {
    const envelope: SignedSyncEnvelope = {
      protocolVersion: '1.0',
      messageId: 'msg_evil_domain_1',
      timestamp: Date.now(),
      sourceOrigin: DOMAIN_EVIL,
      targetOrigin: DOMAIN_B,
      action: 'CRDT_SYNC_MERGE',
      payload: '{}',
      signature: '12345',
    };

    const res = relayB.simulateIncomingMessage(envelope, DOMAIN_EVIL);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });
});
