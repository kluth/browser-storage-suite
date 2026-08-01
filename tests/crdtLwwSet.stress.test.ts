import { describe, it, expect, beforeEach } from 'vitest';
import { CrdtLwwSet, isNewerOrEqual, LwwSetState } from '../src/domain/model/crdtLwwSet';
import { CrossDomainSyncEngine } from '../utils/crossDomainSyncEngine';
import { SignedSyncEnvelope } from '../src/domain/model/syncMessage';

/**
 * Seeded PRNG for reproducible property-based generator testing
 */
class PseudoRandom {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed;
  }

  public nextFloat(): number {
    this.state = (this.state * 9301 + 49297) % 233280;
    return this.state / 233280;
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  public pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

describe('CRDT LWW-Element-Set Concurrency & Stress Harness', () => {
  let rng: PseudoRandom;

  beforeEach(() => {
    rng = new PseudoRandom(1337);
  });

  describe('1. Property-Based Fuzzing & Mathematical Invariants', () => {
    function generateRandomCrdtSet(
      rng: PseudoRandom,
      peerId: string,
      numOps: number,
      keyPool: string[],
      baseTime: number
    ): CrdtLwwSet<string> {
      const crdt = new CrdtLwwSet<string>(peerId);
      for (let i = 0; i < numOps; i++) {
        const key = rng.pick(keyPool);
        const val = `val_${peerId}_${i}_${rng.nextInt(1, 100)}`;
        const tsOffset = rng.nextInt(-50, 50);
        const ts = baseTime + tsOffset;
        const seq = rng.nextInt(1, 100);

        if (rng.nextFloat() > 0.3) {
          crdt.add(key, val, ts, peerId, seq);
        } else {
          crdt.remove(key, ts, peerId, seq);
        }
      }
      return crdt;
    }

    it('should satisfy Commutativity across 100 random CRDT state pairs: merge(A, B) === merge(B, A)', () => {
      const keyPool = ['user_id', 'theme', 'cart_items', 'auth_token', 'lang', 'notifications', 'volume'];
      const baseTime = 1700000000000;

      for (let trial = 0; trial < 100; trial++) {
        const trialRng = new PseudoRandom(trial * 17 + 1);
        const crdtA = generateRandomCrdtSet(trialRng, 'peer_A', 30, keyPool, baseTime);
        const crdtB = generateRandomCrdtSet(trialRng, 'peer_B', 30, keyPool, baseTime);

        // Merge A into B copy
        const ab = new CrdtLwwSet<string>('peer_AB');
        ab.merge(crdtA);
        ab.merge(crdtB);

        // Merge B into A copy
        const ba = new CrdtLwwSet<string>('peer_BA');
        ba.merge(crdtB);
        ba.merge(crdtA);

        expect(ab.getState()).toEqual(ba.getState());
        expect(ab.keys().sort()).toEqual(ba.keys().sort());
        for (const k of ab.keys()) {
          expect(ab.get(k)).toBe(ba.get(k));
        }
      }
    });

    it('should satisfy Associativity across 50 random CRDT state triples: merge(merge(A, B), C) === merge(A, merge(B, C))', () => {
      const keyPool = ['k1', 'k2', 'k3', 'k4', 'k5'];
      const baseTime = 1700000000000;

      for (let trial = 0; trial < 50; trial++) {
        const trialRng = new PseudoRandom(trial * 31 + 7);
        const crdtA = generateRandomCrdtSet(trialRng, 'peer_A', 25, keyPool, baseTime);
        const crdtB = generateRandomCrdtSet(trialRng, 'peer_B', 25, keyPool, baseTime);
        const crdtC = generateRandomCrdtSet(trialRng, 'peer_C', 25, keyPool, baseTime);

        // (A + B) + C
        const left = new CrdtLwwSet<string>('peer_left');
        left.merge(crdtA);
        left.merge(crdtB);
        left.merge(crdtC);

        // A + (B + C)
        const bc = new CrdtLwwSet<string>('peer_bc');
        bc.merge(crdtB);
        bc.merge(crdtC);
        const right = new CrdtLwwSet<string>('peer_right');
        right.merge(crdtA);
        right.merge(bc);

        expect(left.getState()).toEqual(right.getState());
      }
    });

    it('should satisfy Idempotency across 50 random CRDT states: merge(A, A) === A', () => {
      const keyPool = ['alpha', 'beta', 'gamma', 'delta'];
      const baseTime = 1700000000000;

      for (let trial = 0; trial < 50; trial++) {
        const trialRng = new PseudoRandom(trial * 13 + 5);
        const crdt = generateRandomCrdtSet(trialRng, 'peer_A', 40, keyPool, baseTime);
        const initialSnapshot = JSON.parse(JSON.stringify(crdt.getState()));

        crdt.merge(crdt);
        crdt.merge(crdt.getState());

        expect(crdt.getState()).toEqual(initialSnapshot);
      }
    });
  });

  describe('2. Multi-Peer High Concurrency & Out-of-Order Delivery Stress', () => {
    it('should reach 100% deterministic convergence across 10 peers with 1,000 out-of-order state merges', () => {
      const numPeers = 10;
      const peers: CrdtLwwSet<string>[] = [];
      const keyPool = Array.from({ length: 20 }, (_, i) => `key_${i}`);
      const baseTime = Date.now();

      for (let p = 0; p < numPeers; p++) {
        peers.push(new CrdtLwwSet<string>(`peer_${p.toString().padStart(2, '0')}`));
      }

      // Generate random operations on each peer
      const generatedStates: LwwSetState<string>[] = [];

      for (let round = 0; round < 20; round++) {
        for (let p = 0; p < numPeers; p++) {
          const peer = peers[p];
          const k = rng.pick(keyPool);
          const v = `v_round${round}_peer${p}_${rng.nextInt(1, 999)}`;
          const ts = baseTime + rng.nextInt(-100, 100);

          if (rng.nextFloat() > 0.35) {
            peer.add(k, v, ts);
          } else {
            peer.remove(k, ts);
          }
          generatedStates.push(peer.getState());
        }
      }

      // Collect states and shuffle them to simulate out-of-order delivery
      const shuffledStates = [...generatedStates];
      for (let i = shuffledStates.length - 1; i > 0; i--) {
        const j = Math.floor(rng.nextFloat() * (i + 1));
        [shuffledStates[i], shuffledStates[j]] = [shuffledStates[j], shuffledStates[i]];
      }

      // Apply shuffled states to all peers
      for (const peer of peers) {
        for (const state of shuffledStates) {
          peer.merge(state);
        }
      }

      // Verify all peers have identical keys, values, and internal CRDT states
      const referenceState = peers[0].getState();
      const referenceKeys = peers[0].keys().sort();

      for (let p = 1; p < numPeers; p++) {
        expect(peers[p].getState()).toEqual(referenceState);
        expect(peers[p].keys().sort()).toEqual(referenceKeys);
        for (const k of referenceKeys) {
          expect(peers[p].get(k)).toBe(peers[0].get(k));
        }
      }
    });

    it('should resolve network partition and heal state under conflicting concurrent writes', () => {
      const partitionAlpha = [new CrdtLwwSet<string>('node_A1'), new CrdtLwwSet<string>('node_A2')];
      const partitionBeta = [new CrdtLwwSet<string>('node_B1'), new CrdtLwwSet<string>('node_B2')];

      // Partition Alpha writes
      partitionAlpha[0].add('config', 'theme=dark', 1000);
      partitionAlpha[1].add('user', 'Alice', 1005);
      partitionAlpha[1].remove('session', 1010);

      // Partition Beta writes (conflicting timestamps and keys)
      partitionBeta[0].add('config', 'theme=light', 1002); // Higher timestamp for config!
      partitionBeta[1].add('session', 'active_beta', 1008); // Lower timestamp than alpha's remove!
      partitionBeta[1].add('user', 'Alice_Updated', 1004); // Lower timestamp than alpha's add!

      // Internal sync within Partition Alpha
      partitionAlpha[0].merge(partitionAlpha[1]);
      partitionAlpha[1].merge(partitionAlpha[0]);

      // Internal sync within Partition Beta
      partitionBeta[0].merge(partitionBeta[1]);
      partitionBeta[1].merge(partitionBeta[0]);

      // Assert partitions differ before heal
      expect(partitionAlpha[0].get('config')).toBe('theme=dark');
      expect(partitionBeta[0].get('config')).toBe('theme=light');

      // HEAL NETWORK: Exchange states across all nodes
      const allNodes = [...partitionAlpha, ...partitionBeta];
      for (const target of allNodes) {
        for (const source of allNodes) {
          target.merge(source);
        }
      }

      // Assert 100% convergence across all 4 nodes
      const targetState = allNodes[0].getState();
      for (let i = 1; i < allNodes.length; i++) {
        expect(allNodes[i].getState()).toEqual(targetState);
      }

      // Assert expected LWW winning values:
      // 'config': 1002 (theme=light) > 1000 (theme=dark) -> light
      expect(allNodes[0].get('config')).toBe('theme=light');
      // 'user': 1005 (Alice) > 1004 (Alice_Updated) -> Alice
      expect(allNodes[0].get('get' in allNodes[0] ? 'user' : 'user')).toBe('Alice');
      // 'session': remove at 1010 > add at 1008 -> removed (undefined)
      expect(allNodes[0].has('session')).toBe(false);
      expect(allNodes[0].get('session')).toBeUndefined();
    });
  });

  describe('3. Timestamp Tie-Breaking & Sequence Counter Boundary Stress', () => {
    it('should break timestamp ties deterministically using peerId string comparison', () => {
      const crdt1 = new CrdtLwwSet<string>('peer_alpha');
      const crdt2 = new CrdtLwwSet<string>('peer_beta');

      // Same key, same timestamp, same sequence, different peerId
      crdt1.add('key1', 'val_alpha', 5000, 'peer_alpha', 1);
      crdt2.add('key1', 'val_beta', 5000, 'peer_beta', 1);

      crdt1.merge(crdt2);
      crdt2.merge(crdt1);

      // 'peer_beta' > 'peer_alpha' lexicographically, so val_beta MUST win
      expect(crdt1.get('key1')).toBe('val_beta');
      expect(crdt2.get('key1')).toBe('val_beta');
      expect(crdt1.getState()).toEqual(crdt2.getState());
    });

    it('should break timestamp and peerId ties using sequence counter', () => {
      const crdt1 = new CrdtLwwSet<string>('peer_x');
      const crdt2 = new CrdtLwwSet<string>('peer_x');

      // Same timestamp, same peerId, different sequence numbers
      crdt1.add('item', 'seq_1', 1000, 'peer_x', 1);
      crdt2.add('item', 'seq_5', 1000, 'peer_x', 5);

      crdt1.merge(crdt2);
      crdt2.merge(crdt1);

      expect(crdt1.get('item')).toBe('seq_5');
      expect(crdt2.get('item')).toBe('seq_5');
    });

    it('should evaluate isNewerOrEqual edge cases correctly', () => {
      // Greater timestamp
      expect(isNewerOrEqual(100, 'a', 1, 99, 'z', 99)).toBe(true);
      // Equal timestamp, greater peer
      expect(isNewerOrEqual(100, 'b', 1, 100, 'a', 99)).toBe(true);
      // Equal timestamp, smaller peer
      expect(isNewerOrEqual(100, 'a', 99, 100, 'b', 1)).toBe(false);
      // Equal timestamp, equal peer, greater sequence
      expect(isNewerOrEqual(100, 'a', 10, 100, 'a', 5)).toBe(true);
      // Equal timestamp, equal peer, equal sequence
      expect(isNewerOrEqual(100, 'a', 5, 100, 'a', 5)).toBe(true);
    });

    it('should handle exact tie between Add and Remove tombstones deterministically', () => {
      const crdt = new CrdtLwwSet<string>('peer_1');

      // Exact same timestamp, peerId, and sequence for Add and Remove
      crdt.add('shared_key', 'val_add', 1000, 'peer_1', 1);
      crdt.remove('shared_key', 1000, 'peer_1', 1);

      // In current implementation, has() evaluates isNewerOrEqual(add, remove) -> true
      // So Add wins exact ties over Remove consistently
      expect(crdt.has('shared_key')).toBe(true);
      expect(crdt.get('shared_key')).toBe('val_add');

      // Test reverse order of addition/removal call
      const crdtReverse = new CrdtLwwSet<string>('peer_1');
      crdtReverse.remove('shared_key', 1000, 'peer_1', 1);
      crdtReverse.add('shared_key', 'val_add', 1000, 'peer_1', 1);

      expect(crdtReverse.has('shared_key')).toBe(true);
      expect(crdtReverse.get('shared_key')).toBe('val_add');

      // Merge both
      crdt.merge(crdtReverse);
      expect(crdt.getState()).toEqual(crdtReverse.getState());
    });
  });

  describe('4. Tombstone Pruning & Memory Safety Stress', () => {
    it('should prune tombstones correctly based on age cutoff', () => {
      const crdt = new CrdtLwwSet<string>('peer_prune');
      const now = Date.now();

      crdt.remove('tomb_old_1', now - 100000);
      crdt.remove('tomb_old_2', now - 60000);
      crdt.remove('tomb_recent', now - 1000);
      crdt.add('active_key', 'value', now - 5000);

      expect(Object.keys(crdt.getState().removeSet).length).toBe(3);

      // Prune tombstones older than 30,000 ms
      const pruned = crdt.pruneTombstones(30000);

      expect(pruned).toBe(2);
      expect(Object.keys(crdt.getState().removeSet)).toEqual(['tomb_recent']);
      expect(crdt.has('active_key')).toBe(true);
    });

    it('should handle extreme pruneTombstones parameters safely', () => {
      const crdt = new CrdtLwwSet<string>('peer_edge');
      const now = Date.now();

      crdt.remove('k1', now - 1000);

      // maxAgeMs = 0 -> cutoff is Date.now() -> prunes all past tombstones
      const pruned0 = crdt.pruneTombstones(0);
      expect(pruned0).toBe(1);

      crdt.remove('k2', now - 1000);
      // maxAgeMs = Infinity -> cutoff is -Infinity -> prunes nothing
      const prunedInf = crdt.pruneTombstones(Infinity);
      expect(prunedInf).toBe(0);
    });
  });

  describe('5. CrossDomainSyncEngine Real-World Concurrency Integration', () => {
    it('should synchronize state between multiple CrossDomainSyncEngine instances with HMAC authentication', async () => {
      const secret = 'super-secret-key-32-chars-long!!';
      
      const engine1 = new CrossDomainSyncEngine({
        peerId: 'engine_1',
        ownOrigin: 'https://app.example.com',
        whitelistedOrigins: ['https://app.example.com', 'https://auth.example.com'],
      });
      await engine1.setSharedSecret(secret);

      const engine2 = new CrossDomainSyncEngine({
        peerId: 'engine_2',
        ownOrigin: 'https://auth.example.com',
        whitelistedOrigins: ['https://app.example.com', 'https://auth.example.com'],
      });
      await engine2.setSharedSecret(secret);

      // Perform local updates on engine1
      await engine1.synchronizeKey('authToken', 'jwt_xyz_123');
      await engine1.synchronizeKey('themePreference', 'emerald');

      // Export state from engine1 via broadcast state logic
      const state1 = engine1.getLocalState();

      // Sign payload manually or via merge state envelope simulation
      const envelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: `msg_test_${Date.now()}`,
        timestamp: Date.now(),
        sourceOrigin: 'https://app.example.com',
        targetOrigin: 'https://auth.example.com',
        action: 'CRDT_SYNC_MERGE',
        payload: JSON.stringify(state1),
        signature: '',
      };

      // Sign envelope using engine1 signer
      const signerAdapter = (engine1 as any).signerAdapter;
      const keyObj = (engine1 as any).sharedSecretKey;
      const signRes = await signerAdapter.sign(envelope.payload, keyObj);
      expect(signRes.ok).toBe(true);
      envelope.signature = signRes.value;

      // Merge remote state on engine2
      const mergeRes = await engine2.mergeRemoteState(envelope);
      expect(mergeRes.ok).toBe(true);
      expect(mergeRes.value).toBe(true);

      // Verify engine2 has acquired keys from engine1
      expect(engine2.getValue('authToken')).toBe('jwt_xyz_123');
      expect(engine2.getValue('themePreference')).toBe('emerald');
      expect(engine2.hasKey('authToken')).toBe(true);
      expect(engine2.hasKey('themePreference')).toBe(true);
    });

    it('should reject tampered payload envelope in CrossDomainSyncEngine', async () => {
      const secret = 'super-secret-key-32-chars-long!!';
      
      const engine = new CrossDomainSyncEngine({
        peerId: 'engine_verifier',
        ownOrigin: 'https://app.example.com',
      });
      await engine.setSharedSecret(secret);

      const fakeEnvelope: SignedSyncEnvelope = {
        protocolVersion: '1.0',
        messageId: 'msg_hack_01',
        timestamp: Date.now(),
        sourceOrigin: 'https://attacker.example.com',
        targetOrigin: 'https://app.example.com',
        action: 'CRDT_SYNC_MERGE',
        payload: JSON.stringify({ addSet: { bad_key: { key: 'bad_key', value: 'hacked' } }, removeSet: {} }),
        signature: 'invalid_hmac_signature_hex_deadbeef',
      };

      const mergeRes = await engine.mergeRemoteState(fakeEnvelope);
      expect(mergeRes.ok).toBe(false);
      if (!mergeRes.ok) {
        expect(mergeRes.error.code).toBe('INVALID_SIGNATURE');
      }
      expect(engine.hasKey('bad_key')).toBe(false);
    });
  });
});
