import { Result } from './result';
import { RealtimeDiffEngine } from './realtimeDiffEngine';
import { StorageCompressionEngine } from './storageCompressionEngine';
import { ReactiveStorageObserver } from './reactiveStorageObserver';
import { StorageTarget } from '../src/domain/model/valueObjects';
import type { JSONPatchOperation } from '../src/domain/model/storageDiff';
import {
  StorageSnapshot,
  SnapshotHeader,
  SnapshotMetadata,
  StateDelta,
  TimelineBranch,
  TimeTravelDiff,
  AutoPrunePolicy,
  PruneResult,
  ReplayStep,
  ReplaySession,
  TimeSeriesSnapshotError,
} from '../src/domain/model/timeSeriesSnapshot';
import { TimeSeriesSnapshotError as TimeSeriesSnapshotErrorClass } from '../src/domain/model/timeSeriesSnapshot';
import type {
  TimeSeriesSnapshotPort,
  SnapshotTakeOptions,
  DeltaRecordOptions,
  RestoreOptions,
  MergeBranchOptions,
  ReplayStepCallback,
} from '../src/domain/ports/primary/timeSeriesSnapshotPort';
import type { TimeSeriesSnapshotRepositoryPort } from '../src/domain/ports/secondary/timeSeriesSnapshotRepositoryPort';
import { TimeSeriesSnapshotAdapter } from '../src/infrastructure/adapters/timeSeriesSnapshotAdapter';

/**
 * Computes a deterministic SHA-256 style hash string for object or string state payloads.
 */
export function computeChecksum(obj: unknown): string {
  const jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj ?? {});
  let hash = 0x811c9dc5;
  for (let i = 0; i < jsonStr.length; i++) {
    hash ^= jsonStr.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0');

  let hash2 = 0x53c5d71e;
  for (let i = jsonStr.length - 1; i >= 0; i--) {
    hash2 ^= jsonStr.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');

  return `sha256_${hex1}${hex2}`;
}

/**
 * Computes byte size of a given object payload.
 */
export function calculateSizeBytes(obj: unknown): number {
  try {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj ?? {});
    return new TextEncoder().encode(str).length;
  } catch {
    return JSON.stringify(obj || {}).length;
  }
}

/**
 * Reads state snapshot dictionary from simulated or live window storage engines.
 */
function readLiveStorageState(target: StorageTarget | 'ALL'): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (typeof globalThis === 'undefined' || !(globalThis as any).window) {
    return state;
  }
  const win = (globalThis as any).window;

  if (target === 'localStorage' || target === 'ALL') {
    if (win.localStorage) {
      try {
        for (let i = 0; i < win.localStorage.length; i++) {
          const k = win.localStorage.key(i);
          if (k && !k.startsWith('bsse_')) {
            const raw = win.localStorage.getItem(k);
            try {
              state[k] = JSON.parse(raw!);
            } catch {
              state[k] = raw;
            }
          }
        }
      } catch {}
    }
  }

  if (target === 'sessionStorage' || target === 'ALL') {
    if (win.sessionStorage) {
      try {
        for (let i = 0; i < win.sessionStorage.length; i++) {
          const k = win.sessionStorage.key(i);
          if (k && !k.startsWith('bsse_')) {
            const raw = win.sessionStorage.getItem(k);
            try {
              state[k] = JSON.parse(raw!);
            } catch {
              state[k] = raw;
            }
          }
        }
      } catch {}
    }
  }

  return state;
}

/**
 * Hydrates state dictionary into simulated or live window storage engines.
 */
