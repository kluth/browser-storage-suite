import { Result } from '../../../../utils/result';
import type { StorageTarget } from '../../model/valueObjects';
import type { JSONPatchOperation } from '../../model/storageDiff';
import type {
  StorageSnapshot,
  StateDelta,
  TimelineBranch,
  TimeTravelDiff,
  AutoPrunePolicy,
  PruneResult,
  SnapshotMetadata,
  ReplayStep,
  ReplaySession,
  TimeSeriesSnapshotError,
} from '../../model/timeSeriesSnapshot';

export type ReplayStepCallback = (snapshot: StorageSnapshot, stepIndex: number, totalSteps: number) => void;

export interface SnapshotTakeOptions {
  triggerReason?: string;
  metadata?: Record<string, unknown>;
  customMetadata?: Partial<SnapshotMetadata>;
  isCheckpoint?: boolean;
}

export interface DeltaRecordOptions {
  compressed?: boolean;
  key?: string;
  op?: string;
  timelineId?: string;
}

export interface RestoreOptions {
  hydrateLiveStorage?: boolean;
}

export interface MergeBranchOptions {
  conflictStrategy?: 'LWW' | 'manual';
}

export interface TimeSeriesSnapshotPort {
  takeSnapshot(
    target: StorageTarget | 'ALL',
    labelOrOptions?: string | SnapshotTakeOptions,
    isCheckpoint?: boolean,
    customMetadata?: Partial<SnapshotMetadata>
  ): Promise<Result<StorageSnapshot, TimeSeriesSnapshotError>>;

  recordChangeDelta(
    target: StorageTarget,
    previousState: Record<string, unknown>,
    currentState: Record<string, unknown>,
    options?: DeltaRecordOptions
  ): Promise<Result<StateDelta, TimeSeriesSnapshotError>>;

  recordDelta(
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
  ): Promise<Result<StateDelta, TimeSeriesSnapshotError>>;

  seekToPointInTime(
    target: StorageTarget | 'ALL',
    timestampOrId: number | string
  ): Promise<Result<StorageSnapshot, TimeSeriesSnapshotError>>;

  restoreStateAt(
    timestamp: number,
    target?: StorageTarget | 'ALL',
    options?: RestoreOptions
  ): Promise<Result<Record<string, unknown>, TimeSeriesSnapshotError>>;

  forkTimeline(
    parentSnapshotId: string,
    newBranchName: string
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;

  createTimelineBranch(
    parentTimelineId: string,
    forkTimestamp: number,
    branchName: string
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;

  switchBranch(branchName: string): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;

  getActiveBranch(): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;

  listBranches(): Promise<Result<TimelineBranch[], TimeSeriesSnapshotError>>;

  mergeBranch(
    sourceBranchName: string,
    targetBranchName: string,
    options?: MergeBranchOptions
  ): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;

  replayTimeline(
    fromSnapshotId: string,
    toSnapshotId: string,
    speedMultiplier?: number,
    onStep?: ReplayStepCallback
  ): Promise<Result<StorageSnapshot[], TimeSeriesSnapshotError>>;

  startReplaySession(
    startTimestamp: number,
    endTimestamp: number,
    playbackSpeed?: number
  ): Promise<Result<ReplaySession, TimeSeriesSnapshotError>>;

  stepReplay(
    sessionId: string,
    direction: 'forward' | 'backward'
  ): Promise<Result<ReplayStep, TimeSeriesSnapshotError>>;

  seekReplay(
    sessionId: string,
    timestamp: number
  ): Promise<Result<ReplayStep, TimeSeriesSnapshotError>>;

  compareSnapshots(
    snapshotIdA: string,
    snapshotIdB: string
  ): Promise<Result<TimeTravelDiff, TimeSeriesSnapshotError>>;

  diffTimestamps(
    timestampA: number,
    timestampB: number
  ): Promise<Result<JSONPatchOperation[], TimeSeriesSnapshotError>>;

  pruneTimeline(policy: AutoPrunePolicy): Promise<Result<PruneResult, TimeSeriesSnapshotError>>;

  exportTimeline(): Promise<Result<string, TimeSeriesSnapshotError>>;

  importTimeline(jsonString: string): Promise<Result<TimelineBranch, TimeSeriesSnapshotError>>;
}
