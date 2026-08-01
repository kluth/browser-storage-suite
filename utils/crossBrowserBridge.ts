import { Result } from './result';
import {
  ExtensionBridgePort,
  ExtensionBridgeError,
  ExtensionStorageArea,
  BrowserContextInfo,
  BridgeMessagePayload,
  StorageChangeListener,
} from '../src/domain/ports/secondary/extensionBridgePort';
import { WxtBridgeAdapter } from '../src/infrastructure/adapters/wxtBridgeAdapter';

export class CrossBrowserBridge {
  private static instance: CrossBrowserBridge | null = null;
  private port: ExtensionBridgePort;

  private constructor(customPort?: ExtensionBridgePort) {
    this.port = customPort || new WxtBridgeAdapter();
  }

  public static getInstance(): CrossBrowserBridge {
    if (!CrossBrowserBridge.instance) {
      CrossBrowserBridge.instance = new CrossBrowserBridge();
    }
    return CrossBrowserBridge.instance;
  }

  public static configure(customPort: ExtensionBridgePort): void {
    CrossBrowserBridge.instance = new CrossBrowserBridge(customPort);
  }

  public static setAdapter(customPort: ExtensionBridgePort): void {
    CrossBrowserBridge.configure(customPort);
  }

  public static reset(): void {
    CrossBrowserBridge.instance = null;
  }

  public static resetAdapter(): void {
    CrossBrowserBridge.reset();
  }

  public async get<T = unknown>(
    key: string,
    area?: ExtensionStorageArea
  ): Promise<Result<T | null, ExtensionBridgeError>> {
    return this.port.getItem<T>(key, area);
  }

  public async getMultiple<T = Record<string, unknown>>(
    keys?: string | string[] | null,
    area?: ExtensionStorageArea
  ): Promise<Result<T, ExtensionBridgeError>> {
    return this.port.getItems<T>(keys, area);
  }

  public async set<T = unknown>(
    key: string,
    value: T,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.port.setItem<T>(key, value, area);
  }

  public async setMultiple(
    items: Record<string, unknown>,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.port.setItems(items, area);
  }

  public async remove(
    key: string,
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.port.removeItem(key, area);
  }

  public async removeMultiple(
    keys: string[],
    area?: ExtensionStorageArea
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.port.removeItems(keys, area);
  }

  public async clear(area?: ExtensionStorageArea): Promise<Result<void, ExtensionBridgeError>> {
    return this.port.clear(area);
  }

  public async getBytesInUse(
    keys?: string | string[] | null,
    area?: ExtensionStorageArea
  ): Promise<Result<number, ExtensionBridgeError>> {
    return this.port.getBytesInUse(keys, area);
  }

  public async send<TResponse = unknown, TPayload = unknown>(
    type: string,
    payload: TPayload,
    targetTabId?: number
  ): Promise<Result<TResponse, ExtensionBridgeError>> {
    const msg: BridgeMessagePayload<TPayload> = {
      type,
      targetTabId,
      payload,
      timestamp: Date.now(),
      correlationId: `rpc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    };

    if (targetTabId !== undefined) {
      return this.port.sendMessageToTab<TResponse, TPayload>(targetTabId, msg);
    }
    return this.port.sendMessage<TResponse, TPayload>(msg);
  }

  public async sendRPC<TResponse = unknown, TPayload = unknown>(
    type: string,
    payload: TPayload,
    targetTabId?: number
  ): Promise<Result<TResponse, ExtensionBridgeError>> {
    return this.send<TResponse, TPayload>(type, payload, targetTabId);
  }

  public listen(listener: StorageChangeListener): () => void {
    return this.port.onStorageChanged(listener);
  }

  public getContext(): BrowserContextInfo {
    return this.port.getBrowserContext();
  }

  public getBrowserInfo(): BrowserContextInfo {
    return this.getContext();
  }
}
