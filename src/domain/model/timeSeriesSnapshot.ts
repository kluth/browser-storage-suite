import { Result } from '../../../utils/result';
import type { StorageTarget } from './valueObjects';
import type { JSONPatchOperation } from './storageDiff';

export type SnapshotTag = 'checkpoint' | 'auto-save' | 'user-action' | 'pre-migration' | 'debug-fork' | 'manual';

export interface SnapshotHeader {
  snapshotId: string;
  timelineId?: string;
  timestamp: number;
  sequenceNumber?: number;
  target: StorageTarget | 'ALL';
  tag?: SnapshotTag;
  description?: string;
  author?: string;
  totalKeys?: number;
  entryCount?: number;
  sizeBytes?: number;
  totalSizeBytes?: number;
  checksum: string;
  compressionAlgorithm?: string;
  triggerReason?: string;
  version?: string;
  metadata?: Record<string, unknown>;
  customTags?: Record<string, string>;
}

export interface SnapshotMetadata {
  readonly id: string;
  readonly timestamp: number;
  readonly sequenceNumber: number;
  readonly tag: SnapshotTag;
  readonly description: string;
  readonly author: string;
  readonly target: StorageTarget | 'ALL';
  readonly totalKeys?: number;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly customTags?: Record<string, string>;
}

export interface StorageSnapshot {
  readonly id: string;
  readonly snapshotId?: string;
  readonly timestamp: number;
  readonly sequenceNumber?: number;
  readonly target: StorageTarget | 'ALL';
  readonly state: Record<string, unknown>;
  readonly metadata: SnapshotMetadata;
  readonly header?: SnapshotHeader;
  readonly isCheckpoint: boolean;
  readonly parentSnapshotId: string | null;
  readonly branchName: string;
  readonly timelineId?: string;
}

export interface StateDelta {
  readonly id: string;
  readonly deltaId?: string;
  readonly timelineId?: string;
  readonly fromSnapshotId: string;
  readonly toSnapshotId: string;
  readonly timestamp: number;
  readonly target?: StorageTarget;
  readonly key?: string;
  readonly op?: string;
  readonly forwardPatches: JSONPatchOperation[];
  readonly reversePatches: JSONPatchOperation[];
  readonly patches?: JSONPatchOperation[];
  readonly inversePatches?: JSONPatchOperation[];
  readonly affectedKeys: string[];
  readonly changeSummary: {
    readonly added: number;
    readonly modified: number;
    readonly removed: number;
  };
  readonly checksum?: string;
  readonly sizeInBytes?: number;
  readonly compressed?: boolean;
  readonly compressedPayload?: string;
}

export type AutoPruneStrategy = 'lru' | 'max-count' | 'max-age' | 'max-size';

export interface AutoPrunePolicy {
  readonly strategy: AutoPruneStrategy;
  readonly maxSnapshots?: number;
  readonly maxAgeMs?: number;
  readonly maxSizeBytes?: number;
  readonly maxDeltas?: number;
  readonly autoPruneOnMemoryExceeded?: boolean;
  readonly preserveCheckpoints?: boolean;
  readonly keepTagged?: SnapshotTag[];
}

export interface TimelineRetentionPolicy extends AutoPrunePolicy {}

export interface TimelineBranch {
  readonly name: string;
  readonly createdAt: number;
  readonly forkSnapshotId: string | null;
  readonly parentBranchName: string | null;
  readonly headSnapshotId: string;
  readonly snapshotIds: string[];
  readonly isCurrent: boolean;
  readonly timelineId?: string;
  readonly updatedAt?: number;
  readonly baseSnapshots?: StorageSnapshot[];
  readonly deltas?: StateDelta[];
  readonly totalSizeBytes?: number;
  readonly retentionPolicy?: TimelineRetentionPolicy;
}

export interface SnapshotTimeline extends TimelineBranch {}

export interface ReplayStep {
  readonly stepIndex: number;
  readonly timestamp: number;
  readonly delta?: StateDelta;
  readonly snapshotHeader?: SnapshotHeader;
  readonly snapshot?: StorageSnapshot;
  readonly state: Record<string, unknown>;
  readonly direction: 'forward' | 'backward';
}

export interface ReplaySession {
  readonly sessionId: string;
  readonly timelineId: string;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  currentTimestamp: number;
  currentStepIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  playbackSpeed: number;
  state: Record<string, unknown>;
}

export interface TimeTravelDiff {
  readonly fromSnapshotId: string;
  readonly toSnapshotId: string;
  readonly fromTimestamp: number;
  readonly toTimestamp: number;
  readonly keysAdded: string[];
  readonly keysModified: string[];
  readonly keysRemoved: string[];
  readonly keysUnchanged: string[];
  readonly patches: JSONPatchOperation[];
  readonly reversePatches: JSONPatchOperation[];
  readonly valueDiffs: Record<string, { oldValue: unknown; newValue: unknown }>;
}

export interface PruneResult {
  readonly prunedCount: number;
  readonly freedBytes: number;
  readonly remainingSnapshots: number;
}

export type TimeSeriesSnapshotErrorKind =
  | 'SNAPSHOT_NOT_FOUND'
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_ALREADY_EXISTS'
  | 'INVALID_TIMELINE_HEAD'
  | 'DELTA_RECONSTRUCTION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'STORAGE_ADAPTER_ERROR'
  | 'PRUNING_FAILED'
  | 'REPLAY_IN_PROGRESS'
  | 'INVALID_SNAPSHOT_STATE'
  | 'INVALID_SNAPSHOT_TIMESTAMP'
  | 'TIMELINE_CORRUPTED'
  | 'DELTA_APPLY_FAILED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'STORAGE_RESTORE_FAILED'
  | 'COMPRESSION_ERROR';

export class TimeSeriesSnapshotError extends Error {
  public readonly kind: TimeSeriesSnapshotErrorKind;
  public readonly snapshotId?: string;
  public readonly branchName?: string;
  public readonly deltaId?: string;
  public readonly cause?: unknown;

  constructor(
    kind: TimeSeriesSnapshotErrorKind,
    message: string,
    snapshotId?: string,
    branchName?: string,
    cause?: unknown,
    deltaId?: string
  ) {
    super(message);
    this.name = 'TimeSeriesSnapshotError';
    this.kind = kind;
    this.snapshotId = snapshotId;
    this.branchName = branchName;
    this.cause = cause;
    this.deltaId = deltaId;
    Object.setPrototypeOf(this, TimeSeriesSnapshotError.prototype);
  }

  public get code(): TimeSeriesSnapshotErrorKind {
    return this.kind;
  }
}
