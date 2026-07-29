import { Result } from '../../../utils/result';
import { StorageTarget } from '../../model/valueObjects';
import { StorageEntryDto } from '../secondary/storageRepositoryPort';

export interface StorageUseCasesPort {
  loadStorageView(target: StorageTarget): Promise<Result<StorageEntryDto[], string>>;
  setStorageItem(target: StorageTarget, key: string, value: string): Promise<Result<void, string>>;
  removeStorageItem(target: StorageTarget, key: string): Promise<Result<void, string>>;
}
