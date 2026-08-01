export interface LwwElement<T> {
  key: string;
  value: T;
  timestamp: number;
  peerId: string;
  sequence: number;
}

export interface LwwTombstone {
  key: string;
  timestamp: number;
  peerId: string;
  sequence: number;
}

export interface LwwSetState<T> {
  addSet: Record<string, LwwElement<T>>;
  removeSet: Record<string, LwwTombstone>;
}

/**
 * Compares two entries (timestamp, peerId, sequence) to determine if target (t1, peer1, seq1)
 * is newer than or equal to existing (t2, peer2, seq2).
 */
export function isNewerOrEqual(
  t1: number,
  peer1: string,
  seq1: number,
  t2: number,
  peer2: string,
  seq2: number
): boolean {
  if (t1 > t2) return true;
  if (t1 < t2) return false;
  if (peer1 !== peer2) return peer1 >= peer2;
  return seq1 >= seq2;
}

/**
 * Conflict-free Replicated Data Type (CRDT) Last-Write-Wins Element-Set (LWW-Element-Set).
 * Guarantees eventual consistency across distributed browser tabs and origins.
 */
export class CrdtLwwSet<T> {
  private readonly peerId: string;
  private sequence: number = 0;
  private readonly addSet: Map<string, LwwElement<T>> = new Map();
  private readonly removeSet: Map<string, LwwTombstone> = new Map();

  constructor(peerId?: string) {
    this.peerId = peerId ?? `peer_${Math.random().toString(36).substring(2, 11)}`;
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public add(
    key: string,
    value: T,
    timestamp?: number,
    peerId?: string,
    sequence?: number
  ): LwwElement<T> {
    const ts = timestamp ?? Date.now();
    const pid = peerId ?? this.peerId;
    const seq = sequence ?? ++this.sequence;

    const existing = this.addSet.get(key);
    if (!existing || isNewerOrEqual(ts, pid, seq, existing.timestamp, existing.peerId, existing.sequence)) {
      const element: LwwElement<T> = { key, value, timestamp: ts, peerId: pid, sequence: seq };
      this.addSet.set(key, element);
      return element;
    }
    return existing;
  }

  public remove(
    key: string,
    timestamp?: number,
    peerId?: string,
    sequence?: number
  ): LwwTombstone {
    const ts = timestamp ?? Date.now();
    const pid = peerId ?? this.peerId;
    const seq = sequence ?? ++this.sequence;

    const existing = this.removeSet.get(key);
    if (!existing || isNewerOrEqual(ts, pid, seq, existing.timestamp, existing.peerId, existing.sequence)) {
      const tombstone: LwwTombstone = { key, timestamp: ts, peerId: pid, sequence: seq };
      this.removeSet.set(key, tombstone);
      return tombstone;
    }
    return existing;
  }

  public has(key: string): boolean {
    const addEl = this.addSet.get(key);
    if (!addEl) return false;

    const remTomb = this.removeSet.get(key);
    if (!remTomb) return true;

    return isNewerOrEqual(
      addEl.timestamp,
      addEl.peerId,
      addEl.sequence,
      remTomb.timestamp,
      remTomb.peerId,
      remTomb.sequence
    );
  }

  public get(key: string): T | undefined {
    if (this.has(key)) {
      return this.addSet.get(key)?.value;
    }
    return undefined;
  }

  public getState(): LwwSetState<T> {
    const addSetRecord: Record<string, LwwElement<T>> = {};
    for (const [k, v] of this.addSet.entries()) {
      addSetRecord[k] = { ...v };
    }

    const removeSetRecord: Record<string, LwwTombstone> = {};
    for (const [k, v] of this.removeSet.entries()) {
      removeSetRecord[k] = { ...v };
    }

    return {
      addSet: addSetRecord,
      removeSet: removeSetRecord,
    };
  }

  public applyState(state: LwwSetState<T>): void {
    if (state.addSet) {
      for (const el of Object.values(state.addSet)) {
        const existing = this.addSet.get(el.key);
        if (
          !existing ||
          isNewerOrEqual(
            el.timestamp,
            el.peerId,
            el.sequence,
            existing.timestamp,
            existing.peerId,
            existing.sequence
          )
        ) {
          this.addSet.set(el.key, { ...el });
        }
      }
    }

    if (state.removeSet) {
      for (const tomb of Object.values(state.removeSet)) {
        const existing = this.removeSet.get(tomb.key);
        if (
          !existing ||
          isNewerOrEqual(
            tomb.timestamp,
            tomb.peerId,
            tomb.sequence,
            existing.timestamp,
            existing.peerId,
            existing.sequence
          )
        ) {
          this.removeSet.set(tomb.key, { ...tomb });
        }
      }
    }
  }

  public merge(remoteSet: CrdtLwwSet<T> | LwwSetState<T>): CrdtLwwSet<T> {
    const state = remoteSet instanceof CrdtLwwSet ? remoteSet.getState() : remoteSet;
    this.applyState(state);
    return this;
  }

  public keys(): string[] {
    const result: string[] = [];
    for (const key of this.addSet.keys()) {
      if (this.has(key)) {
        result.push(key);
      }
    }
    return result;
  }

  public values(): T[] {
    const result: T[] = [];
    for (const key of this.addSet.keys()) {
      if (this.has(key)) {
        const val = this.addSet.get(key)?.value;
        if (val !== undefined) {
          result.push(val);
        }
      }
    }
    return result;
  }

  public entries(): Array<[string, T]> {
    const result: Array<[string, T]> = [];
    for (const key of this.addSet.keys()) {
      if (this.has(key)) {
        const val = this.addSet.get(key)?.value;
        if (val !== undefined) {
          result.push([key, val]);
        }
      }
    }
    return result;
  }

  public size(): number {
    return this.keys().length;
  }

  public clear(): void {
    this.addSet.clear();
    this.removeSet.clear();
    this.sequence = 0;
  }

  public pruneTombstones(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [key, tomb] of this.removeSet.entries()) {
      if (tomb.timestamp < cutoff) {
        this.removeSet.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
