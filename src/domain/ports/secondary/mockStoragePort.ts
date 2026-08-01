import { Result } from '../../../../utils/result';

export type MockStorageArea =
  | 'local'
  | 'sync'
  | 'session'
  | 'managed'
  | 'localStorage'
  | 'sessionStorage'
  | 'indexedDB';

export interface StorageQuotaConfig {
  maxBytes: number;
  maxItemBytes?: number;
  maxItems?: number;
  isReadOnly?: boolean;
}

export interface StorageChange<T = unknown> {
  oldValue?: T;
  newValue?: T;
}

export type StorageChangeMap = Record<string, StorageChange>;

export type StorageChangeListener = (
  changes: StorageChangeMap,
  areaName: MockStorageArea
) => void;

export type StorageHarnessErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'READ_ONLY_AREA'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'SERIALIZATION_FAILED'
  | 'DESERIALIZATION_FAILED'
  | 'KEY_NOT_FOUND'
  | 'INVALID_KEY'
  | 'SIMULATED_FAULT';

export class StorageHarnessError extends Error {
  constructor(
    public readonly code: StorageHarnessErrorCode,
    message: string,
    public readonly area?: MockStorageArea,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageHarnessError';
  }
}

export interface ContractTestFailure {
  testName: string;
  error: string;
}

export interface ContractTestResult {
  passed: number;
  failed: number;
  failures: ContractTestFailure[];
}

export interface MockStoragePort {
  // Quota & Configuration
  setQuotaConfig(area: MockStorageArea, config: Partial<StorageQuotaConfig>): void;
  getQuotaConfig(area: MockStorageArea): StorageQuotaConfig;

  // Storage Operations
  getItem<T = unknown>(area: MockStorageArea, key: string): Promise<Result<T | null, StorageHarnessError>>;
  getItems<T = Record<string, unknown>>(area: MockStorageArea, keys?: string | string[] | null): Promise<Result<T, StorageHarnessError>>;
  setItem<T = unknown>(area: MockStorageArea, key: string, value: T): Promise<Result<void, StorageHarnessError>>;
  setItems(area: MockStorageArea, items: Record<string, unknown>): Promise<Result<void, StorageHarnessError>>;
  removeItem(area: MockStorageArea, key: string): Promise<Result<void, StorageHarnessError>>;
  removeItems(area: MockStorageArea, keys: string[]): Promise<Result<void, StorageHarnessError>>;
  clear(area: MockStorageArea): Promise<Result<void, StorageHarnessError>>;
  getBytesInUse(area: MockStorageArea, keys?: string | string[] | null): Promise<Result<number, StorageHarnessError>>;

  // State & Snapshot Management
  seed(area: MockStorageArea, items: Record<string, unknown>): void;
  snapshot(): Record<MockStorageArea, Record<string, unknown>>;
  restoreSnapshot(state: Partial<Record<MockStorageArea, Record<string, unknown>>>): void;
  reset(): void;

  // Fault Injection
  injectReadFault(area?: MockStorageArea, keyPattern?: string): void;
  injectWriteFault(area?: MockStorageArea, keyPattern?: string): void;
  injectQuotaFault(area?: MockStorageArea): void;
  injectLatency(delayMs: number): void;
  clearFaults(): void;

  // Listener Events
  onChanged(listener: StorageChangeListener): () => void;

  // Contract Verification Helper
  runContractTests(targetPort: MockStoragePort): Promise<Result<ContractTestResult, StorageHarnessError>>;
}
