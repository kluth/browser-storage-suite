import { Result } from '../../../utils/result';
import {
  ExtensionBridgePort,
  ExtensionBridgeError,
  ExtensionBridgeErrorCode,
  ExtensionStorageArea,
  BrowserContextInfo,
  BrowserVendor,
  ManifestVersion,
  BridgeMessagePayload,
  StorageChangeListener,
} from '../../domain/ports/secondary/extensionBridgePort';

export class WxtBridgeAdapter implements ExtensionBridgePort {
  private inMemoryStores: Record<ExtensionStorageArea, Map<string, unknown>> = {
    local: new Map(),
    sync: new Map(),
    managed: new Map(),
    session: new Map(),
  };

  private listeners: Set<StorageChangeListener> = new Set();
  private isNativeListenerAttached = false;

  public getBrowserContext(): BrowserContextInfo {
    const isExtension = this.checkExtensionEnvironment();
    const vendor = this.detectBrowserVendor();
    const manifestVersion = this.detectManifestVersion();
    const hasSessionStorage = this.hasSessionStorageSupport();

    const supportedStorageAreas: ExtensionStorageArea[] = ['local', 'sync', 'managed'];
    if (hasSessionStorage || !isExtension) {
      supportedStorageAreas.push('session');
    }

    return {
      vendor,
      manifestVersion,
      isExtensionContext: isExtension,
      supportedStorageAreas,
      hasSessionStorage: isExtension ? hasSessionStorage : true,
    };
  }

  public async getItem<T = unknown>(
    key: string,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<T | null, ExtensionBridgeError>> {
    const itemsRes = await this.getItems<Record<string, T>>([key], area);
    if (!itemsRes.ok) return itemsRes;
    const value = itemsRes.value[key] !== undefined ? itemsRes.value[key] : null;
    return Result.ok(value);
  }

  public async getItems<T = Record<string, unknown>>(
    keys?: string | string[] | null,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<T, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      return this.getItemsInMemory<T>(keys, area);
    }

    try {
      const storageApi = this.getStorageApi(area);
      if (!storageApi) {
        if (area === 'session') {
          return this.getItemsInMemory<T>(keys, 'session');
        }
        return Result.err(
          new ExtensionBridgeError(
            'UNSUPPORTED_AREA',
            `Storage area '${area}' is not supported in current browser environment.`
          )
        );
      }

      const keyArg = keys === null ? undefined : keys;
      const result = await this.invokeStorageApi<Record<string, unknown>>(storageApi, 'get', keyArg);
      return Result.ok((result || {}) as T);
    } catch (err) {
      const msg = this.getErrorMessage(err);
      const code: ExtensionBridgeErrorCode = msg.toLowerCase().includes('permission')
        ? 'PERMISSION_DENIED'
        : 'READ_FAILED';
      return Result.err(
        new ExtensionBridgeError(
          code,
          `Failed to read items from storage area '${area}': ${msg}`,
          err
        )
      );
    }
  }

  public async setItem<T = unknown>(
    key: string,
    value: T,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.setItems({ [key]: value }, area);
  }

  public async setItems(
    items: Record<string, unknown>,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<void, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      return this.setItemsInMemory(items, area);
    }

