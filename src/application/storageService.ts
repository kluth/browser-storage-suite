import { Result } from '../../utils/result';
import { StorageUseCasesPort } from '../domain/ports/primary/storageUseCases';
import { StorageRepositoryPort, StorageEntryDto } from '../domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../domain/model/valueObjects';

export class StorageApplicationService implements StorageUseCasesPort {
  constructor(private readonly repositoryAdapter: StorageRepositoryPort) {}

  public async loadStorageView(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    return this.repositoryAdapter.fetchEntries(target);
  }

  public async setStorageItem(target: StorageTarget, rawKey: string, rawValue: string): Promise<Result<void, string>> {
    const keyRes = StorageKey.create(rawKey);
    if (!keyRes.ok) return Result.err(keyRes.error);

    const valRes = StorageValue.create(rawValue);
    return this.repositoryAdapter.saveEntry(target, keyRes.value, valRes.value);
  }

  public async removeStorageItem(target: StorageTarget, rawKey: string): Promise<Result<void, string>> {
    const keyRes = StorageKey.create(rawKey);
    if (!keyRes.ok) return Result.err(keyRes.error);

    return this.repositoryAdapter.deleteEntry(target, keyRes.value);
  }
}
