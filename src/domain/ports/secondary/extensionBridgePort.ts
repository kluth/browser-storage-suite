import { Result } from '../../../../utils/result';

export type ExtensionStorageArea = 'local' | 'sync' | 'managed' | 'session';
export type BrowserVendor = 'chrome' | 'firefox' | 'edge' | 'safari' | 'unknown';
export type ManifestVersion = 'mv2' | 'mv3' | 'web';

export interface BrowserContextInfo {
  vendor: BrowserVendor;
  manifestVersion: ManifestVersion;
  isExtensionContext: boolean;
  supportedStorageAreas: ExtensionStorageArea[];
  hasSessionStorage: boolean;
}

export interface BridgeMessagePayload<T = unknown> {
  type: string;
  targetTabId?: number;
  payload: T;
  timestamp: number;
  correlationId: string;
}

export type StorageChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: ExtensionStorageArea
) => void;

export type ExtensionBridgeErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'UNSUPPORTED_AREA'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'DELETE_FAILED'
  | 'CLEAR_FAILED'
  | 'MESSAGE_SEND_FAILED'
  | 'TAB_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'DESERIALIZATION_FAILED'
  | 'PORT_DISCONNECTED'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'UNSUPPORTED_API'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'INVALID_MESSAGE_FORMAT'
  | 'HANDLER_ERROR';

export class ExtensionBridgeError extends Error {
  constructor(
    public readonly code: ExtensionBridgeErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ExtensionBridgeError';
  }
}

export interface ExtensionBridgePort {
  getBrowserContext(): BrowserContextInfo;

  getItem<T = unknown>(
    key: string,
    area?: ExtensionStorageArea
  ): Promise<Result<T | null, ExtensionBridgeError>>;

  getItems<T = Record<string, unknown>>(
    keys?: string | string[] | null,
    area?: ExtensionStorageArea
  ): Promise<Result<T, ExtensionBridgeError>>;

  setItem<T = unknown>(
    key: string,
    value: T,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>>;

  setItems(
    items: Record<string, unknown>,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>>;

  removeItem(
    key: string,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>>;

  removeItems(
    keys: string[],
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>>;

  clear(
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>>;

  getBytesInUse(
    keys?: string | string[] | null,
    area?: ExtensionStorageArea
  ): Promise<Result<number, ExtensionBridgeError>>;

  sendMessage<TResponse = unknown, TPayload = unknown>(
    message: BridgeMessagePayload<TPayload>
  ): Promise<Result<TResponse, ExtensionBridgeError>>;

  sendMessageToTab<TResponse = unknown, TPayload = unknown>(
    tabId: number,
    message: BridgeMessagePayload<TPayload>
  ): Promise<Result<TResponse, ExtensionBridgeError>>;

  onStorageChanged(listener: StorageChangeListener): () => void;
}
