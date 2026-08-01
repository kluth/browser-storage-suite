import { Result } from './result';
import {
  JSONPatchOperation,
  StorageDiffDelta,
  StorageDiffSummary,
  StorageDiffResult,
  StorageDiffError,
  StorageDiffOptions,
  DEFAULT_STORAGE_DIFF_OPTIONS,
  DiffChangeType,
} from '../src/domain/model/storageDiff';

/**
 * Escapes special characters in JSON Pointer tokens per RFC 6901:
 * '~' -> '~0', '/' -> '~1'
 */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Unescapes RFC 6901 JSON Pointer tokens:
 * '~1' -> '/', '~0' -> '~'
 */
export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Parses an RFC 6901 pointer path into individual property tokens.
 */
export function parsePointerPath(path: string): Result<string[], StorageDiffError> {
  if (path === '') return Result.ok([]);
  if (!path.startsWith('/')) {
    return Result.err(StorageDiffError.invalidPointer(path, 'Must start with "/" or be empty.'));
  }
  const tokens = path.slice(1).split('/').map(unescapePointerToken);
  return Result.ok(tokens);
}

/**
 * Deep clones any JSON-serializable value safely.
 */
function cloneValue<T>(val: T): T {
  if (val === undefined) return undefined as unknown as T;
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}

/**
 * Deep equality helper for objects and primitives.
 */
function deepEqual(a: unknown, b: unknown, floatTolerance = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number' && floatTolerance > 0) {
    return Math.abs(a - b) <= floatTolerance;
  }
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], floatTolerance)) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!(key in objB)) return false;
    if (!deepEqual(objA[key], objB[key], floatTolerance)) return false;
  }

  return true;
}

/**
 * Real-Time Diff Engine
 */
