import { Result } from '../../../utils/result';
import { StorageKey, StorageValue, StorageTarget } from '../../model/valueObjects';

export interface StorageEntryDto {
  key: string;
  value: string;
  target: StorageTarget;
}

export interface StorageRepositoryPort {
  fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>>;
  saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>>;
  deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>>;
  clear(target: StorageTarget): Promise<Result<void, string>>;
}
