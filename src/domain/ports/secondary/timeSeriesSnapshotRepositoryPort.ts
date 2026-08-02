import { Result } from '../../../../utils/result';
import type { StorageTarget } from '../../model/valueObjects';
import type {
  StorageSnapshot,
  StateDelta,
  TimelineBranch,
  TimeSeriesSnapshotError,
} from '../../model/timeSeriesSnapshot';

export interface TimeSeriesSnapshotRepositoryPort {
  saveSnapshot(snapshot: StorageSnapshot): Promise<Result<void, TimeSeriesSnapshotError>>;
  saveBaseSnapshot(snapshotId: string, snapshot: StorageSnapshot): Promise<Result<void, TimeSeriesSnapshotError>>;
  getSnapshot(snapshotId: string): Promise<Result<StorageSnapshot | null, TimeSeriesSnapshotError>>;
  loadBaseSnapshot(snapshotId: string): Promise<Result<StorageSnapshot | null, TimeSeriesSnapshotError>>;
  getSnapshotsByTarget(target: StorageTarget, limit?: number): Promise<Result<StorageSnapshot[], TimeSeriesSnapshotError>>;
  saveDelta(delta: StateDelta): Promise<Result<void, TimeSeriesSnapshotError>>;
  getDelta(deltaId: string): Promise<Result<StateDelta | null, TimeSeriesSnapshotError>>;
  getDeltasBetween(fromSnapshotId: string, toSnapshotId: string): Promise<Result<StateDelta[], TimeSeriesSnapshotError>>;
  getDeltasInTimeRange(startTime: number, endTime: number): Promise<Result<StateDelta[], TimeSeriesSnapshotError>>;
  saveBranch(branch: TimelineBranch): Promise<Result<void, TimeSeriesSnapshotError>>;
  getBranch(branchName: string): Promise<Result<TimelineBranch | null, TimeSeriesSnapshotError>>;
  getAllBranches(): Promise<Result<TimelineBranch[], TimeSeriesSnapshotError>>;
  deleteSnapshots(snapshotIds: string[]): Promise<Result<number, TimeSeriesSnapshotError>>;
  deleteDeltas(deltaIds: string[]): Promise<Result<number, TimeSeriesSnapshotError>>;
  deleteTimeline(timelineId: string): Promise<Result<void, TimeSeriesSnapshotError>>;
  clearRepository(): Promise<Result<void, TimeSeriesSnapshotError>>;
}
