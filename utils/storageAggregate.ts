import { Result } from './result';

export interface StorageMutation {
  id: string;
  timestamp: number;
  type: 'set' | 'delete' | 'clear';
  storageType: 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB' | 'cacheAPI' | 'opfs';
  key: string;
  value?: string;
}

export interface StorageSnapshot {
  timestamp: number;
  entries: Record<string, string>;
}

export type StorageError = 
  | { type: 'INVALID_MUTATION'; message: string }
  | { type: 'SNAPSHOT_NOT_FOUND'; timestamp: number };

export class StorageStateAggregate {
  private timeline: StorageMutation[] = [];
  private lastTimestamp: number = -1;

  public applyMutation(mutation: StorageMutation): Result<StorageSnapshot, StorageError> {
    if (!mutation.key && mutation.type !== 'clear') {
      return Result.err({ type: 'INVALID_MUTATION', message: 'Key is required for set/delete operations' });
    }

    // High-Performance Optimization: O(1) push when in chronological order
    if (this.timeline.length === 0 || mutation.timestamp >= this.lastTimestamp) {
      this.timeline.push(mutation);
      this.lastTimestamp = mutation.timestamp;
    } else {
      // Binary / Array insert for out-of-order mutations
      this.timeline.push(mutation);
      this.timeline.sort((a, b) => a.timestamp - b.timestamp);
      this.lastTimestamp = this.timeline[this.timeline.length - 1].timestamp;
    }

    // Return snapshot lazily computed
    const snapshot = this.calculateSnapshotAt(mutation.timestamp);
    return Result.ok(snapshot);
  }

  public getSnapshotAt(timestamp: number): Result<StorageSnapshot, StorageError> {
    if (this.timeline.length === 0) {
      return Result.err({ type: 'SNAPSHOT_NOT_FOUND', timestamp });
    }

    const snapshot = this.calculateSnapshotAt(timestamp);
    return Result.ok(snapshot);
  }

  private calculateSnapshotAt(timestamp: number): StorageSnapshot {
    const entries: Record<string, string> = Object.create(null);

    for (let i = 0; i < this.timeline.length; i++) {
      const mut = this.timeline[i];
      if (mut.timestamp > timestamp) break;

      if (mut.type === 'set' && mut.value !== undefined) {
        entries[mut.key] = mut.value;
      } else if (mut.type === 'delete') {
        delete entries[mut.key];
      } else if (mut.type === 'clear') {
        Object.keys(entries).forEach((k) => delete entries[k]);
      }
    }

    return { timestamp, entries };
  }
}
