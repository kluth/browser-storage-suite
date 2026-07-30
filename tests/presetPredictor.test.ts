import { describe, it, expect } from 'vitest';
import { predictPagePresets, PageMetadata, PredictedPreset } from '../utils/presetPredictor';
import { StorageKey, StorageValue } from '../src/domain/model/valueObjects';

describe('Dynamic Smart Page Structure Preset Predictor Engine', () => {
  it('should predict e-commerce presets with Result.ok and domain Value Objects', () => {
    const meta: PageMetadata = {
      url: 'https://shop.example.com/checkout/cart',
      title: 'Awesome Shop - Checkout',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: ['e-commerce', 'shop'],
    };

    const result = predictPagePresets(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const predictions: PredictedPreset[] = result.value;
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.some((p) => p.category === 'ecommerce')).toBe(true);

    for (const pred of predictions) {
      expect(pred.id).toBeDefined();
      expect(pred.name).toBeDefined();
      expect(pred.confidenceScore).toBeGreaterThan(0);

      // Validate all key-value pairs using domain Value Objects
      for (const [key, value] of Object.entries(pred.entries)) {
        expect(StorageKey.create(key).ok).toBe(true);
        expect(StorageValue.create(value).ok).toBe(true);
      }
    }
  });

  it('should predict auth presets for login or password field pages', () => {
    const meta: PageMetadata = {
      url: 'https://app.company.org/login',
      title: 'Company Portal Login',
      hasPasswordField: true,
      hasFormCart: false,
      metaTags: ['auth'],
    };

    const result = predictPagePresets(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const predictions = result.value;
    expect(predictions.some((p) => p.category === 'auth')).toBe(true);
    const authPreset = predictions.find((p) => p.category === 'auth');
    expect(authPreset?.entries.access_token).toMatch(/^bearer_/);
  });

  it('should fall back to SaaS presets for general pages', () => {
    const meta: PageMetadata = {
      url: 'https://app.company.org/settings',
      title: 'Application Preferences',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };

    const result = predictPagePresets(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const predictions = result.value;
    expect(predictions.some((p) => p.category === 'saas')).toBe(true);
  });

  it('should handle edge cases and empty metadata safely returning Result', () => {
    const invalidMeta: PageMetadata = {
      url: '',
      title: '',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };

    const result = predictPagePresets(invalidMeta);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
    }
  });
});

