import { describe, it, expect } from 'vitest';
import { StorageInterceptorAdapter } from '../../../src/infrastructure/adapters/storageInterceptorAdapter';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';
import { StorageStateAggregate, StorageMutation } from '../../../utils/storageAggregate';
import { getStorageDataBlame } from '../../../utils/dataBlamer';

describe('Tier 4 Scenario 5: Multi-Tab Storage Interception & OpenTelemetry Tracing (F14, F13, F3, F4)', () => {
  it('should attach storage interceptor adapters across multiple simulated tab EventTargets', () => {
    const tab1Target = new EventTarget();
    const tab2Target = new EventTarget();

    const receivedMutations: StorageMutation[] = [];
    const onMutation = (m: StorageMutation) => receivedMutations.push(m);

    const interceptor1 = new StorageInterceptorAdapter(onMutation, tab1Target);
    const interceptor2 = new StorageInterceptorAdapter(onMutation, tab2Target);

    interceptor1.attach();
    interceptor2.attach();

    const event1 = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: { id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'tab1_key', value: 'val1' },
    });
    tab1Target.dispatchEvent(event1);

    const event2 = Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
      detail: { id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'tab2_key', value: 'val2' },
    });
    tab2Target.dispatchEvent(event2);

    expect(receivedMutations.length).toBe(2);
    expect(receivedMutations[0].key).toBe('tab1_key');
    expect(receivedMutations[1].key).toBe('tab2_key');

    interceptor1.detach();
    interceptor2.detach();
  });

  it('should intercept cross-tab storage mutations and maintain centralized state timeline under Telemetry tracing', () => {
    const tab1Target = new EventTarget();
    const tab2Target = new EventTarget();
    const aggregate = new StorageStateAggregate();

    const interceptor1 = new StorageInterceptorAdapter((m) => aggregate.applyMutation(m), tab1Target);
    const interceptor2 = new StorageInterceptorAdapter((m) => aggregate.applyMutation(m), tab2Target);

    interceptor1.attach();
    interceptor2.attach();

    ExtensionTelemetry.traceOperation('multi_tab_storage_sync', () => {
      tab1Target.dispatchEvent(
        Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
          detail: { id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'user_token', value: 'token_tab1_v1' },
        })
      );

      tab2Target.dispatchEvent(
        Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
          detail: { id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'theme_preference', value: 'dark' },
        })
      );

      tab1Target.dispatchEvent(
        Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
          detail: { id: 'm3', timestamp: 3000, type: 'set', storageType: 'localStorage', key: 'user_token', value: 'token_tab1_v2' },
        })
      );
    });

    const snapshot2500 = aggregate.getSnapshotAt(2500);
    expect(snapshot2500.ok).toBe(true);
    if (snapshot2500.ok) {
      expect(snapshot2500.value.entries['user_token']).toBe('token_tab1_v1');
      expect(snapshot2500.value.entries['theme_preference']).toBe('dark');
    }

    const snapshot3500 = aggregate.getSnapshotAt(3500);
    expect(snapshot3500.ok).toBe(true);
    if (snapshot3500.ok) {
      expect(snapshot3500.value.entries['user_token']).toBe('token_tab1_v2');
      expect(snapshot3500.value.entries['theme_preference']).toBe('dark');
    }

    interceptor1.detach();
    interceptor2.detach();
  });

  it('should attribute cross-tab storage modifications via Data Blamer provenance', () => {
    const authStack = `Error\n    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)`;
    const tokenBlame = getStorageDataBlame('user_token', 'token_tab1_v2', authStack);
    expect(tokenBlame.key).toBe('user_token');
    expect(tokenBlame.actor.name).toContain('setAuthToken');
    expect(tokenBlame.actor.scriptUrl).toContain('auth-bundle.js');

    const userActionStack = `Error\n    at toggleTheme (https://example.com/assets/theme.js:45:10)\n    at HTMLButtonElement.onclick (https://example.com/index.html:12:1)`;
    const themeBlame = getStorageDataBlame('theme_preference', 'dark', userActionStack);
    expect(themeBlame.key).toBe('theme_preference');
    expect(themeBlame.actor.type).toBe('user_action');
    expect(themeBlame.actor.name).toContain('toggleTheme');
  });

  it('should clean up interceptor listeners when detaching from tab EventTargets', () => {
    const tabTarget = new EventTarget();
    const aggregate = new StorageStateAggregate();

    const interceptor = new StorageInterceptorAdapter((m) => aggregate.applyMutation(m), tabTarget);
    interceptor.attach();

    tabTarget.dispatchEvent(
      Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
        detail: { id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'k1', value: 'v1' },
      })
    );

    let snap = aggregate.getSnapshotAt(1500);
    expect(snap.ok && snap.value.entries['k1'] === 'v1').toBe(true);

    interceptor.detach();

    tabTarget.dispatchEvent(
      Object.assign(new Event('__STORAGE_SUITE_INTERCEPT__'), {
        detail: { id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'k2', value: 'v2' },
      })
    );

    snap = aggregate.getSnapshotAt(2500);
    expect(snap.ok && snap.value.entries['k2'] === undefined).toBe(true);
  });
});
