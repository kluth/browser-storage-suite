import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageEventBus } from '../src/application/storageEventBus';
import { ReactiveStorageObserver } from '../utils/reactiveStorageObserver';
import { StorageEventError } from '../src/domain/ports/primary/storageEventPort';

describe('StorageEventBus & ReactiveStorageObserver Empirical Stress & Reliability Harness', () => {
  let bus: StorageEventBus;
  let observer: ReactiveStorageObserver;

  beforeEach(() => {
    StorageEventBus.resetInstance();
    ReactiveStorageObserver.reset();
    bus = StorageEventBus.getInstance();
    observer = ReactiveStorageObserver.getInstance();
  });

  afterEach(() => {
    StorageEventBus.resetInstance();
    ReactiveStorageObserver.reset();
  });

  it('1. High-concurrency event publishing (10,000+ events across 100+ topics)', async () => {
    const NUM_TOPICS = 100;
    const EVENTS_PER_TOPIC = 100; // 100 * 100 = 10,000 events total
    const LISTENERS_PER_TOPIC = 3;

    let totalDeliveries = 0;
    const topicCounts: Record<string, number> = {};

    // 1. Subscribe 3 listeners per topic (300 listeners)
    for (let i = 0; i < NUM_TOPICS; i++) {
      const topic = `localStorage:key_${i}`;
      topicCounts[topic] = 0;
      for (let l = 0; l < LISTENERS_PER_TOPIC; l++) {
        bus.subscribe(topic, (evt) => {
          totalDeliveries++;
          const tKey = evt.key ? `localStorage:${evt.key}` : '';
          topicCounts[tKey] = (topicCounts[tKey] || 0) + 1;
        });
      }
    }

    // Subscribe a wildcard global listener as well
    let globalDeliveries = 0;
    bus.subscribe('*', () => {
      globalDeliveries++;
    });

    const startTime = performance.now();

    // 2. Publish 10,000 events across the 100 topics
    for (let e = 0; e < EVENTS_PER_TOPIC; e++) {
      for (let i = 0; i < NUM_TOPICS; i++) {
        bus.publish({
          type: 'UPDATE',
          target: 'localStorage',
          key: `key_${i}`,
          oldValue: `old_${e}`,
          newValue: `new_${e}`,
        });
      }
    }

    const durationMs = performance.now() - startTime;
    const totalPublished = NUM_TOPICS * EVENTS_PER_TOPIC; // 10,000

    // Expectations:
    // Total deliveries = 10,000 events * 3 listeners = 30,000 topic deliveries
    expect(totalPublished).toBe(10000);
    expect(totalDeliveries).toBe(30000);
    expect(globalDeliveries).toBe(10000);

    // Each topic should have received EVENTS_PER_TOPIC * LISTENERS_PER_TOPIC deliveries = 300
    for (let i = 0; i < NUM_TOPICS; i++) {
      const topic = `localStorage:key_${i}`;
      expect(topicCounts[topic]).toBe(EVENTS_PER_TOPIC * LISTENERS_PER_TOPIC);
    }

    console.log(`[STRESS METRICS - High Concurrency] Published ${totalPublished} events across ${NUM_TOPICS} topics to ${NUM_TOPICS * LISTENERS_PER_TOPIC + 1} subscribers in ${durationMs.toFixed(2)}ms (${((totalPublished / durationMs) * 1000).toFixed(0)} events/sec).`);
  }, 30000);

  it('2. High-frequency event burst debouncing and throttling performance', async () => {
    const BURST_COUNT = 1000;
    const DEBOUNCE_MS = 50;
    let callCount = 0;
    let lastEventValue = '';

    bus.subscribe(
      'localStorage:burstKey',
      (evt) => {
        callCount++;
        lastEventValue = evt.newValue as string;
      },
      { debounceMs: DEBOUNCE_MS }
    );

    const startTime = performance.now();

    // Rapid burst of 1,000 events in immediate loop
    for (let i = 0; i < BURST_COUNT; i++) {
      bus.publish({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'burstKey',
        oldValue: `val_${i - 1}`,
        newValue: `val_${i}`,
      });
    }

    const publishDuration = performance.now() - startTime;

    // Immediately after burst, debounced listener should NOT have executed yet
    expect(callCount).toBe(0);

    // Wait for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 30));

    // Must have executed exactly ONCE with the final value
    expect(callCount).toBe(1);
    expect(lastEventValue).toBe(`val_${BURST_COUNT - 1}`);

    // High frequency test with multiple concurrent debounced listeners
    const DEBOUNCED_SUBSCRIBERS = 50;
    const subscriberCounts = new Array(DEBOUNCED_SUBSCRIBERS).fill(0);

    for (let s = 0; s < DEBOUNCED_SUBSCRIBERS; s++) {
      bus.subscribe(
        'sessionStorage:multiBurst',
        () => {
          subscriberCounts[s]++;
        },
        { debounceMs: 30 }
      );
    }

    for (let i = 0; i < 500; i++) {
      bus.publish({
        type: 'CREATE',
        target: 'sessionStorage',
        key: 'multiBurst',
        newValue: i,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 60));

    // Each subscriber should have executed exactly once
    subscriberCounts.forEach((cnt) => expect(cnt).toBe(1));

    console.log(`[STRESS METRICS - Burst Debounce] Handled burst of ${BURST_COUNT} events across 51 debounced listeners cleanly. Publish overhead: ${publishDuration.toFixed(2)}ms.`);
  }, 30000);

  it('3. Throwing listener exception isolation under stress', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const TOPIC = 'localStorage:stressErrorKey';
    const SUBSCRIBER_COUNT = 100;
    const EVENT_COUNT = 1000;

    let successfulDeliveries = 0;
    const errorsHandled: StorageEventError[] = [];

    bus.setErrorHandler((err) => {
      errorsHandled.push(err);
    });

    // 50 well-behaved listeners, 50 throwing listeners (alternating)
    for (let i = 0; i < SUBSCRIBER_COUNT; i++) {
      if (i % 2 === 0) {
        // Good listener
        bus.subscribe(TOPIC, () => {
          successfulDeliveries++;
        });
      } else if (i % 4 === 1) {
        // Sync throwing listener
        bus.subscribe(TOPIC, () => {
          throw new Error(`Sync error from sub ${i}`);
        });
      } else {
        // Async rejecting listener
        bus.subscribe(TOPIC, async () => {
          throw new Error(`Async error from sub ${i}`);
        });
      }
    }

    const startTime = performance.now();

    // Publish 1,000 events
    for (let e = 0; e < EVENT_COUNT; e++) {
      bus.publish({
        type: 'UPDATE',
        target: 'localStorage',
        key: 'stressErrorKey',
        newValue: e,
      });
    }

    // Wait for microtasks (async rejection handlers) to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    const durationMs = performance.now() - startTime;

    // 50 good listeners * 1,000 events = 50,000 successful deliveries
    expect(successfulDeliveries).toBe(50000);

    // 50 bad listeners * 1,000 events = 50,000 errors caught and routed to error handler
    expect(errorsHandled.length).toBe(50000);
    expect(errorsHandled[0].code).toBe('SUBSCRIBER_ERROR');

    // Confirm bus is still functional after exception stress
    let postStressReceived = false;
    bus.subscribe(TOPIC, () => {
      postStressReceived = true;
    });
    bus.publish({
      type: 'DELETE',
      target: 'localStorage',
      key: 'stressErrorKey',
    });
    expect(postStressReceived).toBe(true);

    consoleSpy.mockRestore();
    console.log(`[STRESS METRICS - Exception Isolation] Processed ${EVENT_COUNT} events with 50 throwing listeners (50,000 errors isolated) without corrupting event bus state in ${durationMs.toFixed(2)}ms.`);
  }, 30000);

  it('4. Memory leak inspection (attaching/unsubscribing 3,000+ listeners)', async () => {
    const TOTAL_LISTENERS = 3000;
    const tokens: Array<() => void> = [];

    expect(bus.getSubscriberCount()).toBe(0);

    const startTime = performance.now();

    // 1. Subscribe 3,000 listeners via bus and observer
    for (let i = 0; i < TOTAL_LISTENERS; i++) {
      if (i % 2 === 0) {
        const token = bus.subscribe(`localStorage:leak_${i % 100}`, () => {});
        tokens.push(() => token.unsubscribe());
      } else {
        const unsub = observer.observeKey(
          'sessionStorage',
          `obs_leak_${i % 100}`,
          () => {}
        );
        tokens.push(unsub);
      }
    }

    const attachTime = performance.now() - startTime;

    // Verify subscriber count on bus
    expect(bus.getSubscriberCount()).toBe(TOTAL_LISTENERS);

    // 2. Unsubscribe all 3,000 listeners individually
    const unsubStartTime = performance.now();
    for (const unsub of tokens) {
      unsub();
    }
    const unsubTime = performance.now() - unsubStartTime;

    // Subscriber count MUST be exactly 0
    expect(bus.getSubscriberCount()).toBe(0);

    // 3. Perform 5 stress cycles of subscribe/unsubscribe 3,000 listeners (15,000 attach/unsub ops)
    const CYCLES = 5;
    for (let c = 0; c < CYCLES; c++) {
      const cycleTokens: Array<() => void> = [];
      for (let i = 0; i < TOTAL_LISTENERS; i++) {
        const token = bus.subscribe(`target:topic_${i % 50}`, () => {}, {
          debounceMs: 10,
        });
        cycleTokens.push(() => token.unsubscribe());
      }
      expect(bus.getSubscriberCount()).toBe(TOTAL_LISTENERS);

      // Unsubscribe half using unsubscribeAll, half using token
      bus.unsubscribeAll('target:topic_0');
      for (const unsub of cycleTokens) {
        unsub();
      }
      expect(bus.getSubscriberCount()).toBe(0);
    }

    console.log(`[STRESS METRICS - Memory Leak & Lifecycle] Successfully attached ${TOTAL_LISTENERS} listeners in ${attachTime.toFixed(2)}ms, unsubscribed all in ${unsubTime.toFixed(2)}ms. Completed ${CYCLES} multi-cycle stress runs (15,000 subs/unsubs). Final subscriber count: ${bus.getSubscriberCount()}.`);
  }, 30000);
});
