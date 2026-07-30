import { describe, it, expect } from 'vitest';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';
import { generateSelectiveSeedData, SeedTemplate } from '../../../utils/dataSeeder';

describe('Tier 3 Interaction: F8 (Data Seeder) + F9 (Preset Predictor)', () => {
  it('should predict e-commerce page preset and seed corresponding cart item dataset', () => {
    const pageMeta: PageMetadata = {
      url: 'https://shop.example.com/checkout',
      title: 'Store Checkout Page',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: ['ecommerce', 'cart'],
    };

    // 1. Predict presets
    const res1 = predictPagePresets(pageMeta);
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;

    const predictedPresets = res1.value;
    expect(predictedPresets.length).toBeGreaterThan(0);
    const ecommercePreset = predictedPresets.find((p) => p.category === 'ecommerce');
    expect(ecommercePreset).toBeDefined();

    // 2. Map predicted preset to selective seed data generation
    const seedTemplate: SeedTemplate = 'cart_items';
    const seededRecords = generateSelectiveSeedData(seedTemplate, 5);

    expect(seededRecords.length).toBe(5);
    seededRecords.forEach((record) => {
      expect(record.key).toMatch(/^cart_item_\d+/);
      const parsedVal = JSON.parse(record.value);
      expect(parsedVal.productId).toBeDefined();
      expect(parsedVal.price).toBeGreaterThan(0);
      expect(record.sizeBytes).toBeGreaterThan(0);
    });
  });

  it('should predict auth preset and seed authentic user profiles', () => {
    const pageMeta: PageMetadata = {
      url: 'https://app.example.com/login',
      title: 'Member Login',
      hasPasswordField: true,
      hasFormCart: false,
      metaTags: ['auth'],
    };

    const res2 = predictPagePresets(pageMeta);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;

    const predicted = res2.value;
    expect(predicted.some((p) => p.category === 'auth')).toBe(true);

    const userSeed = generateSelectiveSeedData('user_profiles', 3);
    expect(userSeed.length).toBe(3);
    expect(userSeed[0].key).toBe('user_record_1');
    const firstUser = JSON.parse(userSeed[0].value);
    expect(firstUser.role).toBe('admin');
  });
});
