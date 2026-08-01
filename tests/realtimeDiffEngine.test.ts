import { describe, it, expect } from 'vitest';
import { RealtimeDiffEngine, escapePointerToken, unescapePointerToken, parsePointerPath } from '../utils/realtimeDiffEngine';
import { JSONPatchOperation, StorageDiffError, JsonPointer } from '../src/domain/model/storageDiff';

describe('RealtimeDiffEngine (ADR-0003)', () => {
  describe('1. Pointer Token Escaping & Parsing (RFC 6901)', () => {
    it('should correctly escape slashes and tildes', () => {
      expect(escapePointerToken('foo/bar~baz')).toBe('foo~1bar~0baz');
      expect(escapePointerToken('~tilde/slash~')).toBe('~0tilde~1slash~0');
    });

    it('should correctly unescape RFC 6901 tokens', () => {
      expect(unescapePointerToken('foo~1bar~0baz')).toBe('foo/bar~baz');
      expect(unescapePointerToken('~0tilde~1slash~0')).toBe('~tilde/slash~');
    });

    it('should parse valid RFC 6901 pointer paths', () => {
      const res = parsePointerPath('/user/profile/name');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual(['user', 'profile', 'name']);
      }
    });

    it('should parse escaped tokens in pointer paths', () => {
      const res = parsePointerPath('/user~1name/profile~0data');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual(['user/name', 'profile~data']);
      }
    });

    it('should return empty token array for root pointer path ""', () => {
      const res = parsePointerPath('');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual([]);
      }
    });

    it('should fail parsing pointer path without leading slash', () => {
      const res = parsePointerPath('user/profile');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_POINTER');
      }
    });

    it('should validate JsonPointer domain value object', () => {
      const valid = JsonPointer.create('/a/b');
      expect(valid.ok).toBe(true);
      const validRoot = JsonPointer.create('');
      expect(validRoot.ok).toBe(true);
      const invalid = JsonPointer.create('invalid');
      expect(invalid.ok).toBe(false);
    });
  });

  describe('2. Primitive & Scalar Object Diffing', () => {
    it('should return empty diff for identical primitive values', () => {
      const res = RealtimeDiffEngine.createDiff({ a: 1, b: 'test' }, { a: 1, b: 'test' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches.length).toBe(0);
        expect(res.value.summary.keysUnchanged).toBe(2);
      }
    });

    it('should detect added, modified, and deleted keys', () => {
      const oldState = { name: 'Alice', role: 'admin', age: 30 };
      const newState = { name: 'Alice', role: 'superadmin', country: 'US' };

      const res = RealtimeDiffEngine.createDiff(oldState, newState);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.summary.keysAdded).toBe(1);
        expect(res.value.summary.keysModified).toBe(1);
        expect(res.value.summary.keysDeleted).toBe(1);
        expect(res.value.summary.keysUnchanged).toBe(1);

        const deltaRole = res.value.deltas.find((d) => d.key === 'role');
        expect(deltaRole?.changeType).toBe('modified');
        expect(deltaRole?.patches).toEqual([{ op: 'replace', path: '/role', value: 'superadmin', oldValue: 'admin' }]);
        expect(deltaRole?.inversePatches).toEqual([{ op: 'replace', path: '/role', value: 'admin', oldValue: 'superadmin' }]);

        const deltaCountry = res.value.deltas.find((d) => d.key === 'country');
        expect(deltaCountry?.changeType).toBe('created');
        expect(deltaCountry?.patches).toEqual([{ op: 'add', path: '/country', value: 'US' }]);
        expect(deltaCountry?.inversePatches).toEqual([{ op: 'remove', path: '/country', oldValue: 'US' }]);

        const deltaAge = res.value.deltas.find((d) => d.key === 'age');
        expect(deltaAge?.changeType).toBe('deleted');
        expect(deltaAge?.patches).toEqual([{ op: 'remove', path: '/age', oldValue: 30 }]);
        expect(deltaAge?.inversePatches).toEqual([{ op: 'add', path: '/age', value: 30 }]);
      }
    });

    it('should support floatTolerance option for floating point numbers', () => {
      const oldState = { val: 0.1 + 0.2 };
      const newState = { val: 0.3 };

      const resStrict = RealtimeDiffEngine.createDiff(oldState, newState, { floatTolerance: 0 });
      expect(resStrict.ok).toBe(true);
      if (resStrict.ok) {
        expect(resStrict.value.globalPatches.length).toBe(1);
      }

      const resTolerant = RealtimeDiffEngine.createDiff(oldState, newState, { floatTolerance: 1e-9 });
      expect(resTolerant.ok).toBe(true);
      if (resTolerant.ok) {
        expect(resTolerant.value.globalPatches.length).toBe(0);
      }
    });

    it('should respect ignoreKeys option', () => {
      const oldState = { secret: 'old', name: 'Bob' };
      const newState = { secret: 'new', name: 'Bob' };

      const res = RealtimeDiffEngine.createDiff(oldState, newState, { ignoreKeys: ['secret'] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches.length).toBe(0);
      }
    });

    it('should respect includeOldValueInReplace = false option', () => {
      const res = RealtimeDiffEngine.createDiff({ a: 1 }, { a: 2 }, { includeOldValueInReplace: false });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches[0].oldValue).toBeUndefined();
      }
    });

    it('should diff null vs object and array vs plain object', () => {
      const resNull = RealtimeDiffEngine.createDiff(null, { a: 1 });
      expect(resNull.ok).toBe(true);
      if (resNull.ok) expect(resNull.value.globalPatches.length).toBe(1);

      const resArrObj = RealtimeDiffEngine.createDiff([1, 2], { a: 1 });
      expect(resArrObj.ok).toBe(true);
      if (resArrObj.ok) expect(resArrObj.value.globalPatches.length).toBe(1);
    });
  });

  describe('3. Nested Objects & Array Diffing', () => {
    it('should generate nested RFC 6902 patches for deep objects', () => {
      const oldState = { user: { settings: { theme: 'dark', notifications: true } } };
      const newState = { user: { settings: { theme: 'light', notifications: true, font: 'Inter' } } };

      const res = RealtimeDiffEngine.createDiff(oldState, newState);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches).toContainEqual({
          op: 'replace',
          path: '/user/settings/theme',
          value: 'light',
          oldValue: 'dark',
        });
        expect(res.value.globalPatches).toContainEqual({
          op: 'add',
          path: '/user/settings/font',
          value: 'Inter',
        });
      }
    });

    it('should handle array element addition and deletion', () => {
      const oldArr = [1, 2, 3];
      const newArr = [1, 2, 3, 4];

      const res = RealtimeDiffEngine.createDiff(oldArr, newArr);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches).toEqual([
          { op: 'add', path: '/3', value: 4 },
        ]);
        expect(res.value.globalInversePatches).toEqual([
          { op: 'remove', path: '/3', oldValue: 4 },
        ]);
      }
    });

    it('should order array removals from highest index to lowest index', () => {
      const oldArr = ['a', 'b', 'c'];
      const newArr = ['a'];

      const res = RealtimeDiffEngine.createDiff(oldArr, newArr);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches).toEqual([
          { op: 'remove', path: '/2', oldValue: 'c' },
          { op: 'remove', path: '/1', oldValue: 'b' },
        ]);
      }
    });

    it('should fail with MAX_DEPTH_EXCEEDED error when depth exceeds limit', () => {
      const oldState = { a: { b: { c: 1 } } };
      const newState = { a: { b: { c: 2 } } };

      const res = RealtimeDiffEngine.createDiff(oldState, newState, { maxDepth: 2 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('MAX_DEPTH_EXCEEDED');
      }
    });
  });

  describe('4. Patch Application (applyPatch)', () => {
    it('should apply add operation to objects immutably', () => {
      const target = { a: 1 };
      const patch: JSONPatchOperation = { op: 'add', path: '/b', value: 2 };
      const res = RealtimeDiffEngine.applyPatch(target, patch);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({ a: 1, b: 2 });
        expect(target).toEqual({ a: 1 }); // Ensure immutability
      }
    });

    it('should apply replace operation on object and root', () => {
      const target = { a: 1 };
      const patch: JSONPatchOperation = { op: 'replace', path: '/a', value: 99 };
      const res = RealtimeDiffEngine.applyPatch(target, patch);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toEqual({ a: 99 });

      const patchRoot: JSONPatchOperation = { op: 'replace', path: '', value: { root: 'replaced' } };
      const resRoot = RealtimeDiffEngine.applyPatch(target, patchRoot);
      expect(resRoot.ok).toBe(true);
      if (resRoot.ok) expect(resRoot.value).toEqual({ root: 'replaced' });
    });

    it('should apply remove operation on arrays and objects', () => {
      const target = { items: ['x', 'y', 'z'], key: 'val' };
      const patchArr: JSONPatchOperation = { op: 'remove', path: '/items/1' };
      const resArr = RealtimeDiffEngine.applyPatch(target, patchArr);
      expect(resArr.ok).toBe(true);
      if (resArr.ok) expect(resArr.value.items).toEqual(['x', 'z']);

      const patchObj: JSONPatchOperation = { op: 'remove', path: '/key' };
      const resObj = RealtimeDiffEngine.applyPatch(target, patchObj);
      expect(resObj.ok).toBe(true);
      if (resObj.ok) expect(resObj.value.key).toBeUndefined();
    });

    it('should apply append operation /- on arrays', () => {
      const target = { items: [1, 2] };
      const patch: JSONPatchOperation = { op: 'add', path: '/items/-', value: 3 };
      const res = RealtimeDiffEngine.applyPatch(target, patch);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toEqual({ items: [1, 2, 3] });
    });

    it('should apply move operation on objects and arrays', () => {
      const targetObj = { source: 'hello', target: 'world' };
      const patchObj: JSONPatchOperation = { op: 'move', from: '/source', path: '/dest' };
      const resObj = RealtimeDiffEngine.applyPatch(targetObj, patchObj);
      expect(resObj.ok).toBe(true);
      if (resObj.ok) {
        expect(resObj.value).toEqual({ target: 'world', dest: 'hello' });
      }

      const targetArr = { arr: ['first', 'second', 'third'] };
      const patchArr: JSONPatchOperation = { op: 'move', from: '/arr/0', path: '/arr/2' };
      const resArr = RealtimeDiffEngine.applyPatch(targetArr, patchArr);
      expect(resArr.ok).toBe(true);
      if (resArr.ok) {
        expect(resArr.value.arr).toEqual(['second', 'third', 'first']);
      }
    });

    it('should apply copy operation on objects and arrays', () => {
      const targetObj = { source: 'hello' };
      const patchObj: JSONPatchOperation = { op: 'copy', from: '/source', path: '/dest' };
      const resObj = RealtimeDiffEngine.applyPatch(targetObj, patchObj);
      expect(resObj.ok).toBe(true);
      if (resObj.ok) {
        expect(resObj.value).toEqual({ source: 'hello', dest: 'hello' });
      }

      const targetArr = { arr: [10, 20] };
      const patchArr: JSONPatchOperation = { op: 'copy', from: '/arr/0', path: '/arr/1' };
      const resArr = RealtimeDiffEngine.applyPatch(targetArr, patchArr);
      expect(resArr.ok).toBe(true);
      if (resArr.ok) {
        expect(resArr.value.arr).toEqual([10, 10, 20]);
      }
    });

    it('should handle single patch or array of patches', () => {
      const target = { a: 1 };
      const singlePatch: JSONPatchOperation = { op: 'add', path: '/b', value: 2 };
      const resSingle = RealtimeDiffEngine.applyPatch(target, singlePatch);
      expect(resSingle.ok).toBe(true);
    });
  });

  describe('5. Test Assertion Patches (test op)', () => {
    it('should succeed when test assertion matches state', () => {
      const target = { status: 'active' };
      const patch: JSONPatchOperation = { op: 'test', path: '/status', value: 'active' };
      const res = RealtimeDiffEngine.applyPatch(target, patch);
      expect(res.ok).toBe(true);

      const patchRoot: JSONPatchOperation = { op: 'test', path: '', value: { status: 'active' } };
      const resRoot = RealtimeDiffEngine.applyPatch(target, patchRoot);
      expect(resRoot.ok).toBe(true);
    });

    it('should fail with TEST_FAILED error when assertion fails', () => {
      const target = { status: 'active' };
      const patch: JSONPatchOperation = { op: 'test', path: '/status', value: 'inactive' };
      const res = RealtimeDiffEngine.applyPatch(target, patch);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('TEST_FAILED');
      }

      const patchRoot: JSONPatchOperation = { op: 'test', path: '', value: { status: 'other' } };
      const resRoot = RealtimeDiffEngine.applyPatch(target, patchRoot);
      expect(resRoot.ok).toBe(false);
      if (!resRoot.ok) {
        expect(resRoot.error.kind).toBe('TEST_FAILED');
      }
    });
  });

  describe('6. Patch Inversion & Time-Travel Roundtrips', () => {
    it('should reconstruct original state via inverse patches', () => {
      const oldState = { a: 1, b: { c: 2 }, d: [10, 20] };
      const newState = { a: 1, b: { c: 99, newKey: 'hello' }, d: [10, 20, 30] };

      const diffRes = RealtimeDiffEngine.createDiff(oldState, newState);
      expect(diffRes.ok).toBe(true);
      if (diffRes.ok) {
        const patches = diffRes.value.globalPatches;
        const forwardRes = RealtimeDiffEngine.applyPatch(oldState, patches);
        expect(forwardRes.ok).toBe(true);
        if (forwardRes.ok) {
          expect(forwardRes.value).toEqual(newState);

          // Apply inverse patches to newState
          const inversePatches = diffRes.value.globalInversePatches;
          const rollbackRes = RealtimeDiffEngine.applyPatch(newState, inversePatches);
          expect(rollbackRes.ok).toBe(true);
          if (rollbackRes.ok) {
            expect(rollbackRes.value).toEqual(oldState);
          }
        }
      }
    });

    it('should compute explicit inverse patches via RealtimeDiffEngine.invertPatches for all patch types', () => {
      const oldState = { count: 5, status: 'old', items: ['a', 'b'], ref: 'src' };
      const patches: JSONPatchOperation[] = [
        { op: 'replace', path: '/count', value: 10 },
        { op: 'add', path: '/newKey', value: 'hello' },
        { op: 'remove', path: '/status' },
        { op: 'move', from: '/ref', path: '/dest' },
        { op: 'copy', from: '/count', path: '/copyCount' },
        { op: 'test', path: '/items/0', value: 'a' },
      ];

      const invRes = RealtimeDiffEngine.invertPatches(patches, oldState);
      expect(invRes.ok).toBe(true);
      if (invRes.ok) {
        expect(invRes.value).toEqual([
          { op: 'test', path: '/items/0', value: 'a' },
          { op: 'remove', path: '/copyCount' },
          { op: 'move', path: '/ref', from: '/dest' },
          { op: 'add', path: '/status', value: 'old' },
          { op: 'remove', path: '/newKey', oldValue: 'hello' },
          { op: 'replace', path: '/count', value: 5, oldValue: 10 },
        ]);

        const forwardRes = RealtimeDiffEngine.applyPatch(oldState, patches);
        expect(forwardRes.ok).toBe(true);
        if (forwardRes.ok) {
          const rollbackRes = RealtimeDiffEngine.applyPatch(forwardRes.value, invRes.value);
          expect(rollbackRes.ok).toBe(true);
          if (rollbackRes.ok) {
            expect(rollbackRes.value).toEqual(oldState);
          }
        }
      }
    });

    it('should return error in invertPatches if patch has invalid path', () => {
      const invRes = RealtimeDiffEngine.invertPatches([{ op: 'add', path: 'invalidPath', value: 1 }], {});
      expect(invRes.ok).toBe(false);
    });
  });

  describe('7. Type Mismatches & Edge Cases', () => {
    it('should replace when old state is object and new state is primitive', () => {
      const res = RealtimeDiffEngine.createDiff({ a: 1 }, 'primitive string');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches).toEqual([
          { op: 'replace', path: '', value: 'primitive string', oldValue: { a: 1 } },
        ]);
      }
    });

    it('should handle special character keys with slashes and tildes', () => {
      const oldState = { 'key/with/slashes': 10 };
      const newState = { 'key/with/slashes': 20 };

      const res = RealtimeDiffEngine.createDiff(oldState, newState);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.globalPatches).toEqual([
          { op: 'replace', path: '/key~1with~1slashes', value: 20, oldValue: 10 },
        ]);
      }
    });

    it('should return error for non-existent path in applyPatch', () => {
      const target = { a: 1 };
      const patchReplace: JSONPatchOperation = { op: 'replace', path: '/non/existent/path', value: 10 };
      const resReplace = RealtimeDiffEngine.applyPatch(target, patchReplace);
      expect(resReplace.ok).toBe(false);
      if (!resReplace.ok) {
        expect(resReplace.error.kind).toBe('PATH_NOT_FOUND');
      }

      const patchRemove: JSONPatchOperation = { op: 'remove', path: '/missingKey' };
      const resRemove = RealtimeDiffEngine.applyPatch(target, patchRemove);
      expect(resRemove.ok).toBe(false);
      if (!resRemove.ok) {
        expect(resRemove.error.kind).toBe('PATH_NOT_FOUND');
      }

      const patchParentPrimitive: JSONPatchOperation = { op: 'add', path: '/a/sub/key', value: 10 };
      const resParentPrimitive = RealtimeDiffEngine.applyPatch(target, patchParentPrimitive);
      expect(resParentPrimitive.ok).toBe(false);
      if (!resParentPrimitive.ok) {
        expect(resParentPrimitive.error.kind).toBe('PATH_NOT_FOUND');
      }
    });

    it('should return error for out of bounds array index', () => {
      const target = { arr: [1, 2] };
      const patchReplace: JSONPatchOperation = { op: 'replace', path: '/arr/99', value: 10 };
      const resReplace = RealtimeDiffEngine.applyPatch(target, patchReplace);
      expect(resReplace.ok).toBe(false);
      if (!resReplace.ok) {
        expect(resReplace.error.kind).toBe('INDEX_OUT_OF_BOUNDS');
      }

      const patchAdd: JSONPatchOperation = { op: 'add', path: '/arr/99', value: 10 };
      const resAdd = RealtimeDiffEngine.applyPatch(target, patchAdd);
      expect(resAdd.ok).toBe(false);
      if (!resAdd.ok) {
        expect(resAdd.error.kind).toBe('INDEX_OUT_OF_BOUNDS');
      }

      const patchRemove: JSONPatchOperation = { op: 'remove', path: '/arr/-1', value: 10 };
      const resRemove = RealtimeDiffEngine.applyPatch(target, patchRemove);
      expect(resRemove.ok).toBe(false);
      if (!resRemove.ok) {
        expect(resRemove.error.kind).toBe('INDEX_OUT_OF_BOUNDS');
      }
    });

    it('should return error when move/copy operation lacks from pointer', () => {
      const target = { a: 1 };
      const patchMove: JSONPatchOperation = { op: 'move', path: '/b' };
      const resMove = RealtimeDiffEngine.applyPatch(target, patchMove);
      expect(resMove.ok).toBe(false);
      if (!resMove.ok) {
        expect(resMove.error.kind).toBe('INVALID_POINTER');
      }
    });

    it('should return error when move/copy operation has non-existent from path', () => {
      const target = { a: 1 };
      const patchMove: JSONPatchOperation = { op: 'move', from: '/missing', path: '/b' };
      const resMove = RealtimeDiffEngine.applyPatch(target, patchMove);
      expect(resMove.ok).toBe(false);
      if (!resMove.ok) {
        expect(resMove.error.kind).toBe('PATH_NOT_FOUND');
      }
    });

    it('should return error on circular reference detection', () => {
      const objA: any = { name: 'A' };
      objA.self = objA;

      const res = RealtimeDiffEngine.createDiff(objA, { name: 'A', self: null });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('CIRCULAR_REFERENCE');
      }
    });
  });

  describe('8. Domain Errors', () => {
    it('should instantiate StorageDiffError with static helpers', () => {
      const errNotFound = StorageDiffError.pathNotFound('/foo/bar');
      expect(errNotFound.kind).toBe('PATH_NOT_FOUND');
      expect(errNotFound.code).toBe('PATH_NOT_FOUND');
      expect(errNotFound.path).toBe('/foo/bar');

      const errTestFailed = StorageDiffError.testFailed('/path', 1, 2);
      expect(errTestFailed.kind).toBe('TEST_FAILED');
      expect(errTestFailed.expected).toBe(1);
      expect(errTestFailed.actual).toBe(2);

      const errInvalidPatch = StorageDiffError.invalidPatch('msg', '/p');
      expect(errInvalidPatch.kind).toBe('INVALID_PATCH');

      const errMaxDepth = StorageDiffError.maxDepthExceeded(10, '/p');
      expect(errMaxDepth.kind).toBe('MAX_DEPTH_EXCEEDED');

      const errType = StorageDiffError.typeMismatch('/p', 'string', 'number');
      expect(errType.kind).toBe('TYPE_MISMATCH');

      const errCirc = StorageDiffError.circularReference('/p');
      expect(errCirc.kind).toBe('CIRCULAR_REFERENCE');
    });
  });
});
