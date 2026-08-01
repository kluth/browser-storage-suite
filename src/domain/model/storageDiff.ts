import { Result } from '../../../utils/result';
import type { StorageTarget } from './valueObjects';

export type StorageTargetType = StorageTarget;
export type { StorageTarget };

export type JSONPatchOp = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
export type JsonPatchOpType = JSONPatchOp;

export interface AddPatchOp {
  readonly op: 'add';
  readonly path: string;
  readonly value: unknown;
}

export interface RemovePatchOp {
  readonly op: 'remove';
  readonly path: string;
  readonly oldValue?: unknown;
}

export interface ReplacePatchOp {
  readonly op: 'replace';
  readonly path: string;
  readonly value: unknown;
  readonly oldValue?: unknown;
}

export interface MovePatchOp {
  readonly op: 'move';
  readonly from: string;
  readonly path: string;
}

export interface CopyPatchOp {
  readonly op: 'copy';
  readonly from: string;
  readonly path: string;
}

export interface TestPatchOp {
  readonly op: 'test';
  readonly path: string;
  readonly value: unknown;
}

export type JsonPatchOperation =
  | AddPatchOp
  | RemovePatchOp
  | ReplacePatchOp
  | MovePatchOp
  | CopyPatchOp
  | TestPatchOp;

export interface JSONPatchOperation {
  op: JSONPatchOp;
  path: string;
  value?: any;
  from?: string;
  oldValue?: any;
}

export type DiffChangeType = 'created' | 'modified' | 'deleted' | 'unchanged';

export interface StorageDiffDelta {
  key: string;
  oldValue: any;
  newValue: any;
  patches: JSONPatchOperation[];
  inversePatches: JSONPatchOperation[];
  timestamp: number;
  changeType: DiffChangeType;
}

export interface StorageDiffSummary {
  totalKeysCompared: number;
  keysAdded: number;
  keysModified: number;
  keysDeleted: number;
  keysUnchanged: number;
  patchCount: number;
  timestamp: number;
}

export interface StorageDiffResult {
  deltas: StorageDiffDelta[];
  summary: StorageDiffSummary;
  globalPatches: JSONPatchOperation[];
  globalInversePatches: JSONPatchOperation[];
}

export type ArrayDiffStrategy = 'index' | 'lcs' | 'atomic';

export interface StorageDiffOptions {
  readonly ignoreKeys?: ReadonlyArray<string>;
  readonly invertible?: boolean;
  readonly arrayDiffStrategy?: ArrayDiffStrategy;
  readonly maxDepth?: number;
  readonly floatTolerance?: number;
  readonly detectMovesCopies?: boolean;
  readonly includeOldValueInReplace?: boolean;
}

export const DEFAULT_STORAGE_DIFF_OPTIONS: Required<StorageDiffOptions> = {
  ignoreKeys: [],
  invertible: true,
  arrayDiffStrategy: 'lcs',
  maxDepth: 32,
  floatTolerance: 0,
  detectMovesCopies: false,
  includeOldValueInReplace: true,
};

export type StorageDiffErrorKind =
  | 'INVALID_JSON_POINTER'
  | 'INVALID_POINTER'
  | 'PATH_NOT_FOUND'
  | 'TEST_FAILED'
  | 'TYPE_MISMATCH'
  | 'CIRCULAR_REFERENCE'
  | 'INDEX_OUT_OF_BOUNDS'
  | 'PARSE_ERROR'
  | 'MAX_DEPTH_EXCEEDED'
  | 'INVALID_PATCH';

export class StorageDiffError {
  constructor(
    public readonly kind: StorageDiffErrorKind,
    public readonly message: string,
    public readonly path?: string,
    public readonly expected?: any,
    public readonly actual?: any,
    public readonly cause?: unknown
  ) {}

  public get code(): StorageDiffErrorKind {
    return this.kind;
  }

  public static pathNotFound(path: string, message?: string): StorageDiffError {
    return new StorageDiffError(
      'PATH_NOT_FOUND',
      message ?? `Target JSON pointer path not found: ${path}`,
      path
    );
  }

  public static testFailed(path: string, expected: unknown, actual: unknown): StorageDiffError {
    return new StorageDiffError(
      'TEST_FAILED',
      `RFC 6902 test operation failed at path "${path}". Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
      path,
      expected,
      actual
    );
  }

  public static invalidPatch(message: string, path?: string): StorageDiffError {
    return new StorageDiffError('INVALID_PATCH', message, path);
  }

  public static maxDepthExceeded(maxDepth: number, path?: string): StorageDiffError {
    return new StorageDiffError(
      'MAX_DEPTH_EXCEEDED',
      `Diff calculation exceeded maximum recursion depth of ${maxDepth}`,
      path
    );
  }

  public static typeMismatch(path: string, expected: string, actual: string): StorageDiffError {
    return new StorageDiffError(
      'TYPE_MISMATCH',
      `Type mismatch at path ${path}: expected ${expected}, got ${actual}`,
      path,
      expected,
      actual
    );
  }

  public static circularReference(path: string): StorageDiffError {
    return new StorageDiffError('CIRCULAR_REFERENCE', `Circular reference detected in structure at ${path}`, path);
  }

  public static invalidPointer(rawPath: string, reason: string): StorageDiffError {
    return new StorageDiffError('INVALID_POINTER', `Invalid JSON Pointer "${rawPath}": ${reason}`, rawPath);
  }
}

export class JsonPointer {
  private constructor(public readonly value: string) {}

  public static create(rawPath: string): Result<JsonPointer, StorageDiffError> {
    if (rawPath === '') {
      return Result.ok(new JsonPointer(''));
    }
    if (!rawPath.startsWith('/')) {
      return Result.err(StorageDiffError.invalidPointer(rawPath, 'Must start with "/" or be empty'));
    }
    return Result.ok(new JsonPointer(rawPath));
  }
}
