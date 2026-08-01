import { Result } from './result';
import { StorageTarget } from '../src/domain/model/valueObjects';
import {
  StorageEventPort,
  StorageEvent,
  SubscribeOptions,
  StorageEventListener,
} from '../src/domain/ports/primary/storageEventPort';
import { StorageEventBus } from '../src/application/storageEventBus';
import { CrossBrowserBridge } from './crossBrowserBridge';

export class ReactiveStorageObserver {
  private static instance: ReactiveStorageObserver | null = null;
  private eventBus: StorageEventPort;
  private bridgeUnsubscribe: (() => void) | null = null;
  private paused = false;
  private pausedQueue: Array<() => void> = [];

  private constructor(customBus?: StorageEventPort) {
    this.eventBus = customBus || StorageEventBus.getInstance();
  }

  public static getInstance(): ReactiveStorageObserver {
    if (!ReactiveStorageObserver.instance) {
      ReactiveStorageObserver.instance = new ReactiveStorageObserver();
    }
    return ReactiveStorageObserver.instance;
  }

  public static configure(customBus: StorageEventPort): void {
    ReactiveStorageObserver.instance = new ReactiveStorageObserver(customBus);
  }

  public static reset(): void {
    if (ReactiveStorageObserver.instance) {
      ReactiveStorageObserver.instance.stopAutoBridge();
      ReactiveStorageObserver.instance.clearPausedQueue();
      ReactiveStorageObserver.instance = null;
    }
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    const queue = [...this.pausedQueue];
    this.pausedQueue = [];
    for (const task of queue) {
      try {
        task();
      } catch (err) {
        console.error('[ReactiveStorageObserver] Error processing paused task:', err);
      }
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public clearPausedQueue(): void {
    this.pausedQueue = [];
  }

  public observeKey<T = unknown>(
    target: StorageTarget,
    key: string,
    callback: (newValue: T | undefined, oldValue: T | undefined, event: StorageEvent<T>) => void,
    options?: SubscribeOptions
  ): () => void {
    const topic = `${target}:${key}`;
    const listener: StorageEventListener<T> = (event) => {
      if (this.paused) {
        this.pausedQueue.push(() => callback(event.newValue, event.oldValue, event));
        return;
      }
      callback(event.newValue, event.oldValue, event);
    };

    const token = this.eventBus.subscribe<T>(topic, listener, options);
    return () => token.unsubscribe();
  }

  public observePrefix<T = unknown>(
    target: StorageTarget,
    prefix: string,
    callback: (event: StorageEvent<T>) => void,
    options?: SubscribeOptions
  ): () => void {
    const topicPattern = `${target}:${prefix}*`;
    const listener: StorageEventListener<T> = (event) => {
      if (this.paused) {
        this.pausedQueue.push(() => callback(event));
        return;
      }
      callback(event);
    };

    const token = this.eventBus.subscribePattern<T>(topicPattern, listener, options);
    return () => token.unsubscribe();
  }

  public observeTarget(
    target: StorageTarget,
    callback: (event: StorageEvent) => void,
    options?: SubscribeOptions
  ): () => void {
    const topicPattern = `${target}:*`;
    const listener: StorageEventListener<any> = (event) => {
      if (this.paused) {
        this.pausedQueue.push(() => callback(event));
        return;
      }
      callback(event);
    };

    const token = this.eventBus.subscribe<any>(topicPattern, listener, options);
    return () => token.unsubscribe();
  }

  public observeAll(
    callback: (event: StorageEvent) => void,
    options?: SubscribeOptions
  ): () => void {
    const listener: StorageEventListener<any> = (event) => {
      if (this.paused) {
        this.pausedQueue.push(() => callback(event));
        return;
      }
      callback(event);
    };

    const token = this.eventBus.subscribe<any>('*', listener, options);
    return () => token.unsubscribe();
  }

  public startAutoBridge(): void {
    if (this.bridgeUnsubscribe) return;

    const bridge = CrossBrowserBridge.getInstance();
    this.bridgeUnsubscribe = bridge.listen((changes, areaName) => {
      const targetMap: Record<string, StorageTarget> = {
        local: 'localStorage',
        session: 'sessionStorage',
        sync: 'localStorage',
        managed: 'localStorage',
      };

      const target: StorageTarget = targetMap[areaName] || 'localStorage';

      for (const [key, change] of Object.entries(changes)) {
        let type: StorageEvent['type'] = 'UPDATE';
        if (change.oldValue === undefined && change.newValue !== undefined) {
          type = 'CREATE';
        } else if (change.oldValue !== undefined && change.newValue === undefined) {
          type = 'DELETE';
        }

        this.eventBus.publish({
          type,
          target,
          key,
          oldValue: change.oldValue,
          newValue: change.newValue,
        });
      }
    });
  }

  public stopAutoBridge(): void {
    if (this.bridgeUnsubscribe) {
      this.bridgeUnsubscribe();
      this.bridgeUnsubscribe = null;
    }
  }
}