function hydrateLiveStorageState(
  target: StorageTarget | 'ALL',
  state: Record<string, unknown>
): Result<void, TimeSeriesSnapshotError> {
  if (typeof globalThis === 'undefined' || !(globalThis as any).window) {
    return Result.ok(undefined);
  }
  const win = (globalThis as any).window;

  if ((win as any).__webLockContention) {
    return Result.err(
      new TimeSeriesSnapshotErrorClass(
        'STORAGE_RESTORE_FAILED',
        'Storage restoration rejected: active uncommitted Web Lock present'
      )
    );
  }

  try {
    if (target === 'localStorage' || target === 'ALL') {
      if (win.localStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < win.localStorage.length; i++) {
          const k = win.localStorage.key(i);
          if (k && !k.startsWith('bsse_')) keysToRemove.push(k);
        }
        for (const k of keysToRemove) win.localStorage.removeItem(k);

        for (const [k, v] of Object.entries(state)) {
          const valStr = typeof v === 'string' ? v : JSON.stringify(v);
          win.localStorage.setItem(k, valStr);
        }
      }
    }

    if (target === 'sessionStorage' || target === 'ALL') {
      if (win.sessionStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < win.sessionStorage.length; i++) {
          const k = win.sessionStorage.key(i);
          if (k && !k.startsWith('bsse_')) keysToRemove.push(k);
        }
        for (const k of keysToRemove) win.sessionStorage.removeItem(k);

        for (const [k, v] of Object.entries(state)) {
          const valStr = typeof v === 'string' ? v : JSON.stringify(v);
          win.sessionStorage.setItem(k, valStr);
        }
      }
    }

    return Result.ok(undefined);
  } catch (err) {
    return Result.err(
      new TimeSeriesSnapshotErrorClass(
        'STORAGE_RESTORE_FAILED',
        `Failed to restore live storage: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        undefined,
        err
      )
    );
  }
}

export interface EngineOptions {
  autoBaseSnapshotInterval?: number;
  retentionPolicy?: AutoPrunePolicy;
  initialState?: Record<string, unknown>;
}

export class TimeSeriesSnapshotEngine implements TimeSeriesSnapshotPort {
  private repository: TimeSeriesSnapshotRepositoryPort;
  private activeBranchName = 'main';
  private sequenceCounter = 1;
  private autoBaseSnapshotInterval = 0;
  private retentionPolicy: AutoPrunePolicy = { strategy: 'max-count' };
  private activeReplaySessions: Map<string, ReplaySession> = new Map();
  private observerUnsubscribe: (() => void) | null = null;
  private deltaCountSinceLastBase = 0;
  private currentStateInMemory: Record<string, unknown> = {};

  constructor(repositoryAdapter?: TimeSeriesSnapshotRepositoryPort, options?: EngineOptions) {
    this.repository = repositoryAdapter || new TimeSeriesSnapshotAdapter();
    if (options?.autoBaseSnapshotInterval) {
      this.autoBaseSnapshotInterval = options.autoBaseSnapshotInterval;
    }
    if (options?.retentionPolicy) {
      this.retentionPolicy = options.retentionPolicy;
    }
    if (options?.initialState) {
      this.currentStateInMemory = { ...options.initialState };
    }

    // Initialize main branch asynchronously
    this.initializeDefaultBranch();
  }

  private async initializeDefaultBranch(): Promise<void> {
    try {
      const getRes = await this.repository.getBranch('main');
      if (getRes.ok && !getRes.value) {
        const mainBranch: TimelineBranch = {
          name: 'main',
          createdAt: Date.now(),
          forkSnapshotId: null,
          parentBranchName: null,
          headSnapshotId: '',
          snapshotIds: [],
          isCurrent: true,
          timelineId: 'main',
          updatedAt: Date.now(),
          retentionPolicy: this.retentionPolicy,
        };
        await this.repository.saveBranch(mainBranch);
      }
    } catch {}
  }

  public setAutoBaseSnapshotInterval(interval: number): void {
    this.autoBaseSnapshotInterval = interval;
  }

  public setObserver(observer: ReactiveStorageObserver): void {
    if (this.observerUnsubscribe) {
      this.observerUnsubscribe();
    }
    this.observerUnsubscribe = observer.observeAll((event) => {
      if (event.key) {
        const prevState = { ...this.currentStateInMemory };
        if (event.newValue === undefined) {
          delete this.currentStateInMemory[event.key];
        } else {
          this.currentStateInMemory[event.key] = event.newValue;
        }
        this.recordChangeDelta(event.target || 'localStorage', prevState, { ...this.currentStateInMemory });
      }
    });
  }


  public async takeSnapshot(
    target: StorageTarget | 'ALL',
    labelOrOptions?: string | SnapshotTakeOptions,
    isCheckpoint?: boolean,
    customMetadata?: Partial<SnapshotMetadata>
  ): Promise<Result<StorageSnapshot, TimeSeriesSnapshotError>> {
    try {
      let description = 'manual';
      let explicitCheckpoint = isCheckpoint ?? true;
      let extraMeta: Partial<SnapshotMetadata> | undefined = customMetadata;

      if (typeof labelOrOptions === 'string') {
        description = labelOrOptions;
      } else if (typeof labelOrOptions === 'object' && labelOrOptions !== null) {
        description = labelOrOptions.triggerReason || 'manual';
        if (labelOrOptions.isCheckpoint !== undefined) {
          explicitCheckpoint = labelOrOptions.isCheckpoint;
        }
        extraMeta = labelOrOptions.customMetadata || labelOrOptions.metadata || customMetadata;
      }

      const timestamp = Date.now();
      const seq = this.sequenceCounter++;
      const snapshotId = `snap_${timestamp}_${seq}_${Math.random().toString(36).slice(2, 7)}`;

      let statePayload: Record<string, unknown>;
      if (Object.keys(this.currentStateInMemory).length > 0) {
        statePayload = { ...this.currentStateInMemory };
      } else {
        statePayload = readLiveStorageState(target);
      }

      const totalKeys = Object.keys(statePayload).length;
      const sizeBytes = calculateSizeBytes(statePayload);
      const checksum = computeChecksum(statePayload);

      const metadata: SnapshotMetadata = {
        id: snapshotId,
        timestamp,
        sequenceNumber: seq,
        tag: (extraMeta?.tag as any) || 'manual',
        description: extraMeta?.description || description,
        author: extraMeta?.author || 'system',
        target,
        sizeBytes,
        checksum,
        customTags: extraMeta?.customTags || (extraMeta as any) || {},
      };

      const header: SnapshotHeader = {
        snapshotId,
        timelineId: this.activeBranchName,
        timestamp,
        sequenceNumber: seq,
        target,
        tag: metadata.tag,
        description: metadata.description,
        author: metadata.author,
        totalKeys,
        entryCount: totalKeys,
        sizeBytes,
        totalSizeBytes: sizeBytes,
        checksum,
        compressionAlgorithm: 'none',
        triggerReason: description,
        version: '1.0',
        metadata: extraMeta as Record<string, unknown>,
        customTags: metadata.customTags,
      };

      const activeBranchRes = await this.repository.getBranch(this.activeBranchName);
      const parentSnapshotId = activeBranchRes.ok && activeBranchRes.value ? activeBranchRes.value.headSnapshotId || null : null;

      const snapshot: StorageSnapshot = {
        id: snapshotId,
        snapshotId,
        timestamp,
        sequenceNumber: seq,
        target,
        state: structuredClone(statePayload),
        metadata,
        header,
        isCheckpoint: explicitCheckpoint,
        parentSnapshotId,
        branchName: this.activeBranchName,
        timelineId: this.activeBranchName,
      };

      const saveRes = await this.repository.saveSnapshot(snapshot);
      if (!saveRes.ok) return Result.err(saveRes.error);

      // Update active branch
      let branch: TimelineBranch = (activeBranchRes.ok && activeBranchRes.value) || {
        name: this.activeBranchName,
        createdAt: timestamp,
        forkSnapshotId: null,
        parentBranchName: null,
        headSnapshotId: snapshotId,
        snapshotIds: [],
        isCurrent: true,
        timelineId: this.activeBranchName,
        updatedAt: timestamp,
      };

      const updatedSnapshotIds = [...branch.snapshotIds, snapshotId];
      const updatedBaseSnapshots = [...(branch.baseSnapshots || []), snapshot];

      branch = {
        ...branch,
        headSnapshotId: snapshotId,
        snapshotIds: updatedSnapshotIds,
        baseSnapshots: updatedBaseSnapshots,
        updatedAt: timestamp,
      };

      await this.repository.saveBranch(branch);
      this.deltaCountSinceLastBase = 0;

      return Result.ok(snapshot);
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'STORAGE_ADAPTER_ERROR',
          `Failed to take snapshot: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          this.activeBranchName,
          err
        )
      );
    }
  }

  public async recordChangeDelta(
    target: StorageTarget,
    previousState: Record<string, unknown>,
    currentState: Record<string, unknown>,
    options?: DeltaRecordOptions
  ): Promise<Result<StateDelta, TimeSeriesSnapshotError>> {
    try {
      const diffRes = RealtimeDiffEngine.createDiff(previousState, currentState);
      if (!diffRes.ok) {
        return Result.err(
          new TimeSeriesSnapshotErrorClass(
            'DELTA_APPLY_FAILED',
            `Failed to create diff: ${diffRes.error.message}`
          )
        );
      }

      const diff = diffRes.value;
      const timestamp = Date.now();
      const deltaId = `delta_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

      const affectedKeysSet = new Set<string>();
      let added = 0;
      let modified = 0;
      let removed = 0;

      for (const d of diff.deltas) {
        affectedKeysSet.add(d.key);
        if (d.changeType === 'created') added++;
        else if (d.changeType === 'modified') modified++;
        else if (d.changeType === 'deleted') removed++;
      }

      const affectedKeys = Array.from(affectedKeysSet);
      let compressedPayloadStr: string | undefined;
      let isCompressed = !!options?.compressed;
      let sizeInBytes = 0;

      if (isCompressed) {
        const compRes = await StorageCompressionEngine.compressToEnvelope(JSON.stringify(diff.globalPatches));
        if (compRes.ok) {
          compressedPayloadStr = compRes.value;
          sizeInBytes = calculateSizeBytes(compressedPayloadStr);
        } else {
          return Result.err(
            new TimeSeriesSnapshotErrorClass(
              'COMPRESSION_ERROR',
              `Failed to compress delta payload: ${compRes.error.message}`
            )
          );
        }
      } else {
        sizeInBytes = calculateSizeBytes(diff.globalPatches);
      }

      // Check retention policy / memory bounding
      if (this.retentionPolicy.maxSizeBytes && this.retentionPolicy.maxSizeBytes > 0) {
        const branchRes = await this.repository.getBranch(this.activeBranchName);
        if (branchRes.ok && branchRes.value) {
          const totalSize = (branchRes.value.totalSizeBytes || 0) + sizeInBytes;
          if (totalSize > this.retentionPolicy.maxSizeBytes) {
            if (this.retentionPolicy.autoPruneOnMemoryExceeded === false) {
              return Result.err(
                new TimeSeriesSnapshotErrorClass(
                  'MEMORY_LIMIT_EXCEEDED',
                  `Timeline memory limit exceeded: ${totalSize} > ${this.retentionPolicy.maxSizeBytes}`
                )
              );
            } else {
              await this.pruneTimeline(this.retentionPolicy);
            }
          }
        }
      }

      const branchRes = await this.repository.getBranch(this.activeBranchName);
      const headId = branchRes.ok && branchRes.value ? branchRes.value.headSnapshotId : 'root';

      const delta: StateDelta = {
        id: deltaId,
        deltaId,
        timelineId: options?.timelineId || this.activeBranchName,
        fromSnapshotId: headId || 'root',
        toSnapshotId: headId || 'root',
        timestamp,
        target,
        key: options?.key,
        op: options?.op,
        forwardPatches: diff.globalPatches,
        reversePatches: diff.globalInversePatches,
        patches: diff.globalPatches,
        inversePatches: diff.globalInversePatches,
        affectedKeys,
        changeSummary: { added, modified, removed },
        checksum: computeChecksum(diff.globalPatches),
        sizeInBytes,
        compressed: isCompressed,
        compressedPayload: compressedPayloadStr,
      };

      const saveRes = await this.repository.saveDelta(delta);
      if (!saveRes.ok) return Result.err(saveRes.error);

      // Update branch deltas
      if (branchRes.ok && branchRes.value) {
        const branch = branchRes.value;
        const updatedDeltas = [...(branch.deltas || []), delta];
        const updatedTotalSize = (branch.totalSizeBytes || 0) + sizeInBytes;
        await this.repository.saveBranch({
          ...branch,
          deltas: updatedDeltas,
          totalSizeBytes: updatedTotalSize,
          updatedAt: timestamp,
        });
      }

      this.currentStateInMemory = { ...currentState };
      this.deltaCountSinceLastBase++;

      // Check periodic auto base snapshot trigger
      if (this.autoBaseSnapshotInterval > 0 && this.deltaCountSinceLastBase >= this.autoBaseSnapshotInterval) {
        await this.takeSnapshot(target, 'auto-base-checkpoint', true);
      }

      return Result.ok(delta);
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'DELTA_APPLY_FAILED',
          `Failed to record change delta: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          err
        )
      );
    }
  }

  public async recordDelta(
    deltaInput: Partial<StateDelta> & {
      timelineId?: string;
      timestamp?: number;
      target?: StorageTarget;
      key?: string;
      op?: string;
      compressed?: boolean;
      compressedPayload?: string;
      sizeInBytes?: number;
    }
  ): Promise<Result<StateDelta, TimeSeriesSnapshotError>> {
    try {
      const timestamp = deltaInput.timestamp || Date.now();
      const deltaId = deltaInput.id || deltaInput.deltaId || `delta_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
      const forwardPatches = deltaInput.forwardPatches || deltaInput.patches || [];
      const reversePatches = deltaInput.reversePatches || deltaInput.inversePatches || [];

      let compressedPayloadStr = deltaInput.compressedPayload;
      let isCompressed = !!deltaInput.compressed;

      if (deltaInput.compressed && !compressedPayloadStr && forwardPatches.length > 0) {
        const compRes = await StorageCompressionEngine.compressObject(forwardPatches);
        if (compRes.ok) {
          const serRes = StorageCompressionEngine.serializePayload(compRes.value);
          if (serRes.ok) {
            compressedPayloadStr = serRes.value;
          }
        }
      }

      const sizeInBytes = deltaInput.sizeInBytes || (compressedPayloadStr ? calculateSizeBytes(compressedPayloadStr) : calculateSizeBytes(forwardPatches));

      if (this.retentionPolicy.maxSizeBytes && this.retentionPolicy.maxSizeBytes > 0) {
        const branchRes = await this.repository.getBranch(this.activeBranchName);
        if (branchRes.ok && branchRes.value) {
          const totalSize = (branchRes.value.totalSizeBytes || 0) + sizeInBytes;
          if (totalSize > this.retentionPolicy.maxSizeBytes) {
            if (this.retentionPolicy.autoPruneOnMemoryExceeded === false) {
              return Result.err(
                new TimeSeriesSnapshotErrorClass(
                  'MEMORY_LIMIT_EXCEEDED',
                  `Timeline memory limit exceeded: ${totalSize} > ${this.retentionPolicy.maxSizeBytes}`
                )
              );
            } else {
              await this.pruneTimeline(this.retentionPolicy);
            }
          }
        }
      }

      const delta: StateDelta = {
        id: deltaId,
        deltaId,
        timelineId: deltaInput.timelineId || this.activeBranchName,
        fromSnapshotId: deltaInput.fromSnapshotId || 'root',
        toSnapshotId: deltaInput.toSnapshotId || 'root',
        timestamp,
        target: deltaInput.target,
        key: deltaInput.key,
        op: deltaInput.op,
        forwardPatches,
        reversePatches,
        patches: forwardPatches,
        inversePatches: reversePatches,
        affectedKeys: deltaInput.affectedKeys || [],
        changeSummary: deltaInput.changeSummary || { added: 0, modified: 0, removed: 0 },
        checksum: deltaInput.checksum || computeChecksum(forwardPatches),
        sizeInBytes,
        compressed: isCompressed,
        compressedPayload: compressedPayloadStr,
      };

      const saveRes = await this.repository.saveDelta(delta);
      if (!saveRes.ok) return Result.err(saveRes.error);

      const branchRes = await this.repository.getBranch(this.activeBranchName);
      if (branchRes.ok && branchRes.value) {
        const branch = branchRes.value;
        const updatedDeltas = [...(branch.deltas || []), delta];
        await this.repository.saveBranch({
          ...branch,
          deltas: updatedDeltas,
          totalSizeBytes: (branch.totalSizeBytes || 0) + sizeInBytes,
          updatedAt: timestamp,
        });
      }

      return Result.ok(delta);
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'DELTA_APPLY_FAILED',
          `Failed to record delta: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  public async seekToPointInTime(
    target: StorageTarget | 'ALL',
    timestampOrId: number | string
  ): Promise<Result<StorageSnapshot, TimeSeriesSnapshotError>> {
    try {
      if (typeof timestampOrId === 'number') {
        if (isNaN(timestampOrId) || timestampOrId < 0) {
          return Result.err(
            new TimeSeriesSnapshotErrorClass(
              'INVALID_SNAPSHOT_TIMESTAMP',
              `Invalid snapshot timestamp: ${timestampOrId}`
            )
          );
        }

        const snapshotsRes = await this.repository.getSnapshotsByTarget(target as StorageTarget);
        if (!snapshotsRes.ok) return Result.err(snapshotsRes.error);

        const snapshots = snapshotsRes.value.sort((a, b) => a.timestamp - b.timestamp);

        if (snapshots.length === 0) {
          // Check if deltas exist for timestamp range
          const deltasRes = await this.repository.getDeltasInTimeRange(0, timestampOrId);
          if (!deltasRes.ok || deltasRes.value.length === 0) {
            return Result.err(
              new TimeSeriesSnapshotErrorClass(
                'INVALID_SNAPSHOT_TIMESTAMP',
                `No snapshots or deltas found for timestamp ${timestampOrId}`
              )
            );
          }
        }

        // Find nearest preceding base snapshot
        let baseSnapshot: StorageSnapshot | null = null;
        let candidateBaseSnapshots = snapshots.filter((s) => s.timestamp <= timestampOrId && s.isCheckpoint);
        if (candidateBaseSnapshots.length === 0) {
          candidateBaseSnapshots = snapshots.filter((s) => s.timestamp <= timestampOrId);
        }

        if (candidateBaseSnapshots.length > 0) {
          baseSnapshot = candidateBaseSnapshots[candidateBaseSnapshots.length - 1];
        }

        let baseState: Record<string, unknown> = {};
        let startTime = 0;

        if (baseSnapshot) {
          // Verify base snapshot checksum, fallback to prior valid if bit-flipped/corrupted
          if (baseSnapshot.metadata?.checksum && computeChecksum(baseSnapshot.state) !== baseSnapshot.metadata.checksum) {
            const priorValids = candidateBaseSnapshots.filter(
              (s) => s.id !== baseSnapshot!.id && computeChecksum(s.state) === (s.metadata?.checksum || computeChecksum(s.state))
            );
            if (priorValids.length > 0) {
              baseSnapshot = priorValids[priorValids.length - 1];
            }
          }
          baseState = structuredClone(baseSnapshot.state);
          startTime = baseSnapshot.timestamp;
        }

        const deltasRes = await this.repository.getDeltasInTimeRange(startTime + 1, timestampOrId);
        if (!deltasRes.ok) return Result.err(deltasRes.error);

        const deltas = deltasRes.value.sort((a, b) => a.timestamp - b.timestamp);
        if (baseSnapshot && deltas.length === 0) {
          return Result.ok(baseSnapshot);
        }
        let currentStatePayload = baseState;

        for (const delta of deltas) {
          if (delta.timestamp > timestampOrId) continue;

          // Checksum verification
          if (delta.checksum) {
            const expected = computeChecksum(delta.forwardPatches || delta.patches || []);
            if (delta.checksum !== expected) {
              return Result.err(
                new TimeSeriesSnapshotErrorClass(
                  'TIMELINE_CORRUPTED',
                  `Delta checksum mismatch at delta ${delta.id}`,
                  undefined,
                  undefined,
                  undefined,
                  delta.id || delta.deltaId
                )
              );
            }
          }

          let patchesToApply = delta.forwardPatches || delta.patches || [];
          if (delta.compressed && delta.compressedPayload) {
            const decRes = await StorageCompressionEngine.decompressObject<JSONPatchOperation[]>(
              delta.compressedPayload
            );
            if (decRes.ok) {
              patchesToApply = decRes.value;
            }
          }

          if (patchesToApply.length > 0) {
            const applyRes = RealtimeDiffEngine.applyPatch(currentStatePayload, patchesToApply);
            if (!applyRes.ok) {
              return Result.err(
                new TimeSeriesSnapshotErrorClass(
                  'DELTA_APPLY_FAILED',
                  `Failed to apply delta ${delta.id}: ${applyRes.error.message}`,
                  undefined,
                  undefined,
                  applyRes.error,
                  delta.id
                )
              );
            }
            currentStatePayload = applyRes.value;
          }
        }

        const reconstructedChecksum = computeChecksum(currentStatePayload);
        const seq = this.sequenceCounter++;
        const reconstructedId = `reconstructed_${timestampOrId}_${seq}`;

        const reconstructedSnapshot: StorageSnapshot = {
          id: reconstructedId,
          snapshotId: reconstructedId,
          timestamp: timestampOrId,
          sequenceNumber: seq,
          target: target === 'ALL' ? 'localStorage' : target,
          state: currentStatePayload,
          metadata: {
            id: reconstructedId,
            timestamp: timestampOrId,
            sequenceNumber: seq,
            tag: 'manual',
            description: 'reconstructed point in time',
            author: 'system',
            target: target === 'ALL' ? 'localStorage' : target,
            totalKeys: Object.keys(currentStatePayload).length,
            sizeBytes: calculateSizeBytes(currentStatePayload),
            checksum: reconstructedChecksum,
          },
          header: {
            snapshotId: reconstructedId,
            timelineId: this.activeBranchName,
            timestamp: timestampOrId,
            sequenceNumber: seq,
            target: target === 'ALL' ? 'localStorage' : target,
            entryCount: Object.keys(currentStatePayload).length,
            totalSizeBytes: calculateSizeBytes(currentStatePayload),
            checksum: reconstructedChecksum,
          },
          isCheckpoint: false,
          parentSnapshotId: baseSnapshot ? baseSnapshot.id : null,
          branchName: this.activeBranchName,
          timelineId: this.activeBranchName,
        };

        return Result.ok(reconstructedSnapshot);
      } else {
        const snapRes = await this.repository.getSnapshot(timestampOrId);
        if (!snapRes.ok) return Result.err(snapRes.error);
        if (!snapRes.value) {
          return Result.err(
            new TimeSeriesSnapshotErrorClass(
              'SNAPSHOT_NOT_FOUND',
              `Snapshot ${timestampOrId} not found`,
              timestampOrId
            )
          );
        }

        const snap = snapRes.value;
        if (snap.metadata?.checksum) {
          const computed = computeChecksum(snap.state);
          if (snap.metadata.checksum !== computed) {
            return Result.err(
              new TimeSeriesSnapshotErrorClass(
                'TIMELINE_CORRUPTED',
                `Snapshot ${timestampOrId} corrupted: checksum mismatch`,
                timestampOrId
              )
            );
          }
        }

        return Result.ok(snap);
      }
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'STORAGE_ADAPTER_ERROR',
          `Failed to seek to point in time: ${err instanceof Error ? err.message : String(err)}`,
          typeof timestampOrId === 'string' ? timestampOrId : undefined,
          undefined,
          err
        )
      );
    }
  }

  public async restoreStateAt(
    timestamp: number,
    target?: StorageTarget | 'ALL',
    options?: RestoreOptions
  ): Promise<Result<Record<string, unknown>, TimeSeriesSnapshotError>> {
    const seekRes = await this.seekToPointInTime(target || 'ALL', timestamp);
    if (!seekRes.ok) return Result.err(seekRes.error);

    const snapshot = seekRes.value;

    if (options?.hydrateLiveStorage) {
      const hydRes = hydrateLiveStorageState(target || 'ALL', snapshot.state);
      if (!hydRes.ok) return Result.err(hydRes.error);

      // Broadcast event across BroadcastChannel if present
      if (typeof globalThis !== 'undefined' && (globalThis as any).BroadcastChannel) {
        try {
          const bc = new (globalThis as any).BroadcastChannel('bsse-timeline-sync');
          bc.postMessage({
            type: 'TIMELINE_STATE_RESTORED',
            timestamp: snapshot.timestamp,
            checksum: snapshot.metadata.checksum,
            target: target || 'ALL',
            state: snapshot.state,
          });
          bc.close();
        } catch {}
      }
    }

    this.currentStateInMemory = structuredClone(snapshot.state);
    return Result.ok(snapshot.state);
  }

  public async forkTimeline(
    parentSnapshotId: string,
    newBranchName: string
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    const existing = await this.repository.getBranch(newBranchName);
    if (existing.ok && existing.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'BRANCH_ALREADY_EXISTS',
          `Branch "${newBranchName}" already exists`,
          undefined,
          newBranchName
        )
      );
    }

    const snapRes = await this.repository.getSnapshot(parentSnapshotId);
    if (!snapRes.ok) return Result.err(snapRes.error);
    if (!snapRes.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'SNAPSHOT_NOT_FOUND',
          `Parent snapshot "${parentSnapshotId}" not found`,
          parentSnapshotId
        )
      );
    }

    const branch: TimelineBranch = {
      name: newBranchName,
      createdAt: Date.now(),
      forkSnapshotId: parentSnapshotId,
      parentBranchName: this.activeBranchName,
      headSnapshotId: parentSnapshotId,
      snapshotIds: [parentSnapshotId],
      isCurrent: false,
      timelineId: newBranchName,
      updatedAt: Date.now(),
    };

    const saveRes = await this.repository.saveBranch(branch);
    if (!saveRes.ok) return Result.err(saveRes.error);

    return Result.ok(branch);
  }

  public async createTimelineBranch(
    parentTimelineId: string,
    forkTimestamp: number,
    branchName: string
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    const existing = await this.repository.getBranch(branchName);
    if (existing.ok && existing.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'BRANCH_ALREADY_EXISTS',
          `Branch "${branchName}" already exists`,
          undefined,
          branchName
        )
      );
    }

    const seekRes = await this.seekToPointInTime('ALL', forkTimestamp);
    const headId = seekRes.ok ? seekRes.value.id : `snap_${forkTimestamp}`;

    const branch: TimelineBranch = {
      name: branchName,
      createdAt: Date.now(),
      forkSnapshotId: headId,
      parentBranchName: parentTimelineId,
      headSnapshotId: headId,
      snapshotIds: [headId],
      isCurrent: false,
      timelineId: branchName,
      updatedAt: Date.now(),
    };

    const saveRes = await this.repository.saveBranch(branch);
    if (!saveRes.ok) return Result.err(saveRes.error);

    return Result.ok(branch);
  }

  public async switchBranch(branchName: string): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    const branchRes = await this.repository.getBranch(branchName);
    if (!branchRes.ok) return Result.err(branchRes.error);
    if (!branchRes.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'BRANCH_NOT_FOUND',
          `Branch "${branchName}" not found`,
          undefined,
          branchName
        )
      );
    }

    this.activeBranchName = branchName;
    return Result.ok(branchRes.value);
  }

  public async getActiveBranch(): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    const branchRes = await this.repository.getBranch(this.activeBranchName);
    if (!branchRes.ok) return Result.err(branchRes.error);
    if (!branchRes.value) {
      const defaultBranch: TimelineBranch = {
        name: this.activeBranchName,
        createdAt: Date.now(),
        forkSnapshotId: null,
        parentBranchName: null,
        headSnapshotId: '',
        snapshotIds: [],
        isCurrent: true,
        timelineId: this.activeBranchName,
        updatedAt: Date.now(),
      };
      await this.repository.saveBranch(defaultBranch);
      return Result.ok(defaultBranch);
    }
    return Result.ok(branchRes.value);
  }

  public async listBranches(): Promise<Result<TimelineBranch[], TimeSeriesSnapshotError>> {
    return this.repository.getAllBranches();
  }

  public async mergeBranch(
    sourceBranchName: string,
    targetBranchName: string,
    options?: MergeBranchOptions
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    const srcRes = await this.repository.getBranch(sourceBranchName);
    if (!srcRes.ok || !srcRes.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'BRANCH_NOT_FOUND',
          `Source branch "${sourceBranchName}" not found`,
          undefined,
          sourceBranchName
        )
      );
    }

    const tgtRes = await this.repository.getBranch(targetBranchName);
    if (!tgtRes.ok || !tgtRes.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'BRANCH_NOT_FOUND',
          `Target branch "${targetBranchName}" not found`,
          undefined,
          targetBranchName
        )
      );
    }

    const srcBranch = srcRes.value;
    const tgtBranch = tgtRes.value;

    const mergedDeltas = [...(tgtBranch.deltas || []), ...(srcBranch.deltas || [])];
    if (options?.conflictStrategy === 'LWW' || !options?.conflictStrategy) {
      mergedDeltas.sort((a, b) => a.timestamp - b.timestamp);
    }

    const updatedTgtBranch: TimelineBranch = {
      ...tgtBranch,
      deltas: mergedDeltas,
      snapshotIds: Array.from(new Set([...tgtBranch.snapshotIds, ...srcBranch.snapshotIds])),
      updatedAt: Date.now(),
    };

    await this.repository.saveBranch(updatedTgtBranch);
    return Result.ok(updatedTgtBranch);
  }

  public async replayTimeline(
    fromSnapshotId: string,
    toSnapshotId: string,
    speedMultiplier?: number,
    onStep?: ReplayStepCallback
  ): Promise<Result<StorageSnapshot[], TimeSeriesSnapshotError>> {
    try {
      const snapA = await this.repository.getSnapshot(fromSnapshotId);
      const snapB = await this.repository.getSnapshot(toSnapshotId);

      const tA = snapA.ok && snapA.value ? snapA.value.timestamp : 0;
      const tB = snapB.ok && snapB.value ? snapB.value.timestamp : Date.now();

      const deltasRes = await this.repository.getDeltasInTimeRange(tA, tB);
      if (!deltasRes.ok) return Result.err(deltasRes.error);

      const deltas = deltasRes.value.sort((a, b) => a.timestamp - b.timestamp);
      let currentState = snapA.ok && snapA.value ? structuredClone(snapA.value.state) : {};

      const snapshots: StorageSnapshot[] = [];
      const totalSteps = deltas.length;

      for (let i = 0; i < deltas.length; i++) {
        const delta = deltas[i];
        const patches = delta.forwardPatches || delta.patches || [];
        if (patches.length > 0) {
          const appRes = RealtimeDiffEngine.applyPatch(currentState, patches);
          if (appRes.ok) {
            currentState = appRes.value;
          }
        }

        const stepSnap: StorageSnapshot = {
          id: `replay_${delta.timestamp}_${i}`,
          snapshotId: `replay_${delta.timestamp}_${i}`,
          timestamp: delta.timestamp,
          target: delta.target || 'localStorage',
          state: structuredClone(currentState),
          metadata: {
            id: `replay_${delta.timestamp}_${i}`,
            timestamp: delta.timestamp,
            sequenceNumber: i + 1,
            tag: 'manual',
            description: 'replay step',
            author: 'system',
            target: delta.target || 'localStorage',
            totalKeys: Object.keys(currentState).length,
            sizeBytes: calculateSizeBytes(currentState),
            checksum: computeChecksum(currentState),
          },
          isCheckpoint: false,
          parentSnapshotId: fromSnapshotId,
          branchName: this.activeBranchName,
        };

        snapshots.push(stepSnap);
        if (onStep) {
          onStep(stepSnap, i, totalSteps);
        }
      }

      return Result.ok(snapshots);
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'STORAGE_ADAPTER_ERROR',
          `Failed to replay timeline: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  public async startReplaySession(
    startTimestamp: number,
    endTimestamp: number,
    playbackSpeed?: number
  ): Promise<Result<ReplaySession, TimeSeriesSnapshotError>> {
    try {
      const deltasRes = await this.repository.getDeltasInTimeRange(startTimestamp, endTimestamp);
      if (!deltasRes.ok) return Result.err(deltasRes.error);

      const deltas = deltasRes.value.sort((a, b) => a.timestamp - b.timestamp);
      const seekRes = await this.seekToPointInTime('ALL', startTimestamp);
      const initialState = seekRes.ok ? seekRes.value.state : {};

      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const session: ReplaySession = {
        sessionId,
        timelineId: this.activeBranchName,
        startTimestamp,
        endTimestamp,
        currentTimestamp: startTimestamp,
        currentStepIndex: 0,
        totalSteps: deltas.length,
        isPlaying: false,
        playbackSpeed: playbackSpeed || 1.0,
        state: structuredClone(initialState),
      };

      this.activeReplaySessions.set(sessionId, session);
      return Result.ok(session);
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'REPLAY_IN_PROGRESS',
          `Failed to start replay session: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  public async stepReplay(
    sessionId: string,
    direction: 'forward' | 'backward'
  ): Promise<Result<ReplayStep, TimeSeriesSnapshotError>> {
    const session = this.activeReplaySessions.get(sessionId);
    if (!session) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'SNAPSHOT_NOT_FOUND',
          `Replay session "${sessionId}" not found`
        )
      );
    }

    const deltasRes = await this.repository.getDeltasInTimeRange(session.startTimestamp, session.endTimestamp);
    if (!deltasRes.ok) return Result.err(deltasRes.error);

    const deltas = deltasRes.value.sort((a, b) => a.timestamp - b.timestamp);

    if (direction === 'forward') {
      if (session.currentStepIndex < deltas.length) {
        const delta = deltas[session.currentStepIndex];
        const patches = delta.forwardPatches || delta.patches || [];
        if (patches.length > 0) {
          const applyRes = RealtimeDiffEngine.applyPatch(session.state, patches);
          if (applyRes.ok) {
            session.state = applyRes.value;
          }
        }
        session.currentStepIndex++;
        session.currentTimestamp = delta.timestamp;

        const step: ReplayStep = {
          stepIndex: session.currentStepIndex,
          timestamp: session.currentTimestamp,
          delta,
          state: structuredClone(session.state),
          direction,
        };
        return Result.ok(step);
      }
    } else {
      if (session.currentStepIndex > 0) {
        session.currentStepIndex--;
        const delta = deltas[session.currentStepIndex];
        const invPatches = delta.reversePatches || delta.inversePatches || [];
        if (invPatches.length > 0) {
          const applyRes = RealtimeDiffEngine.applyPatch(session.state, invPatches);
          if (applyRes.ok) {
            session.state = applyRes.value;
          }
        }
        session.currentTimestamp = delta.timestamp;

        const step: ReplayStep = {
          stepIndex: session.currentStepIndex,
          timestamp: session.currentTimestamp,
          delta,
          state: structuredClone(session.state),
          direction,
        };
        return Result.ok(step);
      }
    }

    const step: ReplayStep = {
      stepIndex: session.currentStepIndex,
      timestamp: session.currentTimestamp,
      state: structuredClone(session.state),
      direction,
    };
    return Result.ok(step);
  }

  public async seekReplay(
    sessionId: string,
    timestamp: number
  ): Promise<Result<ReplayStep, TimeSeriesSnapshotError>> {
    const session = this.activeReplaySessions.get(sessionId);
    if (!session) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'SNAPSHOT_NOT_FOUND',
          `Replay session "${sessionId}" not found`
        )
      );
    }

    const seekRes = await this.seekToPointInTime('ALL', timestamp);
    if (!seekRes.ok) return Result.err(seekRes.error);

    session.state = structuredClone(seekRes.value.state);
    session.currentTimestamp = timestamp;

    const deltasRes = await this.repository.getDeltasInTimeRange(session.startTimestamp, timestamp);
    if (deltasRes.ok) {
      session.currentStepIndex = deltasRes.value.length;
    }

    const step: ReplayStep = {
      stepIndex: session.currentStepIndex,
      timestamp,
      snapshot: seekRes.value,
      state: structuredClone(session.state),
      direction: 'forward',
    };
    return Result.ok(step);
  }

  public async compareSnapshots(
    snapshotIdA: string,
    snapshotIdB: string
  ): Promise<Result<TimeTravelDiff, TimeSeriesSnapshotError>> {
    const snapA = await this.repository.getSnapshot(snapshotIdA);
    const snapB = await this.repository.getSnapshot(snapshotIdB);

    if (!snapA.ok || !snapA.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'SNAPSHOT_NOT_FOUND',
          `Snapshot "${snapshotIdA}" not found`,
          snapshotIdA
        )
      );
    }
    if (!snapB.ok || !snapB.value) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'SNAPSHOT_NOT_FOUND',
          `Snapshot "${snapshotIdB}" not found`,
          snapshotIdB
        )
      );
    }

    const stateA = snapA.value.state;
    const stateB = snapB.value.state;

    const diffRes = RealtimeDiffEngine.createDiff(stateA, stateB);
    if (!diffRes.ok) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'DELTA_RECONSTRUCTION_FAILED',
          `Failed to compare snapshots: ${diffRes.error.message}`
        )
      );
    }

    const diff = diffRes.value;
    const keysAdded: string[] = [];
    const keysModified: string[] = [];
    const keysRemoved: string[] = [];
    const keysUnchanged: string[] = [];
    const valueDiffs: Record<string, { oldValue: unknown; newValue: unknown }> = {};

    for (const d of diff.deltas) {
      if (d.changeType === 'created') keysAdded.push(d.key);
      else if (d.changeType === 'modified') keysModified.push(d.key);
      else if (d.changeType === 'deleted') keysRemoved.push(d.key);
      else keysUnchanged.push(d.key);

      valueDiffs[d.key] = { oldValue: d.oldValue, newValue: d.newValue };
    }

    const result: TimeTravelDiff = {
      fromSnapshotId: snapshotIdA,
      toSnapshotId: snapshotIdB,
      fromTimestamp: snapA.value.timestamp,
      toTimestamp: snapB.value.timestamp,
      keysAdded,
      keysModified,
      keysRemoved,
      keysUnchanged,
      patches: diff.globalPatches,
      reversePatches: diff.globalInversePatches,
      valueDiffs,
    };

    return Result.ok(result);
  }

  public async diffTimestamps(
    timestampA: number,
    timestampB: number
  ): Promise<Result<JSONPatchOperation[], TimeSeriesSnapshotError>> {
    const snapA = await this.seekToPointInTime('ALL', timestampA);
    const snapB = await this.seekToPointInTime('ALL', timestampB);

    if (!snapA.ok) return Result.err(snapA.error);
    if (!snapB.ok) return Result.err(snapB.error);

    const diffRes = RealtimeDiffEngine.createDiff(snapA.value.state, snapB.value.state);
    if (!diffRes.ok) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'DELTA_RECONSTRUCTION_FAILED',
          `Failed to diff timestamps: ${diffRes.error.message}`
        )
      );
    }

    return Result.ok(diffRes.value.globalPatches);
  }

  public async pruneTimeline(policy: AutoPrunePolicy): Promise<Result<PruneResult, TimeSeriesSnapshotError>> {
    try {
      const snapshotsRes = await this.repository.getSnapshotsByTarget('localStorage');
      const deltasRes = await this.repository.getDeltasInTimeRange(0, Date.now() + 10000);

      let snapshots = snapshotsRes.ok ? snapshotsRes.value : [];
      let deltas = deltasRes.ok ? deltasRes.value : [];

      const totalSizeBytes = deltas.reduce((sum, d) => sum + (d.sizeInBytes || 100), 0);
      if (policy.autoPruneOnMemoryExceeded === false && policy.maxSizeBytes && totalSizeBytes > policy.maxSizeBytes) {
        return Result.err(
          new TimeSeriesSnapshotErrorClass(
            'MEMORY_LIMIT_EXCEEDED',
            `Timeline memory limit exceeded: ${totalSizeBytes} > ${policy.maxSizeBytes}`
          )
        );
      }

      const snapshotIdsToDelete: string[] = [];
      const deltaIdsToDelete: string[] = [];
      let freedBytes = 0;

      // maxDeltas policy
      if (policy.maxDeltas && policy.maxDeltas > 0 && deltas.length > policy.maxDeltas) {
        const overflow = deltas.length - policy.maxDeltas;
        const toDelete = deltas.slice(0, overflow);
        for (const d of toDelete) {
          deltaIdsToDelete.push(d.id);
          freedBytes += d.sizeInBytes || 100;
        }
      }

      // maxSnapshots policy
      if (policy.maxSnapshots && policy.maxSnapshots > 0 && snapshots.length > policy.maxSnapshots) {
        const overflow = snapshots.length - policy.maxSnapshots;
        const candidates = snapshots.slice(0, overflow);
        for (const s of candidates) {
          if (policy.preserveCheckpoints && s.isCheckpoint) continue;
          snapshotIdsToDelete.push(s.id);
          freedBytes += s.metadata.sizeBytes || 500;
        }
      }

      // maxAgeMs policy
      if (policy.maxAgeMs && policy.maxAgeMs > 0) {
        const cutoff = Date.now() - policy.maxAgeMs;
        for (const s of snapshots) {
          if (s.timestamp < cutoff) {
            if (policy.preserveCheckpoints && s.isCheckpoint) continue;
            snapshotIdsToDelete.push(s.id);
            freedBytes += s.metadata.sizeBytes || 500;
          }
        }
        for (const d of deltas) {
          if (d.timestamp < cutoff) {
            deltaIdsToDelete.push(d.id);
            freedBytes += d.sizeInBytes || 100;
          }
        }
      }

      // maxSizeBytes policy
      if (policy.maxSizeBytes && policy.maxSizeBytes > 0) {
        let currentTotal = totalSizeBytes;
        if (currentTotal > policy.maxSizeBytes) {
          for (const d of deltas) {
            if (currentTotal <= policy.maxSizeBytes) break;
            deltaIdsToDelete.push(d.id);
            const size = d.sizeInBytes || 100;
            currentTotal -= size;
            freedBytes += size;
          }
          for (const s of snapshots) {
            if (currentTotal <= policy.maxSizeBytes) break;
            if (policy.preserveCheckpoints && s.isCheckpoint) continue;
            snapshotIdsToDelete.push(s.id);
            const size = s.metadata.sizeBytes || 500;
            currentTotal -= size;
            freedBytes += size;
          }
        }
      }

      let prunedCount = 0;
      if (snapshotIdsToDelete.length > 0) {
        const delRes = await this.repository.deleteSnapshots(snapshotIdsToDelete);
        if (delRes.ok) prunedCount += delRes.value;
      }
      if (deltaIdsToDelete.length > 0) {
        const delRes = await this.repository.deleteDeltas(deltaIdsToDelete);
        if (delRes.ok) prunedCount += delRes.value;
      }

      const remainingRes = await this.repository.getSnapshotsByTarget('localStorage');
      const remainingSnapshots = remainingRes.ok ? remainingRes.value.length : 0;

      return Result.ok({ prunedCount, freedBytes, remainingSnapshots });
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'PRUNING_FAILED',
          `Failed to prune timeline: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  public async exportTimeline(): Promise<Result<string, TimeSeriesSnapshotError>> {
    try {
      const branchesRes = await this.repository.getAllBranches();
      const snapshotsRes = await this.repository.getSnapshotsByTarget('localStorage');
      const deltasRes = await this.repository.getDeltasInTimeRange(0, Date.now());

      const data = {
        branches: branchesRes.ok ? branchesRes.value : [],
        snapshots: snapshotsRes.ok ? snapshotsRes.value : [],
        deltas: deltasRes.ok ? deltasRes.value : [],
        activeBranchName: this.activeBranchName,
      };

      return Result.ok(JSON.stringify(data));
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'STORAGE_ADAPTER_ERROR',
          `Failed to export timeline: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  public async importTimeline(jsonString: string): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>> {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.branches) {
        for (const b of parsed.branches) {
          await this.repository.saveBranch(b);
        }
      }
      if (parsed.snapshots) {
        for (const s of parsed.snapshots) {
          await this.repository.saveSnapshot(s);
        }
      }
      if (parsed.deltas) {
        for (const d of parsed.deltas) {
          await this.repository.saveDelta(d);
        }
      }

      if (parsed.activeBranchName) {
        this.activeBranchName = parsed.activeBranchName;
      }

      const activeBranchRes = await this.getActiveBranch();
      return activeBranchRes;
    } catch (err) {
      return Result.err(
        new TimeSeriesSnapshotErrorClass(
          'TIMELINE_CORRUPTED',
          `Failed to import timeline: invalid JSON payload - ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }
}
