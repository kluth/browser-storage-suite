import { describe, it, expect } from 'vitest';
import { StorageKey, StorageValue, GraphNodeId, Node3DPositionVO } from '../src/domain/model/valueObjects';

describe('Value Objects Contract & Edge Cases (Stryker Mutant Killers)', () => {
  it('should reject empty or whitespace-only StorageKeys', () => {
    expect(StorageKey.create('').ok).toBe(false);
    expect(StorageKey.create('   ').ok).toBe(false);
    expect(StorageKey.create('\t\n').ok).toBe(false);

    const valid = StorageKey.create('  user_id  ');
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.value).toBe('user_id');
    }
  });

  it('should handle StorageValue creation and byte size calculation', () => {
    const val1 = StorageValue.create('hello');
    expect(val1.ok).toBe(true);
    if (val1.ok) {
      expect(val1.value.value).toBe('hello');
      expect(val1.value.sizeInBytes).toBe(5);
    }

    const val2 = StorageValue.create('');
    expect(val2.ok).toBe(true);
    if (val2.ok) {
      expect(val2.value.value).toBe('');
      expect(val2.value.sizeInBytes).toBe(0);
    }
  });

  it('should validate GraphNodeId creation and equality', () => {
    expect(GraphNodeId.create('').ok).toBe(false);
    expect(GraphNodeId.create('   ').ok).toBe(false);

    const id1 = GraphNodeId.create('node_1');
    const id2 = GraphNodeId.create('node_1');
    const id3 = GraphNodeId.create('node_2');

    expect(id1.ok).toBe(true);
    if (id1.ok && id2.ok && id3.ok) {
      expect(id1.value.equals(id2.value)).toBe(true);
      expect(id1.value.equals(id3.value)).toBe(false);
    }
  });

  it('should create Node3DPositionVO and convert to coordinate tuples', () => {
    const errId = Node3DPositionVO.create('', 1, 2, 3);
    expect(errId.ok).toBe(false);

    const errCoord = Node3DPositionVO.create('n1', NaN, 2, 3);
    expect(errCoord.ok).toBe(false);

    const posRes = Node3DPositionVO.create('n1', 1.5, -2.0, 3.25);
    expect(posRes.ok).toBe(true);
    if (posRes.ok) {
      expect(posRes.value.id.value).toBe('n1');
      expect(posRes.value.toTuple()).toEqual([1.5, -2.0, 3.25]);
    }
  });
});