export class RealtimeDiffEngine {
  /**
   * Compares old state and new state objects/primitives and returns structured StorageDiffResult.
   */
  public static createDiff(
    oldState: unknown,
    newState: unknown,
    options?: Partial<StorageDiffOptions>
  ): Result<StorageDiffResult, StorageDiffError> {
    const opts: Required<StorageDiffOptions> = {
      ...DEFAULT_STORAGE_DIFF_OPTIONS,
      ...options,
    };

    const timestamp = Date.now();
    const globalPatches: JSONPatchOperation[] = [];
    const globalInversePatches: JSONPatchOperation[] = [];
    const ignoreSet = new Set(opts.ignoreKeys || []);
    const visitedOld = new WeakSet<object>();
    const visitedNew = new WeakSet<object>();

    const diffRecursive = (
      oldVal: any,
      newVal: any,
      path: string,
      currentDepth: number
    ): StorageDiffError | null => {
      if (currentDepth > opts.maxDepth) {
        return StorageDiffError.maxDepthExceeded(opts.maxDepth, path);
      }

      if (deepEqual(oldVal, newVal, opts.floatTolerance)) {
        return null;
      }

      if (typeof oldVal === 'object' && oldVal !== null) {
        if (visitedOld.has(oldVal)) {
          return StorageDiffError.circularReference(path);
        }
        visitedOld.add(oldVal);
      }

      if (typeof newVal === 'object' && newVal !== null) {
        if (visitedNew.has(newVal)) {
          return StorageDiffError.circularReference(path);
        }
        visitedNew.add(newVal);
      }

      const oldType = Array.isArray(oldVal) ? 'array' : oldVal === null ? 'null' : typeof oldVal;
      const newType = Array.isArray(newVal) ? 'array' : newVal === null ? 'null' : typeof newVal;

      if (oldType !== newType || (oldType !== 'object' && oldType !== 'array')) {
        const patch: JSONPatchOperation = { op: 'replace', path, value: cloneValue(newVal) };
        if (opts.includeOldValueInReplace && oldVal !== undefined) {
          patch.oldValue = cloneValue(oldVal);
        }
        globalPatches.push(patch);
        globalInversePatches.unshift({
          op: 'replace',
          path,
          value: cloneValue(oldVal),
          oldValue: cloneValue(newVal),
        });
        return null;
      }

      if (oldType === 'array') {
        const oldArr = oldVal as any[];
        const newArr = newVal as any[];
        const minLen = Math.min(oldArr.length, newArr.length);

        for (let i = 0; i < minLen; i++) {
          const err = diffRecursive(oldArr[i], newArr[i], `${path}/${i}`, currentDepth + 1);
          if (err) return err;
        }

        // Removals from back to front to preserve index validity
        for (let i = oldArr.length - 1; i >= newArr.length; i--) {
          const itemPath = `${path}/${i}`;
          globalPatches.push({ op: 'remove', path: itemPath, oldValue: cloneValue(oldArr[i]) });
          globalInversePatches.unshift({ op: 'add', path: itemPath, value: cloneValue(oldArr[i]) });
        }

        // Additions
        for (let i = oldArr.length; i < newArr.length; i++) {
          const itemPath = `${path}/${i}`;
          globalPatches.push({ op: 'add', path: itemPath, value: cloneValue(newArr[i]) });
          globalInversePatches.unshift({ op: 'remove', path: itemPath, oldValue: cloneValue(newArr[i]) });
        }
        return null;
      }

      // Plain Object diff
      const oldKeys = Object.keys(oldVal || {});
      const newKeys = Object.keys(newVal || {});
      const allKeys = Array.from(new Set([...oldKeys, ...newKeys]));

      for (const key of allKeys) {
        if (ignoreSet.has(key) && path === '') continue;

        const escapedKey = escapePointerToken(key);
        const itemPath = `${path}/${escapedKey}`;

        const hasOld = key in oldVal;
        const hasNew = key in newVal;

        if (hasOld && !hasNew) {
          globalPatches.push({ op: 'remove', path: itemPath, oldValue: cloneValue(oldVal[key]) });
          globalInversePatches.unshift({ op: 'add', path: itemPath, value: cloneValue(oldVal[key]) });
        } else if (!hasOld && hasNew) {
          globalPatches.push({ op: 'add', path: itemPath, value: cloneValue(newVal[key]) });
          globalInversePatches.unshift({ op: 'remove', path: itemPath, oldValue: cloneValue(newVal[key]) });
        } else {
          const err = diffRecursive(oldVal[key], newVal[key], itemPath, currentDepth + 1);
          if (err) return err;
        }
      }
      return null;
    };

    const err = diffRecursive(oldState, newState, '', 0);
    if (err) return Result.err(err);

    // Compute deltas and summary for root objects if both oldState and newState are plain objects
    const deltas: StorageDiffDelta[] = [];
    let keysAdded = 0;
    let keysModified = 0;
    let keysDeleted = 0;
    let keysUnchanged = 0;

    const isOldObj = typeof oldState === 'object' && oldState !== null && !Array.isArray(oldState);
    const isNewObj = typeof newState === 'object' && newState !== null && !Array.isArray(newState);

    if (isOldObj && isNewObj) {
      const oldObj = oldState as Record<string, any>;
      const newObj = newState as Record<string, any>;
      const allRootKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));

