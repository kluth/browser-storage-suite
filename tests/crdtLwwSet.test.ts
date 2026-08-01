import { describe, it, expect, beforeEach } from 'vitest';
import { CrdtLwwSet, isNewerOrEqual } from '../src/domain/model/crdtLwwSet';

describe('CrdtLwwSet Unit Tests', () => {
  let crdtA: CrdtLwwSet<string>;
  let crdtB: CrdtLwwSet<string>;

  beforeEach(() => {
    crdtA = new CrdtLwwSet('peer_a');
    crdtB = new CrdtLwwSet('peer_b');
  });

  describe('isNewerOrEqual Helper Function', () => {
    it('should prioritize higher timestamp', () => {
      expect(isNewerOrEqual(2000, 'peer_a', 1, 1000, 'peer_b', 1)).toBe(true);
      expect(isNewerOrEqual(1000, 'peer_a', 1, 2000, 'peer_b', 1)).toBe(false);
    });

    it('should break ties using lexicographical peerId when timestamps match', () => {
      expect(isNewerOrEqual(1000, 'peer_b', 1, 1000, 'peer_a', 1)).toBe(true);
      expect(isNewerOrEqual(1000, 'peer_a', 1, 1000, 'peer_b', 1)).toBe(false);
    });

    it('should break ties using sequence counter when timestamp and peerId match', () => {
      expect(isNewerOrEqual(1000, 'peer_a', 2, 1000, 'peer_a', 1)).toBe(true);
      expect(isNewerOrEqual(1000, 'peer_a', 1, 1000, 'peer_a', 2)).toBe(false);
      expect(isNewerOrEqual(1000, 'peer_a', 1, 1000, 'peer_a', 1)).toBe(true);
    });
  });

  describe('Basic Add, Get, Remove, and Query Operations', () => {
    it('should add keys and retrieve values correctly', () => {
      crdtA.add('user_1', 'Alice');
      expect(crdtA.has('user_1')).toBe(true);
      expect(crdtA.get('user_1')).toBe('Alice');
      expect(crdtA.size()).toBe(1);
    });

    it('should return undefined for non-existent keys', () => {
      expect(crdtA.has('unknown')).toBe(false);
      expect(crdtA.get('unknown')).toBeUndefined();
    });

    it('should remove keys by adding a tombstone with higher timestamp', () => {
      crdtA.add('user_1', 'Alice', 1000);
      expect(crdtA.has('user_1')).toBe(true);

      crdtA.remove('user_1', 2000);
      expect(crdtA.has('user_1')).toBe(false);
      expect(crdtA.get('user_1')).toBeUndefined();
    });

    it('should preserve addition if addition timestamp is higher than tombstone timestamp', () => {
      crdtA.remove('user_1', 1000);
      expect(crdtA.has('user_1')).toBe(false);

      crdtA.add('user_1', 'Bob', 2000);
      expect(crdtA.has('user_1')).toBe(true);
      expect(crdtA.get('user_1')).toBe('Bob');
    });

    it('should list active keys, values, and entries', () => {
      crdtA.add('k1', 'val1');
      crdtA.add('k2', 'val2');
      crdtA.add('k3', 'val3');
      crdtA.remove('k2');

      expect(crdtA.keys().sort()).toEqual(['k1', 'k3']);
      expect(crdtA.values().sort()).toEqual(['val1', 'val3']);
      expect(crdtA.entries()).toEqual([
        ['k1', 'val1'],
        ['k3', 'val3'],
      ]);
      expect(crdtA.size()).toBe(2);
    });

    it('should clear all entries', () => {
      crdtA.add('k1', 'v1');
      crdtA.add('k2', 'v2');
      crdtA.clear();

      expect(crdtA.size()).toBe(0);
      expect(crdtA.keys()).toEqual([]);
    });

    it('should prune tombstones older than maxAgeMs', () => {
      const now = Date.now();
      crdtA.remove('old_key', now - 100000);
      crdtA.remove('new_key', now - 1000);

      const prunedCount = crdtA.pruneTombstones(50000);
      expect(prunedCount).toBe(1);
    });
  });

  describe('Mathematical Properties (Commutativity, Associativity, Idempotency)', () => {
    it('should guarantee Commutativity: merge(A, B) equals merge(B, A)', () => {
      crdtA.add('sessionToken', 'token_A', 100);
      crdtA.add('theme', 'dark', 150);

      crdtB.add('sessionToken', 'token_B', 200);
      crdtB.remove('theme', 160);

      const mergedAB = new CrdtLwwSet('peer_merged_1');
      mergedAB.merge(crdtA);
      mergedAB.merge(crdtB);

      const mergedBA = new CrdtLwwSet('peer_merged_2');
      mergedBA.merge(crdtB);
      mergedBA.merge(crdtA);

      expect(mergedAB.keys().sort()).toEqual(mergedBA.keys().sort());
      expect(mergedAB.get('sessionToken')).toBe(mergedBA.get('sessionToken'));
      expect(mergedAB.has('theme')).toBe(mergedBA.has('theme'));
    });

    it('should guarantee Associativity: merge(merge(A, B), C) equals merge(A, merge(B, C))', () => {
      const crdtC = new CrdtLwwSet<string>('peer_c');

      crdtA.add('k1', 'valA1', 10);
      crdtB.add('k1', 'valB1', 20);
      crdtC.remove('k1', 15);

      // (A + B) + C
      const left = new CrdtLwwSet('merged_left');
      left.merge(crdtA);
      left.merge(crdtB);
      left.merge(crdtC);

      // A + (B + C)
      const rightBC = new CrdtLwwSet('merged_bc');
      rightBC.merge(crdtB);
      rightBC.merge(crdtC);
      const right = new CrdtLwwSet('merged_right');
      right.merge(crdtA);
      right.merge(rightBC);

      expect(left.get('k1')).toBe(right.get('k1'));
    });

    it('should guarantee Idempotency: merge(A, A) equals A', () => {
      crdtA.add('settings', 'custom_v1', 500);
      crdtA.remove('draft', 400);

      const stateBefore = crdtA.getState();
      crdtA.merge(crdtA);
      const stateAfter = crdtA.getState();

      expect(stateAfter).toEqual(stateBefore);
    });
  });
});
