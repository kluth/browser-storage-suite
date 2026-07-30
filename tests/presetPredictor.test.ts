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

  it('should trigger e-commerce predictions for all keyword variants', () => {
    const urls = ['https://test.com/checkout', 'https://test.com/shop', 'https://test.com/store'];
    for (const url of urls) {
      const res = predictPagePresets({ url, title: '', hasPasswordField: false, hasFormCart: false, metaTags: [] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((p) => p.category === 'ecommerce')).toBe(true);
      }
    }

    const titles = ['My Online Store', 'Awesome Shop Front'];
    for (const title of titles) {
      const res = predictPagePresets({ url: 'https://test.com', title, hasPasswordField: false, hasFormCart: false, metaTags: [] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((p) => p.category === 'ecommerce')).toBe(true);
      }
    }

    const metaTags = [['e-commerce'], ['shop']];
    for (const tagArr of metaTags) {
      const res = predictPagePresets({ url: 'https://test.com', title: '', hasPasswordField: false, hasFormCart: false, metaTags: tagArr });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((p) => p.category === 'ecommerce')).toBe(true);
      }
    }
  });

  it('should trigger auth predictions for all keyword variants', () => {
    const urls = ['https://test.com/auth', 'https://test.com/dashboard', 'https://test.com/account'];
    for (const url of urls) {
      const res = predictPagePresets({ url, title: '', hasPasswordField: false, hasFormCart: false, metaTags: [] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((p) => p.category === 'auth')).toBe(true);
      }
    }

    const titles = ['User Dashboard Auth', 'Login Portal'];
    for (const title of titles) {
      const res = predictPagePresets({ url: 'https://test.com', title, hasPasswordField: false, hasFormCart: false, metaTags: [] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((p) => p.category === 'auth')).toBe(true);
      }
    }
  });

  it('should handle invalid URL string and null metadata gracefully', () => {
    const invalidUrlRes = predictPagePresets({ url: 'not-a-valid-url!@#$', title: '', hasPasswordField: false, hasFormCart: false, metaTags: [] });
    expect(invalidUrlRes.ok).toBe(true);

    const nullMetaRes = predictPagePresets(null as any);
    expect(nullMetaRes.ok).toBe(true);

    const undefinedMetaRes = predictPagePresets(undefined as any);
    expect(undefinedMetaRes.ok).toBe(true);
  });
});