      for (const key of allRootKeys) {
        if (ignoreSet.has(key)) continue;

        const escapedKey = escapePointerToken(key);
        const rootPrefix = `/${escapedKey}`;

        const hasOld = key in oldObj;
        const hasNew = key in newObj;

        let changeType: DiffChangeType = 'unchanged';

        const keyPatches = globalPatches.filter(
          (p) => p.path === rootPrefix || p.path.startsWith(`${rootPrefix}/`)
        );
        const keyInversePatches = globalInversePatches.filter(
          (p) => p.path === rootPrefix || p.path.startsWith(`${rootPrefix}/`)
        );

        if (!hasOld && hasNew) {
          changeType = 'created';
          keysAdded++;
        } else if (hasOld && !hasNew) {
          changeType = 'deleted';
          keysDeleted++;
        } else if (keyPatches.length > 0) {
          changeType = 'modified';
          keysModified++;
        } else {
          keysUnchanged++;
        }

        deltas.push({
          key,
          oldValue: oldObj[key],
          newValue: newObj[key],
          patches: keyPatches,
          inversePatches: keyInversePatches,
          timestamp,
          changeType,
        });
      }
    }

    const summary: StorageDiffSummary = {
      totalKeysCompared: deltas.length,
      keysAdded,
      keysModified,
      keysDeleted,
      keysUnchanged,
      patchCount: globalPatches.length,
      timestamp,
    };

    return Result.ok({
      deltas,
      summary,
      globalPatches,
      globalInversePatches,
    });
  }

  /**
   * Applies one or more RFC 6902 patch operations immutably to target object/array.
   */
  public static applyPatch<T>(
    target: T,
    patches: JSONPatchOperation | JSONPatchOperation[]
  ): Result<T, StorageDiffError> {
    const patchList = Array.isArray(patches) ? patches : [patches];
    let clone: any = cloneValue(target);

    for (const op of patchList) {
      const tokensRes = parsePointerPath(op.path);
      if (!tokensRes.ok) return Result.err(tokensRes.error);
      const tokens = tokensRes.value;

      if (tokens.length === 0) {
        if (op.op === 'replace' || op.op === 'add') {
          clone = cloneValue(op.value);
          continue;
        } else if (op.op === 'test') {
          if (!deepEqual(clone, op.value)) {
            return Result.err(StorageDiffError.testFailed(op.path, op.value, clone));
          }
          continue;
        }
      }

      // Navigate to parent container
      let parent = clone;
      for (let i = 0; i < tokens.length - 1; i++) {
        const token = tokens[i];
        if (parent === null || typeof parent !== 'object') {
          return Result.err(
            StorageDiffError.pathNotFound(op.path, `Target path component "${token}" is not an object/array in "${op.path}".`)
          );
        }
        if (!(token in parent)) {
          return Result.err(
            StorageDiffError.pathNotFound(op.path, `Target path component "${token}" not found in pointer "${op.path}".`)
          );
        }
        parent = parent[token];
      }

      const lastToken = tokens[tokens.length - 1];

      switch (op.op) {
        case 'test': {
          const actual = tokens.length === 0 ? clone : parent[lastToken];
          if (!deepEqual(actual, op.value)) {
            return Result.err(StorageDiffError.testFailed(op.path, op.value, actual));
          }
          break;
        }
        case 'add': {
          if (Array.isArray(parent)) {
            if (lastToken === '-') {
              parent.push(cloneValue(op.value));
            } else {
              const idx = parseInt(lastToken, 10);
              if (isNaN(idx) || idx < 0 || idx > parent.length) {
                return Result.err(
                  new StorageDiffError(
                    'INDEX_OUT_OF_BOUNDS',
                    `Invalid array index "${lastToken}" in path "${op.path}".`,
                    op.path
                  )
                );
              }
              parent.splice(idx, 0, cloneValue(op.value));
            }
          } else if (parent !== null && typeof parent === 'object') {
            parent[lastToken] = cloneValue(op.value);
          } else {
            return Result.err(StorageDiffError.pathNotFound(op.path));
          }
          break;
        }
        case 'remove': {
          if (Array.isArray(parent)) {
            const idx = parseInt(lastToken, 10);
            if (isNaN(idx) || idx < 0 || idx >= parent.length) {
              return Result.err(
                new StorageDiffError(
                  'INDEX_OUT_OF_BOUNDS',
                  `Invalid array index "${lastToken}" in path "${op.path}".`,
                  op.path
                )
              );
            }
            parent.splice(idx, 1);
          } else if (parent !== null && typeof parent === 'object') {
            if (!(lastToken in parent)) {
              return Result.err(StorageDiffError.pathNotFound(op.path));
            }
            delete parent[lastToken];
          } else {
            return Result.err(StorageDiffError.pathNotFound(op.path));
          }
          break;
        }
        case 'replace': {
          if (Array.isArray(parent)) {
            const idx = parseInt(lastToken, 10);
            if (isNaN(idx) || idx < 0 || idx >= parent.length) {
              return Result.err(
                new StorageDiffError(
                  'INDEX_OUT_OF_BOUNDS',
                  `Invalid array index "${lastToken}" in path "${op.path}".`,
                  op.path
                )
              );
            }
            parent[idx] = cloneValue(op.value);
          } else if (parent !== null && typeof parent === 'object') {
            if (!(lastToken in parent)) {
              return Result.err(StorageDiffError.pathNotFound(op.path));
            }
            parent[lastToken] = cloneValue(op.value);
          } else {
            return Result.err(StorageDiffError.pathNotFound(op.path));
          }
          break;
        }
        case 'move':
        case 'copy': {
          if (!op.from) {
            return Result.err(StorageDiffError.invalidPointer(op.path, `Operation "${op.op}" requires a "from" pointer.`));
          }
          // Resolve "from" path
          const fromTokensRes = parsePointerPath(op.from);
          if (!fromTokensRes.ok) return Result.err(fromTokensRes.error);
          const fromTokens = fromTokensRes.value;

          let fromParent = clone;
          for (let i = 0; i < fromTokens.length - 1; i++) {
            const token = fromTokens[i];
            if (fromParent === null || typeof fromParent !== 'object' || !(token in fromParent)) {
              return Result.err(StorageDiffError.pathNotFound(op.from, `From path component "${token}" not found.`));
            }
            fromParent = fromParent[token];
          }
          const fromLastToken = fromTokens[fromTokens.length - 1];

          let valToMove: any;
          if (Array.isArray(fromParent)) {
            const idx = parseInt(fromLastToken, 10);
            if (isNaN(idx) || idx < 0 || idx >= fromParent.length) {
              return Result.err(new StorageDiffError('INDEX_OUT_OF_BOUNDS', `Invalid from index "${fromLastToken}".`, op.from));
            }
            valToMove = fromParent[idx];
            if (op.op === 'move') {
              fromParent.splice(idx, 1);
            }
          } else if (fromParent !== null && typeof fromParent === 'object') {
            if (!(fromLastToken in fromParent)) {
              return Result.err(StorageDiffError.pathNotFound(op.from));
            }
            valToMove = fromParent[fromLastToken];
            if (op.op === 'move') {
              delete fromParent[fromLastToken];
            }
          } else {
            return Result.err(StorageDiffError.pathNotFound(op.from));
          }

          // Apply add at target path
          const addRes = RealtimeDiffEngine.applyPatch(clone, [
            { op: 'add', path: op.path, value: cloneValue(valToMove) },
          ]);
          if (!addRes.ok) return addRes;
          clone = addRes.value;
          break;
        }
      }
    }

    return Result.ok(clone);
  }

  /**
   * Generates inverse RFC 6902 patches for rollbacks given original target state.
   */
  public static invertPatches(
    patches: JSONPatchOperation[],
    targetBeforePatch: unknown
  ): Result<JSONPatchOperation[], StorageDiffError> {
    const inverse: JSONPatchOperation[] = [];
    let currentState: any = cloneValue(targetBeforePatch);

    for (const op of patches) {
      const tokensRes = parsePointerPath(op.path);
      if (!tokensRes.ok) return Result.err(tokensRes.error);
      const tokens = tokensRes.value;

      let valAtTarget: any = currentState;
      let exists = true;
      for (const token of tokens) {
        if (valAtTarget !== null && typeof valAtTarget === 'object' && token in valAtTarget) {
          valAtTarget = valAtTarget[token];
        } else {
          exists = false;
          break;
        }
      }

      switch (op.op) {
        case 'add':
          inverse.unshift({ op: 'remove', path: op.path, oldValue: cloneValue(op.value) });
          break;
        case 'remove':
          inverse.unshift({ op: 'add', path: op.path, value: exists ? cloneValue(valAtTarget) : op.oldValue });
          break;
        case 'replace':
          inverse.unshift({
            op: 'replace',
            path: op.path,
            value: exists ? cloneValue(valAtTarget) : op.oldValue,
            oldValue: cloneValue(op.value),
          });
          break;
        case 'move':
          if (op.from) {
            inverse.unshift({ op: 'move', path: op.from, from: op.path });
          }
          break;
        case 'copy':
          inverse.unshift({ op: 'remove', path: op.path });
          break;
        case 'test':
          inverse.unshift({ op: 'test', path: op.path, value: cloneValue(op.value) });
          break;
      }

      // Step state forward to compute next inverse step
      const stepRes = RealtimeDiffEngine.applyPatch(currentState, op);
      if (stepRes.ok) {
        currentState = stepRes.value;
      }
    }

    return Result.ok(inverse);
  }
}