    try {
      const storageApi = this.getStorageApi(area);
      if (!storageApi) {
        if (area === 'session') {
          return this.setItemsInMemory(items, 'session');
        }
        return Result.err(
          new ExtensionBridgeError('UNSUPPORTED_AREA', `Storage area '${area}' is not supported.`)
        );
      }

      await this.invokeStorageApi<void>(storageApi, 'set', items);
      return Result.ok(undefined);
    } catch (err) {
      const msg = this.getErrorMessage(err);
      const isQuota =
        msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exceeded');
      const isPerm = msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('access denied');
      let code: ExtensionBridgeErrorCode = 'WRITE_FAILED';
      if (isQuota) code = 'QUOTA_EXCEEDED';
      else if (isPerm) code = 'PERMISSION_DENIED';

      return Result.err(
        new ExtensionBridgeError(code, `Failed to write items to '${area}': ${msg}`, err)
      );
    }
  }

  public async removeItem(
    key: string,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<void, ExtensionBridgeError>> {
    return this.removeItems([key], area);
  }

  public async removeItems(
    keys: string[],
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<void, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      return this.removeItemsInMemory(keys, area);
    }

    try {
      const storageApi = this.getStorageApi(area);
      if (!storageApi) {
        if (area === 'session') {
          return this.removeItemsInMemory(keys, 'session');
        }
        return Result.err(
          new ExtensionBridgeError('UNSUPPORTED_AREA', `Storage area '${area}' is not supported.`)
        );
      }

      await this.invokeStorageApi<void>(storageApi, 'remove', keys);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new ExtensionBridgeError(
          'DELETE_FAILED',
          `Failed to remove keys from '${area}': ${this.getErrorMessage(err)}`,
          err
        )
      );
    }
  }

  public async clear(area: ExtensionStorageArea = 'local'): Promise<Result<void, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      this.inMemoryStores[area].clear();
      return Result.ok(undefined);
    }

    try {
      const storageApi = this.getStorageApi(area);
      if (!storageApi) {
        if (area === 'session') {
          this.inMemoryStores['session'].clear();
          return Result.ok(undefined);
        }
        return Result.err(
          new ExtensionBridgeError('UNSUPPORTED_AREA', `Storage area '${area}' is not supported.`)
        );
      }

      await this.invokeStorageApi<void>(storageApi, 'clear');
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new ExtensionBridgeError(
          'CLEAR_FAILED',
          `Failed to clear storage area '${area}': ${this.getErrorMessage(err)}`,
          err
        )
      );
    }
  }

  public async getBytesInUse(
    keys?: string | string[] | null,
    area: ExtensionStorageArea = 'local'
  ): Promise<Result<number, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      let total = 0;
      const store = this.inMemoryStores[area];
      store.forEach((val, k) => {
        if (!keys || (Array.isArray(keys) ? keys.includes(k) : keys === k)) {
          total += new Blob([JSON.stringify(val)]).size;
        }
      });
      return Result.ok(total);
    }

    try {
      const storageApi = this.getStorageApi(area);
      if (!storageApi || typeof storageApi.getBytesInUse !== 'function') {
        // Fallback size calculation for Firefox/Safari where getBytesInUse might be missing
        const itemsRes = await this.getItems(keys, area);
        if (!itemsRes.ok) return Result.err(itemsRes.error);
        const bytes = new Blob([JSON.stringify(itemsRes.value)]).size;
        return Result.ok(bytes);
      }

      const keyArg = keys === null ? undefined : keys;
      const bytes = await this.invokeStorageApi<number>(storageApi, 'getBytesInUse', keyArg);
      return Result.ok(bytes);
    } catch (err) {
      return Result.err(
        new ExtensionBridgeError(
          'READ_FAILED',
          `Failed to get bytes in use for '${area}': ${this.getErrorMessage(err)}`,
          err
        )
      );
    }
  }

  public async sendMessage<TResponse = unknown, TPayload = unknown>(
    message: BridgeMessagePayload<TPayload>
  ): Promise<Result<TResponse, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      return Result.err(
        new ExtensionBridgeError(
          'UNSUPPORTED_ENVIRONMENT',
          'Extension runtime is unavailable in current environment.'
        )
      );
    }

    try {
      const runtimeApi = this.getRuntimeApi();
      if (!runtimeApi || typeof runtimeApi.sendMessage !== 'function') {
        return Result.err(
          new ExtensionBridgeError(
            'UNSUPPORTED_API',
            'chrome.runtime.sendMessage is unavailable.'
          )
        );
      }

      const response = await new Promise<TResponse>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('RPC message response timed out (5000ms).'));
          }
        }, 5000);

        try {
          const ret = runtimeApi.sendMessage(message, (res: TResponse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const err = this.getRuntimeError();
            if (err) reject(err);
            else resolve(res);
          });

          if (ret && typeof ret.then === 'function') {
            ret
              .then((res: TResponse) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(res);
              })
              .catch((err: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
              });
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      });

      return Result.ok(response);
    } catch (err) {
      const msg = this.getErrorMessage(err);
      const isDisc =
        msg.includes('Could not establish connection') ||
        msg.includes('closed before a response was received') ||
        msg.includes('disconnected');
      const isTimeout = msg.includes('timed out');
      let code: ExtensionBridgeErrorCode = 'MESSAGE_SEND_FAILED';
      if (isDisc) code = 'PORT_DISCONNECTED';
      else if (isTimeout) code = 'TIMEOUT';

      return Result.err(
        new ExtensionBridgeError(code, `RPC message send failed: ${msg}`, err)
      );
    }
  }

  public async sendMessageToTab<TResponse = unknown, TPayload = unknown>(
    tabId: number,
    message: BridgeMessagePayload<TPayload>
  ): Promise<Result<TResponse, ExtensionBridgeError>> {
    if (!this.checkExtensionEnvironment()) {
      return Result.err(
        new ExtensionBridgeError(
          'UNSUPPORTED_ENVIRONMENT',
          'Extension runtime is unavailable.'
        )
      );
    }

    try {
      const chromeApi = this.getChromeApi();
      if (!chromeApi.tabs?.sendMessage) {
        return Result.err(
          new ExtensionBridgeError('UNSUPPORTED_API', 'chrome.tabs.sendMessage is unavailable.')
        );
      }

      const response = await new Promise<TResponse>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`RPC message to tab ${tabId} timed out (5000ms).`));
          }
        }, 5000);

        try {
          const ret = chromeApi.tabs.sendMessage(tabId, message, (res: TResponse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const err = this.getRuntimeError();
            if (err) reject(err);
            else resolve(res);
          });

          if (ret && typeof ret.then === 'function') {
            ret
              .then((res: TResponse) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(res);
              })
              .catch((err: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
              });
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      });

      return Result.ok(response);
    } catch (err) {
      const msg = this.getErrorMessage(err);
      const isTabErr =
        msg.toLowerCase().includes('tab') ||
        msg.includes('Could not establish connection');
      const isTimeout = msg.includes('timed out');
      let code: ExtensionBridgeErrorCode = 'MESSAGE_SEND_FAILED';
      if (isTabErr) code = 'TAB_NOT_FOUND';
      else if (isTimeout) code = 'TIMEOUT';

      return Result.err(
        new ExtensionBridgeError(code, `Failed to send message to tab ${tabId}: ${msg}`, err)
      );
    }
  }

  public onStorageChanged(listener: StorageChangeListener): () => void {
    this.listeners.add(listener);

    if (this.checkExtensionEnvironment() && !this.isNativeListenerAttached) {
      const chromeApi = this.getChromeApi();
      if (chromeApi.storage?.onChanged) {
        chromeApi.storage.onChanged.addListener(
          (changes: Record<string, any>, areaName: string) => {
            this.listeners.forEach((l) => l(changes, areaName as ExtensionStorageArea));
          }
        );
        this.isNativeListenerAttached = true;
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Private Helper Methods ---

  private checkExtensionEnvironment(): boolean {
    if (typeof globalThis === 'undefined') return false;
    const g = globalThis as any;
    return Boolean(g.chrome?.runtime?.id || g.browser?.runtime?.id);
  }

  private getChromeApi(): any {
    if (typeof globalThis === 'undefined') return {};
    const g = globalThis as any;
    return g.browser || g.chrome || {};
  }

  private getRuntimeApi(): any {
    const api = this.getChromeApi();
    return api.runtime || null;
  }

  private getStorageApi(area: ExtensionStorageArea): any {
    const api = this.getChromeApi();
    return api.storage ? api.storage[area] : null;
  }

  private getRuntimeError(): Error | null {
    const api = this.getChromeApi();
    if (api.runtime?.lastError) {
      const err = api.runtime.lastError;
      return new Error(err.message || String(err));
    }
    return null;
  }

  private detectBrowserVendor(): BrowserVendor {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent ? navigator.userAgent.toLowerCase() : '';
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('firefox')) return 'firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
    if (ua.includes('chrome')) return 'chrome';
    return 'unknown';
  }

  private detectManifestVersion(): ManifestVersion {
    if (!this.checkExtensionEnvironment()) return 'web';
    try {
      const api = this.getChromeApi();
      const manifest = api.runtime?.getManifest?.();
      if (manifest?.manifest_version === 3) return 'mv3';
      if (manifest?.manifest_version === 2) return 'mv2';
    } catch {
      // Fallback
    }
    return 'mv3';
  }

  private hasSessionStorageSupport(): boolean {
    const api = this.getChromeApi();
    return Boolean(api.storage?.session);
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
    return String(err);
  }

  private invokeStorageApi<T>(
    storageApi: any,
    method: string,
    ...args: any[]
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      try {
        const ret = storageApi[method](...args, (res: T) => {
          if (settled) return;
          settled = true;
          const err = this.getRuntimeError();
          if (err) reject(err);
          else resolve(res);
        });

        if (ret && typeof ret.then === 'function') {
          ret
            .then((res: T) => {
              if (settled) return;
              settled = true;
              resolve(res);
            })
            .catch((err: unknown) => {
              if (settled) return;
              settled = true;
              reject(err);
            });
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  private getItemsInMemory<T>(
    keys?: string | string[] | null,
    area: ExtensionStorageArea = 'local'
  ): Result<T, ExtensionBridgeError> {
    const store = this.inMemoryStores[area];
    const res: Record<string, unknown> = {};

    if (!keys) {
      store.forEach((val, k) => {
        res[k] = val;
      });
    } else if (typeof keys === 'string') {
      if (store.has(keys)) res[keys] = store.get(keys);
    } else if (Array.isArray(keys)) {
      keys.forEach((k) => {
        if (store.has(k)) res[k] = store.get(k);
      });
    }

    return Result.ok(res as T);
  }

  private setItemsInMemory(
    items: Record<string, unknown>,
    area: ExtensionStorageArea
  ): Result<void, ExtensionBridgeError> {
    const store = this.inMemoryStores[area];
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};

    Object.entries(items).forEach(([k, v]) => {
      const oldVal = store.get(k);
      store.set(k, v);
      changes[k] = { oldValue: oldVal, newValue: v };
    });

    this.listeners.forEach((l) => l(changes, area));
    return Result.ok(undefined);
  }

  private removeItemsInMemory(
    keys: string[],
    area: ExtensionStorageArea
  ): Result<void, ExtensionBridgeError> {
    const store = this.inMemoryStores[area];
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};

    keys.forEach((k) => {
      if (store.has(k)) {
        const oldVal = store.get(k);
        store.delete(k);
        changes[k] = { oldValue: oldVal, newValue: undefined };
      }
    });

    this.listeners.forEach((l) => l(changes, area));
    return Result.ok(undefined);
  }
}
