import { Result } from '../../../utils/result';

export class StorageKey {
  private constructor(public readonly value: string) {}

  public static create(raw: string): Result<StorageKey, string> {
    if (!raw || raw.trim().length === 0) {
      return Result.err('StorageKey cannot be empty');
    }
    return Result.ok(new StorageKey(raw.trim()));
  }
}

export class StorageValue {
  public readonly sizeInBytes: number;

  private constructor(public readonly value: string) {
    this.sizeInBytes = new Blob([value]).size;
  }

  public static create(raw: string): Result<StorageValue, never> {
    return Result.ok(new StorageValue(raw ?? ''));
  }
}

export type StorageTarget = 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB' | 'cacheAPI' | 'opfs';

export class GraphNodeId {
  private constructor(public readonly value: string) {}

  public static create(raw: string): Result<GraphNodeId, string> {
    if (!raw || raw.trim().length === 0) {
      return Result.err('GraphNodeId cannot be empty');
    }
    return Result.ok(new GraphNodeId(raw.trim()));
  }

  public equals(other: GraphNodeId): boolean {
    return this.value === other.value;
  }
}

export class Node3DPositionVO {
  private constructor(
    public readonly id: GraphNodeId,
    public readonly x: number,
    public readonly y: number,
    public readonly z: number
  ) {}

  public static create(idRaw: string, x: number, y: number, z: number): Result<Node3DPositionVO, string> {
    const idRes = GraphNodeId.create(idRaw);
    if (!idRes.ok) return Result.err(idRes.error);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return Result.err('Node3DPosition coordinates must be finite numbers');
    }
    return Result.ok(new Node3DPositionVO(idRes.value, x, y, z));
  }

  public toTuple(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

