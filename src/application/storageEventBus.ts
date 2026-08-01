import { Result } from '../../utils/result';
import {
  StorageEventPort,
  StorageEvent,
  StorageEventListener,
  SubscribeOptions,
  SubscriptionToken,
  StorageEventError,
} from '../domain/ports/primary/storageEventPort';

interface InternalSubscription<T = unknown> {
  id: string;
  topicOrPattern: string | RegExp;
  matcher: (topic: string) => boolean;
  listener: StorageEventListener<T>;
  options: SubscribeOptions;
  debounceTimer?: ReturnType<typeof setTimeout> | null;
}

export class StorageEventBus implements StorageEventPort {
  private static instance: StorageEventBus | null = null;
  private subscriptions: Map<string, InternalSubscription<any>> = new Map();
  private subscriptionCounter = 0;
  private isDisposed = false;
  private onErrorHandler?: (error: StorageEventError) => void;

  public static getInstance(): StorageEventBus {
    if (!StorageEventBus.instance) {
      StorageEventBus.instance = new StorageEventBus();
    }
    return StorageEventBus.instance;
  }

  public static resetInstance(): void {
    if (StorageEventBus.instance) {
      StorageEventBus.instance.dispose();
      StorageEventBus.instance = null;
    }
  }

  public static reset(): void {
    StorageEventBus.resetInstance();
  }

  public setErrorHandler(handler: (error: StorageEventError) => void): void {
    this.onErrorHandler = handler;
  }

