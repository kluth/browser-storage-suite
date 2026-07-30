import { describe, it, expect } from 'vitest';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';

describe('Feature 09: Smart Preset Predictor', () => {
  it('9.1 should predict e-commerce presets when page URL contains cart or shop keywords', () => {
    const meta: PageMetadata = {
      url: 'https://myshop.com/checkout/cart',
      title: 'Shopping Cart',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions).toHaveLength(2);
    expect(predictions[0].category).toBe('ecommerce');
    expect(predictions[0].id).toMatch(/^pred_cart_/);
    expect(predictions[0].entries).toHaveProperty('cart_id');
    expect(predictions[0].entries).toHaveProperty('cart_items');

    expect(predictions[1].id).toMatch(/^pred_checkout_/);
  });

  it('9.2 should predict e-commerce presets when page title contains store or shop', () => {
    const meta: PageMetadata = {
      url: 'https://example.com/item/123',
      title: 'Official Flagship Store',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions).toHaveLength(2);
    expect(predictions[0].category).toBe('ecommerce');
  });

  it('9.3 should predict auth presets when page has password field or auth URL keyword', () => {
    const meta: PageMetadata = {
      url: 'https://portal.company.com/login',
      title: 'User Login',
      hasPasswordField: true,
      hasFormCart: false,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions).toHaveLength(2);
    expect(predictions[0].category).toBe('auth');
    expect(predictions[0].id).toMatch(/^pred_auth_admin_/);
    expect(predictions[0].entries).toHaveProperty('access_token');
    expect(predictions[0].entries.user_role).toBe('super_admin');

    expect(predictions[1].id).toMatch(/^pred_auth_expired_/);
  });

  it('9.4 should fall back to general SaaS presets for un-matched domains', () => {
    const meta: PageMetadata = {
      url: 'https://blog.news.org/article-1',
      title: 'Daily News Feed',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions).toHaveLength(2);
    expect(predictions[0].category).toBe('saas');
    expect(predictions[0].id).toMatch(/^pred_saas_darkmode_/);
    expect(predictions[0].entries.theme_preference).toBe('dark');

    expect(predictions[1].id).toMatch(/^pred_saas_features_/);
  });

  it('9.5 should match keywords case-insensitively across mixed case URLs and Titles', () => {
    const meta: PageMetadata = {
      url: 'HTTPS://MYSTORE.COM/DASHBOARD/AUTH',
      title: 'USER ACCOUNT DASHBOARD',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions.length).toBeGreaterThan(0);
    const category = predictions[0].category;
    expect(['auth', 'ecommerce']).toContain(category);
  });

  it('9.6 should return predicted preset entries with valid JSON strings for complex items', () => {
    const meta: PageMetadata = {
      url: 'https://shop.dev/cart',
      title: 'Cart',
      hasPasswordField: false,
      hasFormCart: true,
      metaTags: [],
    };

    const res = predictPagePresets(meta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    const cartEntries = predictions[0].entries;

    expect(cartEntries.cart_items).toBeDefined();
    const items = JSON.parse(cartEntries.cart_items);
    expect(items).toBeInstanceOf(Array);
    expect(items[0]).toHaveProperty('name');
  });
});

