import { Result } from '../../../utils/result';
import { StorageMutation } from '../../../utils/storageAggregate';
import { DataBlameRegistry } from '../../../utils/dataBlamer';

export type InterceptorErrorCode =
  | 'STORAGE_NOT_SUPPORTED'
  | 'PROPERTY_NON_CONFIGURABLE'
  | 'ATTACH_FAILED'
  | 'DETACH_FAILED';

export interface InterceptorError {
  code: InterceptorErrorCode;
  message: string;
  cause?: unknown;
}

export type StorageMutationCallback = (mutation: StorageMutation, rawStack?: string) => void;

export class StorageInterceptorAdapter {
  private static activeInstances = new Set<StorageInterceptorAdapter>();
  private static isPatched = false;
  private static isExecuting = false;

  private static origSetItem: typeof Storage.prototype.setItem | null = null;
  private static origRemoveItem: typeof Storage.prototype.removeItem | null = null;
  private static origClear: typeof Storage.prototype.clear | null = null;

  private customListener: ((event: Event) => void) | null = null;
  private readonly target: EventTarget;

  constructor(
    private readonly onMutation: StorageMutationCallback,
    customTarget?: EventTarget
  ) {
    this.target = customTarget || (typeof window !== 'undefined' ? window : (globalThis as unknown as EventTarget));
  }

  public attach(): Result<void, InterceptorError> {
    try {
      if (this.customListener) {
        return Result.ok(undefined);
      }

      if (this.target && typeof this.target.addEventListener === 'function') {
        this.customListener = (event: Event) => {
          const customEvt = event as CustomEvent<StorageMutation>;
          if (customEvt.detail) {
            this.onMutation(customEvt.detail);
          }
        };
        this.target.addEventListener('__STORAGE_SUITE_INTERCEPT__', this.customListener);
      }

      StorageInterceptorAdapter.activeInstances.add(this);
      if (!StorageInterceptorAdapter.isPatched) {
        const patchResult = StorageInterceptorAdapter.patchPrototype();
        if (!patchResult.ok) {
          this.cleanupAttachFailure();
          return patchResult;
        }
      }

      return Result.ok(undefined);
    } catch (err) {
      this.cleanupAttachFailure();
      return Result.err({
        code: 'ATTACH_FAILED',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      });
    }
  }

  private cleanupAttachFailure(): void {
    if (this.customListener && this.target && typeof this.target.removeEventListener === 'function') {
      this.target.removeEventListener('__STORAGE_SUITE_INTERCEPT__', this.customListener);
      this.customListener = null;
    }
    StorageInterceptorAdapter.activeInstances.delete(this);
  }

  public detach(): Result<void, InterceptorError> {
    try {
      if (this.customListener && this.target && typeof this.target.removeEventListener === 'function') {
        this.target.removeEventListener('__STORAGE_SUITE_INTERCEPT__', this.customListener);
        this.customListener = null;
      }

      StorageInterceptorAdapter.activeInstances.delete(this);
      if (StorageInterceptorAdapter.activeInstances.size === 0 && StorageInterceptorAdapter.isPatched) {
        StorageInterceptorAdapter.unpatchPrototype();
      }

      return Result.ok(undefined);
    } catch (err) {
      return Result.err({
        code: 'DETACH_FAILED',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      });
    }
  }

  private static patchPrototype(): Result<void, InterceptorError> {
    if (typeof globalThis === 'undefined' || !('Storage' in globalThis) || !globalThis.Storage?.prototype) {
      return Result.ok(undefined);
    }

    try {
      const proto = globalThis.Storage.prototype;
      StorageInterceptorAdapter.origSetItem = proto.setItem;
      StorageInterceptorAdapter.origRemoveItem = proto.removeItem;
      StorageInterceptorAdapter.origClear = proto.clear;

      proto.setItem = function (key: string, value: string) {
        if (StorageInterceptorAdapter.isExecuting) {
          return Reflect.apply(StorageInterceptorAdapter.origSetItem!, this, [key, value]);
        }

        StorageInterceptorAdapter.isExecuting = true;
        let stack: string | undefined;
        try {
          stack = new Error().stack;
          Reflect.apply(StorageInterceptorAdapter.origSetItem!, this, [key, value]);
        } finally {
          StorageInterceptorAdapter.isExecuting = false;
        }

        StorageInterceptorAdapter.notifyMutation(this, 'set', key, value, stack);
      };

      proto.removeItem = function (key: string) {
        if (StorageInterceptorAdapter.isExecuting) {
          return Reflect.apply(StorageInterceptorAdapter.origRemoveItem!, this, [key]);
        }

        StorageInterceptorAdapter.isExecuting = true;
        let stack: string | undefined;
        try {
          stack = new Error().stack;
          Reflect.apply(StorageInterceptorAdapter.origRemoveItem!, this, [key]);
        } finally {
          StorageInterceptorAdapter.isExecuting = false;
        }

        StorageInterceptorAdapter.notifyMutation(this, 'delete', key, undefined, stack);
      };

      proto.clear = function () {
        if (StorageInterceptorAdapter.isExecuting) {
          return Reflect.apply(StorageInterceptorAdapter.origClear!, this, []);
        }

        StorageInterceptorAdapter.isExecuting = true;
        let stack: string | undefined;
        try {
          stack = new Error().stack;
          Reflect.apply(StorageInterceptorAdapter.origClear!, this, []);
        } finally {
          StorageInterceptorAdapter.isExecuting = false;
        }

        StorageInterceptorAdapter.notifyMutation(this, 'clear', '', undefined, stack);
      };

      StorageInterceptorAdapter.isPatched = true;
      return Result.ok(undefined);
    } catch (err) {
      return Result.err({
        code: 'PROPERTY_NON_CONFIGURABLE',
        message: 'Failed to patch Storage.prototype',
        cause: err,
      });
    }
  }

  private static unpatchPrototype(): void {
    if (!StorageInterceptorAdapter.isPatched || typeof globalThis === 'undefined' || !globalThis.Storage?.prototype) {
      return;
    }

    const proto = globalThis.Storage.prototype;
    if (StorageInterceptorAdapter.origSetItem) proto.setItem = StorageInterceptorAdapter.origSetItem;
    if (StorageInterceptorAdapter.origRemoveItem) proto.removeItem = StorageInterceptorAdapter.origRemoveItem;
    if (StorageInterceptorAdapter.origClear) proto.clear = StorageInterceptorAdapter.origClear;

    StorageInterceptorAdapter.origSetItem = null;
    StorageInterceptorAdapter.origRemoveItem = null;
    StorageInterceptorAdapter.origClear = null;
    StorageInterceptorAdapter.isPatched = false;
  }

  private static notifyMutation(
    storageInstance: Storage,
    type: 'set' | 'delete' | 'clear',
    key: string,
    value?: string,
    rawStack?: string
  ): void {
    const storageType =
      typeof window !== 'undefined' && storageInstance === window.sessionStorage ? 'sessionStorage' : 'localStorage';

    if (type === 'set' && key) {
      DataBlameRegistry.getInstance().recordMutation(key, value ?? '', rawStack);
    } else if (type === 'delete' && key) {
      DataBlameRegistry.getInstance().recordMutation(key, '', rawStack);
    }

    const mutation: StorageMutation = {
      id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      type,
      storageType,
      key,
      value,
    };

    StorageInterceptorAdapter.activeInstances.forEach((instance) => {
      try {
        instance.onMutation(mutation, rawStack);
      } catch {
        // Safe callback execution guard
      }
    });
  }
}
