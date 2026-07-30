import { describe, it, expect } from 'vitest';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';
import { generateSelectiveSeedData, SeededRecord } from '../../../utils/dataSeeder';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';

class InMemoryEcommerceAdapter implements StorageRepositoryPort {
  private store: Map<string, StorageEntryDto> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.values()).filter((e) => e.target === target);
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(`${target}:${key.value}`, {
      key: key.value,
      value: value.value,
      target,
    });
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(`${target}:${key.value}`);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    for (const [k, entry] of this.store.entries()) {
      if (entry.target === target) {
        this.store.delete(k);
      }
    }
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 3: E-Commerce Cart Hydration & Data Seeding Workflow (F8, F9, F1, F15)', () => {
  it('should predict e-commerce presets based on page metadata analysis', () => {
    const meta: PageMetadata = {
      url: 'https://shop.example.com/cart/checkout',
      title: 'Shopping Store - Finalize Order',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: ['e-commerce', 'shopping-cart'],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions.length).toBe(2);

    const filledCartPreset = predictions.find((p) => p.category === 'ecommerce');
    expect(filledCartPreset).toBeDefined();
    expect(filledCartPreset?.entries['cart_id']).toBeDefined();
    expect(filledCartPreset?.entries['cart_items_count']).toBe('3');

    const checkoutPreset = predictions[1];
    expect(checkoutPreset).toBeDefined();
    expect(checkoutPreset?.entries['shipping_country']).toBe('DE');
  });

  it('should generate selective seed data for cart items and user profiles', () => {
    const cartSeeds: SeededRecord[] = generateSelectiveSeedData('cart_items', 3);
    expect(cartSeeds.length).toBe(3);
    cartSeeds.forEach((record, index) => {
      expect(record.key).toBe(`cart_item_${index + 1}`);
      expect(record.type).toBe('JSON');
      expect(record.sizeBytes).toBeGreaterThan(0);
      const parsed = JSON.parse(record.value);
      expect(parsed.productId).toBeDefined();
      expect(parsed.price).toBeGreaterThan(0);
    });

    const userSeeds: SeededRecord[] = generateSelectiveSeedData('user_profiles', 2);
    expect(userSeeds.length).toBe(2);
    const adminUser = JSON.parse(userSeeds[0].value);
    expect(adminUser.role).toBe('admin');
    const memberUser = JSON.parse(userSeeds[1].value);
    expect(memberUser.role).toBe('member');
  });

  it('should hydrate live storage with predicted and seeded cart data via Hexagonal Storage Service', async () => {
    const adapter = new InMemoryEcommerceAdapter();
    const service = new StorageApplicationService(adapter);

    const meta: PageMetadata = {
      url: 'https://shop.example.com/cart',
      title: 'Your Cart',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: [],
    };
    const predRes = predictPagePresets(meta);
    expect(predRes.ok).toBe(true);
    if (!predRes.ok) return;
    const cartPreset = predRes.value[0];

    for (const [key, value] of Object.entries(cartPreset.entries)) {
      const res = await service.setStorageItem('localStorage', key, value);
      expect(res.ok).toBe(true);
    }

    const seededItems = generateSelectiveSeedData('cart_items', 2);
    for (const seed of seededItems) {
      const res = await service.setStorageItem('indexedDB', seed.key, seed.value);
      expect(res.ok).toBe(true);
    }

    const localView = await service.loadStorageView('localStorage');
    expect(localView.ok).toBe(true);
    if (localView.ok) {
      expect(localView.value.length).toBe(Object.keys(cartPreset.entries).length);
      expect(localView.value.find((e) => e.key === 'cart_id')).toBeDefined();
    }

    const idbView = await service.loadStorageView('indexedDB');
    expect(idbView.ok).toBe(true);
    if (idbView.ok) {
      expect(idbView.value.length).toBe(2);
      expect(idbView.value[0].key).toBe('cart_item_1');
    }
  });

  it('should profile storage overhead of hydrated cart data with Performance Advisor', async () => {
    const adapter = new InMemoryEcommerceAdapter();
    const service = new StorageApplicationService(adapter);

    const seededItems = generateSelectiveSeedData('cart_items', 5);
    for (const seed of seededItems) {
      await service.setStorageItem('localStorage', seed.key, seed.value);
    }

    const localView = await service.loadStorageView('localStorage');
    expect(localView.ok).toBe(true);
    const localEntries: Record<string, string> = {};
    if (localView.ok) {
      localView.value.forEach((e) => {
        localEntries[e.key] = e.value;
      });
    }

    const metrics = analyzeStoragePerformance(localEntries, []);
    expect(metrics.localStorageBytes).toBeGreaterThan(0);
    expect(metrics.insights.length).toBeGreaterThan(0);
  });
});
