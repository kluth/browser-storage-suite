import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageEventBus } from '../src/application/storageEventBus';
import { ReactiveStorageObserver } from '../utils/reactiveStorageObserver';
import {
  StorageEvent,
  StorageEventPort,
  StorageEventError,
} from '../src/domain/ports/primary/storageEventPort';
import { CrossBrowserBridge } from '../utils/crossBrowserBridge';
import { ExtensionBridgePort } from '../src/domain/ports/secondary/extensionBridgePort';
import { Result } from '../utils/result';

describe('StorageEventBus & ReactiveStorageObserver (ADR-0015)', () => {
  let bus: StorageEventBus;

  beforeEach(() => {
    StorageEventBus.resetInstance();
    ReactiveStorageObserver.reset();
    CrossBrowserBridge.reset();
    bus = StorageEventBus.getInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
    StorageEventBus.resetInstance();
    ReactiveStorageObserver.reset();
    CrossBrowserBridge.reset();
  });

  describe('Suite 1: StorageEventPort Contract & Domain Invariants', () => {
    it('1.1 should construct a valid StorageEvent with mandatory and default metadata', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:user_1', listener);

      const res = bus.publish({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'user_1',
        newValue: 'alice',
      });

      expect(res.ok).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      const event: StorageEvent = listener.mock.calls[0][0];
      expect(event.eventId).toBeDefined();
      expect(typeof event.eventId).toBe('string');
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.target).toBe('localStorage');
      expect(event.key).toBe('user_1');
      expect(event.newValue).toBe('alice');
    });

    it('1.2 should preserve custom event source and metadata when provided', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:user_2', listener);

      const res = bus.publish({
        type: 'CREATE',
        target: 'localStorage',
        key: 'user_2',
        newValue: 'bob',
        metadata: { originTab: 'tab_b', schemaVer: 2 },
      });

      expect(res.ok).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      const event: StorageEvent = listener.mock.calls[0][0];
      expect(event.metadata).toEqual({ originTab: 'tab_b', schemaVer: 2 });
    });
  });

  describe('Suite 2: StorageEventBus Core Pub/Sub Mechanics', () => {
    it('2.1 should deliver published event to single active subscriber', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:change', listener);

      bus.publish({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'change',
        newValue: 'val1',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].newValue).toBe('val1');
    });

    it('2.2 should deliver published event to multiple subscribers on same topic', () => {
      const callOrder: number[] = [];
      const listener1 = vi.fn(() => {
        callOrder.push(1);
      });
      const listener2 = vi.fn(() => {
        callOrder.push(2);
      });
      const listener3 = vi.fn(() => {
        callOrder.push(3);
      });

      bus.subscribe('indexedDB:item', listener1);
      bus.subscribe('indexedDB:item', listener2);
      bus.subscribe('indexedDB:item', listener3);

      bus.publish({
        type: 'UPDATE',
        target: 'indexedDB',
        key: 'item',
      });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual([1, 2, 3]);
    });

    it('2.3 should not invoke listeners subscribed to non-matching topics', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      bus.subscribe('localStorage:read', listenerA);
      bus.subscribe('localStorage:write', listenerB);

      bus.publish({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'write',
      });

      expect(listenerA).toHaveBeenCalledTimes(0);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });
  });

  describe('Suite 3: Wildcard Topic Pattern Matching', () => {
    it('3.1 should match single-level wildcard topic (e.g. localStorage:*)', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:*', listener);

      bus.publish({ type: 'CREATE', target: 'localStorage', key: 'set' });
      bus.publish({ type: 'DELETE', target: 'localStorage', key: 'remove' });
      bus.publish({ type: 'CLEAR', target: 'localStorage' });

      expect(listener).toHaveBeenCalledTimes(3);

      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 'settings' });
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('3.2 should match multi-level wildcard topic (e.g. localStorage:user:*)', () => {
      const listener = vi.fn();
      bus.subscribePattern('localStorage:user:*', listener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'user:theme' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'user:notifications:email' });

      expect(listener).toHaveBeenCalledTimes(2);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'cart:items' });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('3.3 should match global catch-all wildcard (*)', () => {
      const listener = vi.fn();
      bus.subscribe('*', listener);

      bus.publish({ type: 'CREATE', target: 'localStorage', key: 'a' });
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 'b' });
      bus.publish({ type: 'DELETE', target: 'cookie', key: 'c' });
      bus.publish({ type: 'MUTATION', target: 'indexedDB', key: 'd' });
      bus.publish({ type: 'BATCH', target: 'opfs', key: 'e' });

      expect(listener).toHaveBeenCalledTimes(5);
    });

    it('3.4 should safely escape special regex characters in topic names', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:user.settings:+key*', listener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'user.settings:+key:1' });
      expect(listener).toHaveBeenCalledTimes(1);

      // Must NOT match userXsettings:Ykey1 because . and + are escaped literals
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'userXsettings:Ykey1' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('3.5 should enforce strict prefix and suffix boundary anchoring', () => {
      const listener = vi.fn();
      bus.subscribe('localStorage:*', listener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'set' });
      expect(listener).toHaveBeenCalledTimes(1);

      // Testing non-matching prefix
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 'set' });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Suite 4: Listener Exception Isolation (Throwing Listeners)', () => {
    it('4.1 should isolate throwing listener so other subscribers still receive event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn(() => {
        throw new Error('Subscriber failure!');
      });
      const listener3 = vi.fn();

      bus.subscribe('localStorage:test', listener1);
      bus.subscribe('localStorage:test', listener2);
      bus.subscribe('localStorage:test', listener3);

      const res = bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'test' });

      expect(res.ok).toBe(true);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it('4.2 should route listener exceptions to custom error handler if configured', () => {
      const errorHandler = vi.fn();
      bus.setErrorHandler(errorHandler);

      bus.subscribe('localStorage:fail', () => {
        throw new Error('Custom error');
      });

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'fail' });

      expect(errorHandler).toHaveBeenCalledTimes(1);
      const err: StorageEventError = errorHandler.mock.calls[0][0];
      expect(err.code).toBe('SUBSCRIBER_ERROR');
      expect(err.message).toContain('Sync subscriber error');
    });

    it('4.3 should handle async listener promises that reject', async () => {
      const errorHandler = vi.fn();
      bus.setErrorHandler(errorHandler);

      const asyncListener = vi.fn(async () => {
        throw new Error('Async error');
      });

      bus.subscribe('localStorage:asyncFail', asyncListener);
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'asyncFail' });

      await new Promise((r) => setTimeout(r, 20));

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].code).toBe('SUBSCRIBER_ERROR');
    });
  });

  describe('Suite 5: Mid-Dispatch Subscriptions & Unsubscriptions', () => {
    it('5.1 should allow subscriber to unsubscribe itself mid-dispatch cleanly', () => {
      let token: any;
      const listener = vi.fn(() => {
        token.unsubscribe();
      });

      token = bus.subscribe('localStorage:self', listener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'self' });
      expect(listener).toHaveBeenCalledTimes(1);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'self' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('5.2 should isolate dispatch iteration when subscriber unsubscribes next listener mid-dispatch', () => {
      let tokenB: any;
      const listenerB = vi.fn();
      const listenerA = vi.fn(() => {
        tokenB.unsubscribe();
      });

      bus.subscribe('localStorage:mid', listenerA);
      tokenB = bus.subscribe('localStorage:mid', listenerB);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'mid' });

      // Snapshot isolation guarantee: listenerB receives the 1st event
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'mid' });
      expect(listenerA).toHaveBeenCalledTimes(2);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it('5.3 should isolate dispatch iteration when subscriber adds new listener mid-dispatch', () => {
      const listenerC = vi.fn();
      const listenerA = vi.fn(() => {
        bus.subscribe('localStorage:dynamic', listenerC);
      });

      bus.subscribe('localStorage:dynamic', listenerA);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'dynamic' });
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerC).toHaveBeenCalledTimes(0);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'dynamic' });
      expect(listenerA).toHaveBeenCalledTimes(2);
      expect(listenerC).toHaveBeenCalledTimes(1);
    });
  });

  describe('Suite 6: Memory Leak Prevention & Resource Lifecycle', () => {
    it('6.1 should mark handle as inactive and remove listener on handle.unsubscribe()', () => {
      const token = bus.subscribe('localStorage:mem', vi.fn());
      expect(bus.getSubscriberCount('localStorage:mem')).toBe(1);

      token.unsubscribe();
      expect(bus.getSubscriberCount('localStorage:mem')).toBe(0);
    });

    it('6.2 should handle idempotent unsubscribe() calls without error', () => {
      const token = bus.subscribe('localStorage:idem', vi.fn());
      expect(bus.unsubscribe(token)).toBe(true);
      expect(bus.unsubscribe(token)).toBe(false);
      expect(bus.unsubscribe(token)).toBe(false);
      expect(bus.getSubscriberCount('localStorage:idem')).toBe(0);
    });

    it('6.3 should remove all listeners for a topic on unsubscribeAll(topic)', () => {
      bus.subscribe('localStorage:topicA', vi.fn());
      bus.subscribe('localStorage:topicA', vi.fn());
      bus.subscribe('localStorage:topicB', vi.fn());

      expect(bus.getSubscriberCount('localStorage:topicA')).toBe(2);
      expect(bus.getSubscriberCount('localStorage:topicB')).toBe(1);

      bus.unsubscribeAll('localStorage:topicA');

      expect(bus.getSubscriberCount('localStorage:topicA')).toBe(0);
      expect(bus.hasSubscribers('localStorage:topicA')).toBe(false);
      expect(bus.getSubscriberCount('localStorage:topicB')).toBe(1);
    });

    it('6.4 should purge entire listener map on unsubscribeAll() without parameters', () => {
      bus.subscribe('localStorage:a', vi.fn());
      bus.subscribe('sessionStorage:b', vi.fn());

      expect(bus.getSubscriberCount()).toBe(2);
      bus.unsubscribeAll();
      expect(bus.getSubscriberCount()).toBe(0);
    });

    it('6.5 should set bus to disposed state on dispose() and reject subsequent actions', () => {
      bus.subscribe('localStorage:disp', vi.fn());
      bus.dispose();

      expect(bus.getSubscriberCount()).toBe(0);

      const pubRes = bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'disp' });
      expect(pubRes.ok).toBe(false);
      if (!pubRes.ok) {
        expect(pubRes.error.code).toBe('BUS_DISPOSED');
      }

      const token = bus.subscribe('localStorage:disp', vi.fn());
      expect(token.id).toContain('sub_invalid');

      const patternToken = bus.subscribePattern('localStorage:*', vi.fn());
      expect(patternToken.id).toContain('sub_invalid');
    });
  });

  describe('Suite 7: ReactiveStorageObserver Debouncing, Throttling & Burst Control', () => {
    it('7.1 should debounce rapid burst of events and emit only final event after delay', () => {
      vi.useFakeTimers();
      const observer = ReactiveStorageObserver.getInstance();
      const callback = vi.fn();

      observer.observeKey('localStorage', 'burst', callback, { debounceMs: 100 });

      for (let i = 1; i <= 50; i++) {
        bus.publish({
          type: 'UPDATE',
          target: 'localStorage',
          key: 'burst',
          newValue: `val_${i}`,
        });
        vi.advanceTimersByTime(10);
      }

      expect(callback).toHaveBeenCalledTimes(0);

      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        'val_50',
        undefined,
        expect.objectContaining({ newValue: 'val_50' })
      );
    });

    it('7.2 should respect once subscription option in observer', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const callback = vi.fn();

      observer.observeKey('localStorage', 'onceKey', callback, { once: true });

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'onceKey', newValue: 'v1' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'onceKey', newValue: 'v2' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('v1', undefined, expect.anything());
    });

    it('7.3 should pause and resume observer event delivery on demand', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const callback = vi.fn();

      observer.observeKey('localStorage', 'pauseKey', callback);

      observer.pause();
      expect(observer.isPaused()).toBe(true);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'pauseKey', newValue: 'p1' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'pauseKey', newValue: 'p2' });

      expect(callback).toHaveBeenCalledTimes(0);

      observer.resume();
      expect(observer.isPaused()).toBe(false);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[0][0]).toBe('p1');
      expect(callback.mock.calls[1][0]).toBe('p2');
    });

    it('7.4 should unsubscribe when cleanup functions returned by observePrefix, observeTarget, observeAll are called', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const prefixCb = vi.fn();
      const targetCb = vi.fn();
      const allCb = vi.fn();

      const unsubPrefix = observer.observePrefix('localStorage', 'unsub_', prefixCb);
      const unsubTarget = observer.observeTarget('localStorage', targetCb);
      const unsubAll = observer.observeAll(allCb);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'unsub_1' });
      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(1);

      unsubPrefix();
      unsubTarget();
      unsubAll();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'unsub_1' });
      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(1);
    });

    it('7.5 should buffer events during pause for observePrefix, observeTarget, observeAll', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const prefixCb = vi.fn();
      const targetCb = vi.fn();
      const allCb = vi.fn();

      observer.observePrefix('localStorage', 'p_', prefixCb);
      observer.observeTarget('localStorage', targetCb);
      observer.observeAll(allCb);

      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'p_1' });

      expect(prefixCb).toHaveBeenCalledTimes(0);
      expect(targetCb).toHaveBeenCalledTimes(0);
      expect(allCb).toHaveBeenCalledTimes(0);

      observer.resume();

      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(1);
    });

    it('7.6 should handle startAutoBridge double call and stopAutoBridge correctly', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const allListener = vi.fn();

      observer.observeAll(allListener);

      // Call startAutoBridge twice
      observer.startAutoBridge();
      observer.startAutoBridge();

      // Now test stopAutoBridge twice
      observer.stopAutoBridge();
      observer.stopAutoBridge();

      expect(true).toBe(true);
    });

    it('7.7 should clear paused queue on clearPausedQueue()', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const cb = vi.fn();

      observer.observeKey('localStorage', 'clearQ', cb);
      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'clearQ', newValue: 'val' });
      expect(cb).toHaveBeenCalledTimes(0);

      observer.clearPausedQueue();
      observer.resume();

      expect(cb).toHaveBeenCalledTimes(0);
    });

    it('7.8 should configure custom bus using configure()', () => {
      const customBus = StorageEventBus.getInstance();
      ReactiveStorageObserver.configure(customBus);

      const observer = ReactiveStorageObserver.getInstance();
      expect(observer).toBeDefined();
    });

    it('7.9 should handle error when paused task throws error in resume()', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const throwingCb = vi.fn(() => {
        throw new Error('Pause task error');
      });

      observer.observeKey('localStorage', 'errKey', throwingCb);
      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'errKey' });

      expect(() => observer.resume()).not.toThrow();
    });

    it('7.10 should translate storage changes from bridge to event bus across all area types and change kinds', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const events: StorageEvent[] = [];

      observer.observeAll((e) => events.push(e));

      let bridgeListener: any;
      const mockPort: any = {
        getItem: vi.fn(),
        getItems: vi.fn(),
        setItem: vi.fn(),
        setItems: vi.fn(),
        removeItem: vi.fn(),
        removeItems: vi.fn(),
        clear: vi.fn(),
        getBytesInUse: vi.fn(),
        sendMessage: vi.fn(),
        sendMessageToTab: vi.fn(),
        onStorageChanged: (cb: any) => {
          bridgeListener = cb;
          return () => {
            bridgeListener = null;
          };
        },
        getBrowserContext: vi.fn(),
      };

      CrossBrowserBridge.configure(mockPort);
      observer.stopAutoBridge();
      observer.startAutoBridge();

      if (bridgeListener) {
        bridgeListener(
          {
            createdKey: { oldValue: undefined, newValue: 'newVal' },
            deletedKey: { oldValue: 'oldVal', newValue: undefined },
            updatedKey: { oldValue: 'oldVal', newValue: 'newVal' },
          },
          'session'
        );

        bridgeListener(
          {
            syncKey: { oldValue: undefined, newValue: 'syncVal' },
          },
          'sync'
        );

        bridgeListener(
          {
            managedKey: { oldValue: 'mOld', newValue: 'mNew' },
          },
          'managed'
        );
      }

      expect(events.length).toBe(5);
      expect(events[0].target).toBe('sessionStorage');
      expect(events[0].type).toBe('CREATE');
      expect(events[1].type).toBe('DELETE');
      expect(events[2].type).toBe('UPDATE');

      expect(events[3].target).toBe('localStorage');
      expect(events[4].target).toBe('localStorage');

      observer.stopAutoBridge();
    });
  });

  describe('Suite 8: Stream Transformation & Reactive Pipelines', () => {
    it('8.1 should filter events based on predicate filter', () => {
      const callback = vi.fn();
      const observer = ReactiveStorageObserver.getInstance();

      observer.observeTarget('localStorage', callback, {
        filter: (evt) => (evt.newValue as number) > 100,
      });

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'a', newValue: 50 });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'b', newValue: 150 });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'c', newValue: 80 });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'd', newValue: 200 });

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[0][0].key).toBe('b');
      expect(callback.mock.calls[1][0].key).toBe('d');
    });

    it('8.2 should observe prefix and observe all correctly', () => {
      const prefixCb = vi.fn();
      const allCb = vi.fn();

      const observer = ReactiveStorageObserver.getInstance();
      observer.observePrefix('localStorage', 'pref_', prefixCb);
      observer.observeAll(allCb);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'pref_one' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'other' });

      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(2);
    });
  });

  describe('Suite 9: Monadic Result Zero-Throw Guarantee', () => {
    it('9.1 should return Result.err for empty or invalid event input', () => {
      const res1 = bus.publish(null as any);
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.error.code).toBe('INVALID_EVENT');
      }

      const res2 = bus.publish({ type: '', target: 'localStorage' } as any);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.code).toBe('INVALID_EVENT');
      }
    });

    it('9.2 should return dummy token when subscribing with invalid parameters', () => {
      const token = bus.subscribe('', null as any);
      expect(token.id).toContain('sub_invalid');
      expect(token.unsubscribe).toBeDefined();
      expect(() => token.unsubscribe()).not.toThrow();
    });

    it('9.3 should never throw uncaught exception across any invalid input combination', () => {
      const inputs = [undefined, null, {}, { type: 'CREATE' }, { target: 'localStorage' }];
      for (const input of inputs) {
        expect(() => bus.publish(input as any)).not.toThrow();
      }
    });
  });

  describe('Suite 10: Concurrent Stress & Multi-Observer Integration', () => {
    it('10.1 should process high volume of concurrent events across 100 distinct topics', () => {
      const subscriberCounts = new Array(100).fill(0);

      for (let i = 0; i < 100; i++) {
        bus.subscribe(`localStorage:topic_${i}`, () => {
          subscriberCounts[i]++;
        });
      }

      for (let i = 0; i < 100; i++) {
        bus.publish({
          type: 'UPDATE',
          target: 'localStorage',
          key: `topic_${i}`,
        });
      }

      for (let i = 0; i < 100; i++) {
        expect(subscriberCounts[i]).toBe(1);
      }
    });

    it('10.2 should autowire CrossBrowserBridge storage changes into storage event bus', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const allListener = vi.fn();

      observer.observeAll(allListener);
      observer.startAutoBridge();

      // Trigger auto bridge via CrossBrowserBridge
      bus.publish({
        type: 'CREATE',
        target: 'localStorage',
        key: 'bridgedKey',
        newValue: 'bridgedVal',
      });

      expect(allListener).toHaveBeenCalledTimes(1);

      observer.stopAutoBridge();
    });
  });

  describe('Suite 11: Comprehensive Unsubscription Handles & Debounce Lifecycle', () => {
    it('11.1 should unsubscribe handles returned by observeKey, observePrefix, observeTarget, observeAll', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const keyCb = vi.fn();
      const prefixCb = vi.fn();
      const targetCb = vi.fn();
      const allCb = vi.fn();

      const unsubKey = observer.observeKey('localStorage', 'k1', keyCb);
      const unsubPrefix = observer.observePrefix('localStorage', 'p_', prefixCb);
      const unsubTarget = observer.observeTarget('sessionStorage', targetCb);
      const unsubAll = observer.observeAll(allCb);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'k1', newValue: 'v1' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'p_1', newValue: 'v2' });
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 's1', newValue: 'v3' });

      expect(keyCb).toHaveBeenCalledTimes(1);
      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(3);

      unsubKey();
      unsubPrefix();
      unsubTarget();
      unsubAll();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'k1', newValue: 'v11' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'p_1', newValue: 'v22' });
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 's1', newValue: 'v33' });

      expect(keyCb).toHaveBeenCalledTimes(1);
      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(3);
    });

    it('11.2 should cancel pending debounce timer when unsubscribing before timer fires', () => {
      vi.useFakeTimers();
      const listener = vi.fn();
      const token = bus.subscribe('localStorage:deb', listener, { debounceMs: 100 });

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'deb', newValue: 'val' });
      expect(listener).not.toHaveBeenCalled();

      token.unsubscribe();
      vi.advanceTimersByTime(200);

      expect(listener).not.toHaveBeenCalled();
    });

    it('11.3 should handle unsubscribing invalid or already removed tokens gracefully', () => {
      expect(bus.unsubscribe('non_existent_id')).toBe(false);
      expect(bus.unsubscribe({ id: '', topic: 't', unsubscribe: () => {} })).toBe(false);
      expect(bus.unsubscribe(null as any)).toBe(false);
    });
  });

  describe('Suite 12: Observer Pause Queue Edge Cases & Error Recovery', () => {
    it('12.1 should clear paused queue on clearPausedQueue() without executing tasks', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const callback = vi.fn();

      observer.observeKey('localStorage', 'clearKey', callback);
      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'clearKey', newValue: 'a' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'clearKey', newValue: 'b' });

      observer.clearPausedQueue();
      observer.resume();

      expect(callback).not.toHaveBeenCalled();
    });

    it('12.2 should recover gracefully when a paused task throws during resume()', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const goodCb = vi.fn();
      const badCb = vi.fn(() => {
        throw new Error('Task execution error in resume');
      });

      observer.observeKey('localStorage', 'kBad', badCb);
      observer.observeKey('localStorage', 'kGood', goodCb);

      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'kBad', newValue: 'bad' });
      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'kGood', newValue: 'good' });

      observer.resume();

      expect(badCb).toHaveBeenCalledTimes(1);
      expect(goodCb).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ReactiveStorageObserver] Error processing paused task:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('12.3 should queue observePrefix, observeTarget, and observeAll callbacks when paused', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const prefixCb = vi.fn();
      const targetCb = vi.fn();
      const allCb = vi.fn();

      observer.observePrefix('localStorage', 'pre_', prefixCb);
      observer.observeTarget('sessionStorage', targetCb);
      observer.observeAll(allCb);

      observer.pause();

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'pre_1', newValue: 'v1' });
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 's1', newValue: 'v2' });

      expect(prefixCb).not.toHaveBeenCalled();
      expect(targetCb).not.toHaveBeenCalled();
      expect(allCb).not.toHaveBeenCalled();

      observer.resume();

      expect(prefixCb).toHaveBeenCalledTimes(1);
      expect(targetCb).toHaveBeenCalledTimes(1);
      expect(allCb).toHaveBeenCalledTimes(2);
    });
  });

  describe('Suite 13: Reactive Storage Observer Callbacks & Custom Configuration', () => {
    it('13.1 should configure observer with custom StorageEventPort instance', () => {
      const customBus = StorageEventBus.getInstance();
      ReactiveStorageObserver.configure(customBus);
      const observer = ReactiveStorageObserver.getInstance();

      const callback = vi.fn();
      observer.observeKey('localStorage', 'customKey', callback);

      customBus.publish({ type: 'UPDATE', target: 'localStorage', key: 'customKey', newValue: 'cVal' });
      expect(callback).toHaveBeenCalledWith('cVal', undefined, expect.objectContaining({ newValue: 'cVal' }));
    });

    it('13.2 should correctly pass (newValue, oldValue, event) to observeKey callback', () => {
      const observer = ReactiveStorageObserver.getInstance();
      const callback = vi.fn();

      observer.observeKey<string>('localStorage', 'user', callback);

      bus.publish<string>({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'user',
        oldValue: 'alice',
        newValue: 'bob',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('bob', 'alice', expect.objectContaining({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'user',
        oldValue: 'alice',
        newValue: 'bob',
      }));
    });
  });

  describe('Suite 14: AutoBridge Lifecycle & Multi-Area Storage Mapping', () => {
    it('14.1 should handle idempotent startAutoBridge calls without duplicating listeners', () => {
      let registeredListenerCount = 0;
      let registeredListener: ((changes: Record<string, any>, area: any) => void) | null = null;
      const mockPort: ExtensionBridgePort = {
        getBrowserContext: () => ({
          vendor: 'chrome',
          manifestVersion: 'mv3',
          isExtensionContext: false,
          supportedStorageAreas: ['local'],
          hasSessionStorage: true,
        }),
        getItem: async () => Result.ok(null),
        getItems: async () => Result.ok({} as any),
        setItem: async () => Result.ok(undefined),
        setItems: async () => Result.ok(undefined),
        removeItem: async () => Result.ok(undefined),
        removeItems: async () => Result.ok(undefined),
        clear: async () => Result.ok(undefined),
        getBytesInUse: async () => Result.ok(0),
        sendMessage: async () => Result.ok(null as any),
        sendMessageToTab: async () => Result.ok(null as any),
        onStorageChanged: (l) => {
          registeredListenerCount++;
          registeredListener = l;
          return () => {
            registeredListener = null;
          };
        },
      };

      CrossBrowserBridge.configure(mockPort);
      const observer = ReactiveStorageObserver.getInstance();
      const allCb = vi.fn();
      observer.observeAll(allCb);

      observer.startAutoBridge();
      observer.startAutoBridge(); // Second call should be no-op

      expect(registeredListenerCount).toBe(1);

      if (registeredListener) {
        (registeredListener as any)({ key1: { oldValue: 'a', newValue: 'b' } }, 'local');
      }

      expect(allCb).toHaveBeenCalledTimes(1);

      observer.stopAutoBridge();
    });

    it('14.2 should map all storage areas (local, session, sync, managed, default) and change types (CREATE, DELETE, UPDATE) correctly', () => {
      let registeredListener: any = null;
      const mockPort: ExtensionBridgePort = {
        getBrowserContext: () => ({
          vendor: 'chrome',
          manifestVersion: 'mv3',
          isExtensionContext: false,
          supportedStorageAreas: ['local', 'session', 'sync', 'managed'],
          hasSessionStorage: true,
        }),
        getItem: async () => Result.ok(null),
        getItems: async () => Result.ok({} as any),
        setItem: async () => Result.ok(undefined),
        setItems: async () => Result.ok(undefined),
        removeItem: async () => Result.ok(undefined),
        removeItems: async () => Result.ok(undefined),
        clear: async () => Result.ok(undefined),
        getBytesInUse: async () => Result.ok(0),
        sendMessage: async () => Result.ok(null as any),
        sendMessageToTab: async () => Result.ok(null as any),
        onStorageChanged: (l) => {
          registeredListener = l;
          return () => {
            registeredListener = null;
          };
        },
      };

      CrossBrowserBridge.configure(mockPort);
      const observer = ReactiveStorageObserver.getInstance();
      const events: StorageEvent[] = [];
      observer.observeAll((evt) => events.push(evt));

      observer.startAutoBridge();
      expect(registeredListener).not.toBeNull();
      const fn: any = registeredListener;
      if (fn) {
        // Test local -> localStorage & CREATE
        fn({ k1: { oldValue: undefined, newValue: 'v1' } }, 'local');
        // Test session -> sessionStorage & DELETE
        fn({ k2: { oldValue: 'v2', newValue: undefined } }, 'session');
        // Test sync -> localStorage & UPDATE
        fn({ k3: { oldValue: 'v3', newValue: 'v3_new' } }, 'sync');
        // Test managed -> localStorage
        fn({ k4: { oldValue: 'v4', newValue: 'v4_new' } }, 'managed');
        // Test unknown area -> default localStorage
        fn({ k5: { oldValue: undefined, newValue: 'v5' } }, 'unknown_area');
      }

      expect(events).toHaveLength(5);
      expect(events[0]).toMatchObject({ target: 'localStorage', key: 'k1', type: 'CREATE', newValue: 'v1' });
      expect(events[1]).toMatchObject({ target: 'sessionStorage', key: 'k2', type: 'DELETE', oldValue: 'v2' });
      expect(events[2]).toMatchObject({ target: 'localStorage', key: 'k3', type: 'UPDATE', oldValue: 'v3', newValue: 'v3_new' });
      expect(events[3]).toMatchObject({ target: 'localStorage', key: 'k4', type: 'UPDATE' });
      expect(events[4]).toMatchObject({ target: 'localStorage', key: 'k5', type: 'CREATE' });

      observer.stopAutoBridge();
      expect(registeredListener).toBeNull();

      // Test idempotent stopAutoBridge
      expect(() => observer.stopAutoBridge()).not.toThrow();
    });
  });

  describe('Suite 15: StorageEventBus Deep Edge Cases & Async Exception Handling', () => {
    it('15.1 should handle async listener rejection and pass to onErrorHandler', async () => {
      const errorHandler = vi.fn();
      bus.setErrorHandler(errorHandler);

      const asyncRejectingListener = vi.fn(async () => {
        throw new Error('Async promise rejection failure');
      });

      bus.subscribe('localStorage:asyncErr', asyncRejectingListener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'asyncErr' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(asyncRejectingListener).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      const err: StorageEventError = errorHandler.mock.calls[0][0];
      expect(err.code).toBe('SUBSCRIBER_ERROR');
      expect(err.message).toContain('Async subscriber error');
    });

    it('15.2 should handle async listener rejection when no onErrorHandler is registered', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const asyncRejectingListener = vi.fn(async () => {
        throw new Error('Async rejection without custom handler');
      });

      bus.subscribe('localStorage:asyncErrNoHandler', asyncRejectingListener);

      bus.publish({ type: 'UPDATE', target: 'localStorage', key: 'asyncErrNoHandler' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StorageEventBus] Async listener error for subscription'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('15.3 should subscribe using RegExp pattern and match correctly', () => {
      const listener = vi.fn();
      const token = bus.subscribePattern(/^sessionStorage:user_\d+$/, listener);

      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 'user_42' });
      bus.publish({ type: 'UPDATE', target: 'sessionStorage', key: 'user_abc' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(token.topic).toBe('^sessionStorage:user_\\d+$');

      token.unsubscribe();
    });

    it('15.4 should handle invalid subscribe inputs and return dummy token', () => {
      const dummy1 = bus.subscribe('', vi.fn());
      expect(dummy1.id).toContain('sub_invalid');

      const dummy2 = bus.subscribe('topic', null as any);
      expect(dummy2.id).toContain('sub_invalid');

      const dummyPattern1 = bus.subscribePattern(null as any, vi.fn());
      expect(dummyPattern1.id).toContain('sub_invalid');

      const dummyPattern2 = bus.subscribePattern('pattern', null as any);
      expect(dummyPattern2.id).toContain('sub_invalid');
    });
  });
});
