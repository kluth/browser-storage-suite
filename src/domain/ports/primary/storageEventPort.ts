import { Result } from '../../../../utils/result';
import { StorageTarget } from '../../model/valueObjects';

export type StorageEventType = 'CREATE' | 'UPDATE' | 'DELETE' | 'CLEAR' | 'BATCH' | 'MUTATION';

export interface StorageEvent<T = unknown> {
  readonly eventId: string;
  readonly type: StorageEventType;
  readonly target: StorageTarget;
  readonly key?: string;
  readonly oldValue?: T;
  readonly newValue?: T;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

export type EventFilter = (event: StorageEvent) => boolean;

export interface SubscribeOptions {
  readonly debounceMs?: number;
  readonly filter?: EventFilter;
  readonly once?: boolean;
}

export type StorageEventListener<T = unknown> = (event: StorageEvent<T>) => void | Promise<void>;

export interface SubscriptionToken {
  readonly id: string;
  readonly topic: string;
  readonly unsubscribe: () => void;
}

export type StorageEventErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_TOPIC'
  | 'SUBSCRIBER_ERROR'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'DISPATCH_FAILED'
  | 'DEBOUNCE_ERROR'
  | 'INVALID_CALLBACK'
  | 'BUS_DISPOSED';

export class StorageEventError extends Error {
  constructor(
    public readonly code: StorageEventErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageEventError';
  }
}

export interface StorageEventPort {
  publish<T = unknown>(
    event: Omit<StorageEvent<T>, 'eventId' | 'timestamp'> | StorageEvent<T>
  ): Result<void, StorageEventError>;

  subscribe<T = unknown>(
    topic: string,
    listener: StorageEventListener<T>,
    options?: SubscribeOptions
  ): SubscriptionToken;

  subscribePattern<T = unknown>(
    pattern: string | RegExp,
    listener: StorageEventListener<T>,
    options?: SubscribeOptions
  ): SubscriptionToken;

  unsubscribe(tokenOrId: SubscriptionToken | string): boolean;

  unsubscribeAll(topic?: string): void;

  getSubscriberCount(topic?: string): number;

  hasSubscribers(topic: string): boolean;

  dispose?(): void;
}