  public publish<T = unknown>(
    eventInput: Omit<StorageEvent<T>, 'eventId' | 'timestamp'> | StorageEvent<T>
  ): Result<void, StorageEventError> {
    if (this.isDisposed) {
      return Result.err(
        new StorageEventError('BUS_DISPOSED', 'StorageEventBus is disposed')
      );
    }

    if (!eventInput || !eventInput.type || !eventInput.target) {
      return Result.err(
        new StorageEventError('INVALID_EVENT', 'StorageEvent must contain valid type and target')
      );
    }

    const event: StorageEvent<T> = {
      ...eventInput,
      eventId:
        (eventInput as StorageEvent<T>).eventId ||
        `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: (eventInput as StorageEvent<T>).timestamp || Date.now(),
    };

    const constructedTopic = event.key
      ? `${event.target}:${event.key}`
      : `${event.target}:*`;

    // Snapshot iteration array to protect against mid-dispatch map modification
    const snapshot = Array.from(this.subscriptions.values());
    const matchingSubs: InternalSubscription<any>[] = [];

    for (const sub of snapshot) {
      if (
        sub.matcher(constructedTopic) ||
        (event.key ? sub.matcher(event.key) || sub.matcher(`${event.target}:${event.key}`) : false)
      ) {
        matchingSubs.push(sub);
      }
    }

    for (const sub of matchingSubs) {
      if (sub.options.filter && !sub.options.filter(event)) {
        continue;
      }

      if (sub.options.debounceMs && sub.options.debounceMs > 0) {
        if (sub.debounceTimer) {
          clearTimeout(sub.debounceTimer);
        }
        sub.debounceTimer = setTimeout(() => {
          sub.debounceTimer = null;
          this.executeListener(sub, event);
        }, sub.options.debounceMs);
      } else {
        this.executeListener(sub, event);
      }

      if (sub.options.once) {
        this.unsubscribe(sub.id);
      }
    }

    return Result.ok(undefined);
  }

  private executeListener(sub: InternalSubscription<any>, event: StorageEvent<any>): void {
    try {
      const res = sub.listener(event);
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch((err) => {
          const storageErr = new StorageEventError(
            'SUBSCRIBER_ERROR',
            `Async subscriber error in subscription ${sub.id}`,
            err
          );
          if (this.onErrorHandler) {
            this.onErrorHandler(storageErr);
          }
          console.error(`[StorageEventBus] Async listener error for subscription ${sub.id}:`, err);
        });
      }
    } catch (err) {
      const storageErr = new StorageEventError(
        'SUBSCRIBER_ERROR',
        `Sync subscriber error in subscription ${sub.id}`,
        err
      );
      if (this.onErrorHandler) {
        this.onErrorHandler(storageErr);
      }
      console.error(`[StorageEventBus] Sync listener error for subscription ${sub.id}:`, err);
    }
  }

  public subscribe<T = unknown>(
    topic: string,
    listener: StorageEventListener<T>,
    options: SubscribeOptions = {}
  ): SubscriptionToken {
    if (this.isDisposed || !topic || typeof listener !== 'function') {
      const dummyId = `sub_invalid_${Date.now()}`;
      return {
        id: dummyId,
        topic: topic || '',
        unsubscribe: () => {},
      };
    }

    const id = `sub_${++this.subscriptionCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const matcher = this.createTopicMatcher(topic);

    const sub: InternalSubscription<T> = {
      id,
      topicOrPattern: topic,
      matcher,
      listener,
      options,
    };

    this.subscriptions.set(id, sub);

    return {
      id,
      topic,
      unsubscribe: () => this.unsubscribe(id),
    };
  }

  public subscribePattern<T = unknown>(
    pattern: string | RegExp,
    listener: StorageEventListener<T>,
    options: SubscribeOptions = {}
  ): SubscriptionToken {
    if (this.isDisposed || !pattern || typeof listener !== 'function') {
      const dummyId = `sub_invalid_${Date.now()}`;
      return {
        id: dummyId,
        topic: typeof pattern === 'string' ? pattern : pattern?.source || '',
        unsubscribe: () => {},
      };
    }

    const id = `sub_${++this.subscriptionCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const topicStr = typeof pattern === 'string' ? pattern : pattern.source;
    const matcher =
      typeof pattern === 'string'
        ? this.createTopicMatcher(pattern)
        : (t: string) => pattern.test(t);

    const sub: InternalSubscription<T> = {
      id,
      topicOrPattern: pattern,
      matcher,
      listener,
      options,
    };

    this.subscriptions.set(id, sub);

    return {
      id,
      topic: topicStr,
      unsubscribe: () => this.unsubscribe(id),
    };
  }

  public unsubscribe(tokenOrId: SubscriptionToken | string): boolean {
    const id = typeof tokenOrId === 'string' ? tokenOrId : tokenOrId?.id;
    if (!id) return false;

    const sub = this.subscriptions.get(id);
    if (!sub) return false;

    if (sub.debounceTimer) {
      clearTimeout(sub.debounceTimer);
      sub.debounceTimer = null;
    }

    return this.subscriptions.delete(id);
  }

  public unsubscribeAll(topic?: string): void {
    if (topic) {
      const toDelete: string[] = [];
      for (const [id, sub] of this.subscriptions.entries()) {
        if (sub.topicOrPattern === topic || sub.matcher(topic)) {
          toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        this.unsubscribe(id);
      }
    } else {
      for (const sub of this.subscriptions.values()) {
        if (sub.debounceTimer) {
          clearTimeout(sub.debounceTimer);
          sub.debounceTimer = null;
        }
      }
      this.subscriptions.clear();
    }
  }

  public getSubscriberCount(topic?: string): number {
    if (this.isDisposed) return 0;
    if (!topic) return this.subscriptions.size;

    let count = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.topicOrPattern === topic || sub.matcher(topic)) {
        count++;
      }
    }
    return count;
  }

  public hasSubscribers(topic: string): boolean {
    return this.getSubscriberCount(topic) > 0;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.unsubscribeAll();
  }

  private createTopicMatcher(topicPattern: string): (topic: string) => boolean {
    if (topicPattern === '*') return () => true;

    const regexString =
      '^' +
      topicPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$';

    const regex = new RegExp(regexString);
    return (t: string) => regex.test(t);
  }
}
