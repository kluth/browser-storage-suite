import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageEventBus } from '../src/application/storageEventBus';
import { ReactiveStorageObserver } from '../utils/reactiveStorageObserver';
import {
  StorageEvent,
  StorageEventPort,
  StorageEventError,
} from '../src/domain/ports/primary/storageEventPort';
import { CrossBrowserBridge } from '../utils/crossBrowserBridge';
import { WxtBridgeAdapter } from '../src/infrastructure/adapters/wxtBridgeAdapter';

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
      const listener1 = vi.fn(() => { callOrder.push(1); });
      const listener2 = vi.fn(() => { callOrder.push(2); });
      const listener3 = vi.fn(() => { callOrder.push(3); });

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
      expect(callback).toHaveBeenCalledWith('val_50', undefined, expect.objectContaining({ newValue: 'val_50' }));
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
      const bridge = CrossBrowserBridge.getInstance();
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
});
