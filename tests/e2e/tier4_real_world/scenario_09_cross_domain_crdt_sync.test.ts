import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageTestHarness } from '../../../utils/storageTestHarness';
import { CrossDomainSyncEngine } from '../../../utils/crossDomainSyncEngine';
import { PostMessageRelayAdapter } from '../../../src/infrastructure/adapters/postMessageRelayAdapter';

describe('Tier 4 Real-World Scenario 09: Cross-Domain Multi-Origin E-Commerce Checkout & Auth State Sync', () => {
  const SECRET = 'e-commerce-shared-hmac-key-2026';
  const STORE_ORIGIN = 'https://store.shop.com';
  const AUTH_ORIGIN = 'https://auth.shop.com';
  const CHECKOUT_ORIGIN = 'https://checkout.shop.com';

  let engineStore: CrossDomainSyncEngine;
  let engineAuth: CrossDomainSyncEngine;
  let engineCheckout: CrossDomainSyncEngine;

  let relayStore: PostMessageRelayAdapter;
  let relayAuth: PostMessageRelayAdapter;
  let relayCheckout: PostMessageRelayAdapter;

  beforeEach(async () => {
    CrossDomainSyncEngine.resetInstance();

    const allowed = [STORE_ORIGIN, AUTH_ORIGIN, CHECKOUT_ORIGIN];
    relayStore = new PostMessageRelayAdapter(allowed);
    relayAuth = new PostMessageRelayAdapter(allowed);
    relayCheckout = new PostMessageRelayAdapter(allowed);

    engineStore = new CrossDomainSyncEngine({ peerId: 'peer_store', ownOrigin: STORE_ORIGIN, relayAdapter: relayStore });
    engineAuth = new CrossDomainSyncEngine({ peerId: 'peer_auth', ownOrigin: AUTH_ORIGIN, relayAdapter: relayAuth });
    engineCheckout = new CrossDomainSyncEngine({ peerId: 'peer_checkout', ownOrigin: CHECKOUT_ORIGIN, relayAdapter: relayCheckout });

    await engineStore.setSharedSecret(SECRET);
    await engineAuth.setSharedSecret(SECRET);
    await engineCheckout.setSharedSecret(SECRET);

    // Mesh network relay routing simulation
    relayStore.listen(async (env) => {
      await engineAuth.mergeRemoteState(env);
      await engineCheckout.mergeRemoteState(env);
    });

    relayAuth.listen(async (env) => {
      await engineStore.mergeRemoteState(env);
      await engineCheckout.mergeRemoteState(env);
    });

    relayCheckout.listen(async (env) => {
      await engineStore.mergeRemoteState(env);
      await engineAuth.mergeRemoteState(env);
    });
  });

  afterEach(() => {
    CrossDomainSyncEngine.resetInstance();
  });

  it('scenario 9.1: user logs in at auth.shop.com and session automatically syncs to store and checkout subdomains', async () => {
    const authSession = { userId: 'usr_777', token: 'jwt_secure_session', roles: ['customer'] };

    const syncRes = await engineAuth.synchronizeKey('user_session', authSession);
    expect(syncRes.ok).toBe(true);

    expect(engineStore.getValue('user_session')).toEqual(authSession);
    expect(engineCheckout.getValue('user_session')).toEqual(authSession);
  });

  it('scenario 9.2: user adds items to cart at store.shop.com, then modifies quantity at checkout.shop.com with CRDT convergence', async () => {
    // User adds item at store
    await engineStore.synchronizeKey('cart', [{ sku: 'PROD-1', qty: 1 }]);
    expect(engineCheckout.getValue('cart')).toEqual([{ sku: 'PROD-1', qty: 1 }]);

    // User updates item quantity at checkout domain with timestamp progression
    await new Promise((r) => setTimeout(r, 10));
    await engineCheckout.synchronizeKey('cart', [{ sku: 'PROD-1', qty: 3 }, { sku: 'PROD-2', qty: 1 }]);

    expect(engineStore.getValue('cart')).toEqual([{ sku: 'PROD-1', qty: 3 }, { sku: 'PROD-2', qty: 1 }]);
    expect(engineAuth.getValue('cart')).toEqual([{ sku: 'PROD-1', qty: 3 }, { sku: 'PROD-2', qty: 1 }]);
  });
});
